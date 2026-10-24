\set ON_ERROR_STOP on
-- Boundary suite for migration 320: «Согласие студента на ИИ-помощников» (docs/PLAN_CHANGES.md
-- «2026-10-25 · Согласие студента на ИИ-помощников, база данных (миграция 320)»; ADR 0035; контракт §A.9).
-- Runs on the real chain right after 320 inside one transaction that is rolled back, with its own synthetic
-- organizations and members; WhatsApp conversations come through the real WAHA projection chain, the document source
-- goes through the real ingress RPCs, the account deletion goes through the real 280 / 315 RPCs (only the Auth server's
-- own deleteUser is simulated). No provider, no Claude / Anthropic / Gemini / Google call, no real person, no production
-- action.
--
-- Proves:
--  1. posture: the table is closed to every API role (RLS forced); the three RPCs are definer functions with an
--     empty search_path granted to authenticated only; the six helpers are closed to every API role; the tool family
--     keeps its number (24 tools, 3 MCP) and its grants; the replaced bodies carry the check;
--  2. the student RPCs: only about oneself (anon, service_role, staff, no claims refused), the same identity as the
--     account deletion (a student member and an applicant without a membership), get of an empty state, set granted /
--     declined, one journal event per change (system actor, state and version only), idempotent replay (also a stale
--     replay of a request that CHANGED the decision, after a later decision; a request that changed nothing is not
--     remembered, see the 320 header), a conflicting reuse of a request id, the same decision again is no change,
--     wrong status / source / version / request id refused (22023), a decision on an older policy version is read
--     back as stored and replaced by a new one;
--  3. the enforcement helper, case by case: undecided / declined / granted / older version for a student WITH a
--     portal account; a student WITHOUT one (no membership; a suspended membership) is allowed unless declined; an
--     unknown or foreign case is refused; the conversation helper (linked by client, by lead, by a lead whose client has a
--     case linked by client only, unlinked);
--  4. the tools: get_case_chat, get_document_file and get_conversation answer ai_consent_missing (42501) with no
--     data, no file grant and no read audit row while the student has not allowed, and answer normally after it;
--     list_conversations keeps the row and withholds the text preview; a chat with no student, and the chat of a
--     student without a portal account, are unchanged; the case itself, the client card and the lead stay readable;
--     a file link issued before a refusal stops working (and keeps its use count), and works again after a grant;
--  5. the staff read (case.read.full on the case): status as enforced, decidedAt, aiAllowed; refused to a student,
--     another organization, anon and service_role;
--  6. the account deletion: a student account with a consent row is still SIMPLE (the row is in the own set),
--     the automatic processing erases the row and the journal events about it and nothing else changes in the
--     journal of the request; deleting the Auth user cascades the row of a student that has a case;
--  7. the journal: the two actions and the object type are in the server allowlist (plus two and one) and take the
--     ai.% branch of the changed-field codes;
--  8. Gemini and document recognition (320, h) - the promise «if you do not allow, the helpers do not read your
--     documents and correspondence» holds for every path: (a) P1 the sales-chat helper: no ticket for a declined or
--     undecided student with a portal account (and no spent quota), a redeemed ticket stops reading after a decline,
--     the window learns the reason (`studentAiAllowed`) and the saved answer is hidden; (b) P3 memory: nothing is queued,
--     a queued chat is dropped without a text, a result after a decline is refused, the block says why and a stored
--     summary stays visible and can be forgotten; (c) P4 night autoresponder: the decision is skipped with
--     `ai_consent_missing` (Russian words) on every stage, no messages are handed to the decision, the night summary
--     leaves the chat out; (d) document recognition: no enqueue, a queued job is failed `access_revoked` at the claim,
--     no further source grant, lease renewal or upload for a running attempt, every stage goes through the one check;
--     (e) the legacy U9 proposals: the staff request and the service context (also a replay) are refused. In every case
--     a chat with no student and a student without a portal account are unchanged (the same calls succeed).
BEGIN;

SET LOCAL TIME ZONE 'UTC';

\echo A320_STUDENT_AI_CONSENT_SUITE_START

-- The lightweight Auth bootstrap of the harness (see platform_account_deletion.sql): added transaction-locally.
ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS confirmation_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS banned_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
DO $a320_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = ''
    AS $fn$ SELECT NULLIF(current_setting('request.jwt.claims', TRUE), '')::JSONB ->> 'role' $fn$;
  END IF;
END
$a320_auth_role$;
CREATE TABLE IF NOT EXISTS auth.audit_log_entries (
  instance_id UUID, id UUID PRIMARY KEY, payload JSON, created_at TIMESTAMPTZ, ip_address VARCHAR(64)
);
CREATE TABLE IF NOT EXISTS auth.flow_state (id UUID PRIMARY KEY, user_id UUID, auth_code TEXT);

CREATE FUNCTION pg_temp.a320_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('32000000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.a320_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A320: %', message; END IF;
END
$$;
-- The JSONB result of a statement run as a role with the given JWT claims, or {"error": SQLSTATE, "message": ...}.
CREATE FUNCTION pg_temp.a320_call(p_role TEXT, p_claims TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
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
CREATE TEMP TABLE a320_claims(actor INTEGER PRIMARY KEY, claims TEXT);
GRANT SELECT ON a320_claims TO authenticated;
CREATE FUNCTION pg_temp.a320_as(p_actor INTEGER, p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a320_call('authenticated', (SELECT claims FROM a320_claims WHERE actor = p_actor), p_sql)
$$;
CREATE FUNCTION pg_temp.a320_svc(p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a320_call('service_role', '{"role":"service_role"}', p_sql)
$$;
CREATE FUNCTION pg_temp.a320_anon(p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a320_call('anon', '{"role":"anon"}', p_sql)
$$;
CREATE FUNCTION pg_temp.a320_err(p_result JSONB) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT p_result ->> 'error'
$$;
CREATE FUNCTION pg_temp.a320_msg(p_result JSONB) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT p_result ->> 'message'
$$;
-- A tool call as the service: tool name, agent key, args JSON text, organization.
CREATE FUNCTION pg_temp.a320_tool(p_tool TEXT, p_key TEXT, p_args TEXT DEFAULT '{}', p_org INTEGER DEFAULT 1) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a320_svc(format('SELECT platform.ai_agent_tool_%s_v1(%L, %L, %L::jsonb)', p_tool, pg_temp.a320_id(p_org), p_key, p_args))
$$;
-- The student RPCs as a student actor.
CREATE FUNCTION pg_temp.a320_get(p_actor INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a320_as(p_actor, 'SELECT platform.portal_ai_consent_get_v1()')
$$;
CREATE FUNCTION pg_temp.a320_set(p_actor INTEGER, p_status TEXT, p_version TEXT, p_source TEXT, p_request INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a320_as(p_actor, format('SELECT platform.portal_ai_consent_set_v1(%L, %L, %L, %L)', p_status, p_version, p_source,
    CASE WHEN p_request IS NULL THEN NULL ELSE pg_temp.a320_id(p_request)::TEXT END))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.a320_id(INTEGER) TO authenticated, service_role, anon;

-- ---------------------------------------------------------------------------
-- Fixture. Organization 1 and 2 (active).
--   1 org 1 Admin (system admin)   2 org 1 Student with a case (portal account)   3 org 2 Admin (system admin)
--   4 org 1 Student without a case (a simple account)   5 org 1 Student, membership SUSPENDED, with a case
--   6 org 1 applicant (Auth user only: no profile, no membership)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE a320_actors(n INTEGER PRIMARY KEY, org INTEGER, coarse platform.business_role, sysadmin BOOLEAN, member BOOLEAN, mstatus platform.membership_status);
INSERT INTO a320_actors VALUES (1, 1, 'admin', TRUE, TRUE, 'active'), (2, 1, 'student', FALSE, TRUE, 'active'),
  (3, 2, 'admin', TRUE, TRUE, 'active'), (4, 1, 'student', FALSE, TRUE, 'active'), (5, 1, 'student', FALSE, TRUE, 'suspended'),
  (6, 1, NULL, FALSE, FALSE, NULL);
INSERT INTO platform.organizations(id, name, status) VALUES
  (pg_temp.a320_id(1), 'A320 Fictional organization', 'active'),
  (pg_temp.a320_id(2), 'A320 Other fictional organization', 'active');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.a320_id(100 + n), 'a320-' || n || '@example.invalid', '{}'::JSONB FROM a320_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.a320_id(200 + n), pg_temp.a320_id(100 + n), 'A320 Actor ' || n, 'active', 1 FROM a320_actors WHERE member;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, created_at)
  SELECT pg_temp.a320_id(300 + a.n), pg_temp.a320_id(a.org), pg_temp.a320_id(200 + a.n), a.mstatus, a.coarse,
    (SELECT id FROM platform.role_bundle_versions WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1),
    TIMESTAMPTZ '2026-01-01 00:00:00+00' + a.n * INTERVAL '1 day'
  FROM a320_actors a WHERE a.member;
UPDATE platform.organization_memberships SET is_system_admin = TRUE
  WHERE id IN (SELECT pg_temp.a320_id(300 + n) FROM a320_actors WHERE sysadmin);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.a320_id(401), pg_temp.a320_id(1), 'organization', pg_temp.a320_id(1), 1),
  (pg_temp.a320_id(402), pg_temp.a320_id(2), 'organization', pg_temp.a320_id(2), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.a320_id(1), pg_temp.a320_id(301), pg_temp.a320_id(401), 1, 1, TRUE, 'system', 'A320 synthetic scope', pg_temp.a320_id(601)),
  (pg_temp.a320_id(2), pg_temp.a320_id(303), pg_temp.a320_id(402), 1, 1, TRUE, 'system', 'A320 synthetic scope', pg_temp.a320_id(602));

CREATE FUNCTION pg_temp.a320_claims_for(p_n INTEGER) RETURNS TEXT LANGUAGE SQL VOLATILE AS $$
  SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.a320_id(100 + p_n),
    'claims', jsonb_build_object('sub', pg_temp.a320_id(100 + p_n), 'role', 'authenticated'))) -> 'claims')::TEXT
$$;
INSERT INTO a320_claims(actor, claims) SELECT a.n, pg_temp.a320_claims_for(a.n) FROM a320_actors a;
SELECT pg_temp.a320_assert((SELECT count(*) = 6 AND bool_and(claims IS NOT NULL) FROM a320_claims),
  'every fixture actor got claims from the real hook');

-- The applicant (actor 6) reaches the organization through the single анкета configuration, as in the account deletion.
INSERT INTO platform.staff_departments (id, organization_id, name) VALUES (pg_temp.a320_id(930), pg_temp.a320_id(1), 'Отдел сопровождения');
DELETE FROM platform_private.student_application_configuration;
INSERT INTO platform_private.student_application_configuration (singleton, organization_id, review_department_id, enabled, intake_owner_membership_id)
VALUES (TRUE, pg_temp.a320_id(1), pg_temp.a320_id(930), TRUE, NULL);

-- WhatsApp conversations through the REAL WAHA projection chain (the intake owner is the Admin).
CREATE TEMP TABLE a320_clock AS SELECT date_trunc('second', clock_timestamp()) AS t0;
GRANT SELECT ON a320_clock TO authenticated, service_role;
CREATE FUNCTION pg_temp.a320_ago(p_seconds INTEGER) RETURNS TIMESTAMPTZ LANGUAGE SQL STABLE AS $$
  SELECT t0 - p_seconds * INTERVAL '1 second' FROM a320_clock
$$;
CREATE SEQUENCE pg_temp.a320_seq;
CREATE FUNCTION pg_temp.a320_run(p_payload JSONB, p_at TIMESTAMPTZ) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  org CONSTANT UUID := pg_temp.a320_id(1);
  n CONSTANT INTEGER := nextval('pg_temp.a320_seq')::INTEGER;
  event_id CONSTANT UUID := pg_temp.a320_id(20000 + n);
  enq JSONB; claim JSONB; proj JSONB; fin JSONB; work UUID; attempt UUID;
BEGIN
  INSERT INTO platform_private.provider_webhook_events (id, organization_id, provider, provider_account_ref,
    provider_conversation_ref, provider_event_variant_ref, provider_request_id, waha_session_name, payload_id,
    event_type, provider_occurred_at, verification_status, raw_payload, verification_headers,
    verification_evidence_ref, payload_sha256, request_id)
  VALUES (event_id, org, 'waha', 'waha:crm_primary', NULL, NULL, 'a320-' || n, 'crm_primary',
    p_payload ->> 'id', 'message.any', p_at,
    'verified', jsonb_build_object('event', 'message.any', 'session', 'crm_primary', 'payload', p_payload),
    '{"hmac_verified":true}', 'synthetic:a320:' || n, lpad(to_hex(3200000 + n), 64, '0'), pg_temp.a320_id(25000 + n));
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
  enq := platform.enqueue_verified_webhook_work(org, event_id,
    encode(sha256(convert_to('a320-message.any-' || (p_payload ->> 'id'), 'UTF8')), 'hex'), 8,
    pg_temp.a320_id(30000 + n * 10 + 1));
  work := (enq ->> 'work_item_id')::UUID;
  claim := platform.claim_waha_webhook_work_item(org, work, 60, 'a320', pg_temp.a320_id(30000 + n * 10 + 2));
  attempt := (claim ->> 'attempt_id')::UUID;
  proj := platform.project_claimed_waha_event(org, work, attempt, pg_temp.a320_id(301), pg_temp.a320_id(30000 + n * 10 + 3));
  fin := platform.finish_waha_webhook_work(org, work, attempt, (proj ->> 'disposition')::platform.durable_work_finish_outcome,
    proj ->> 'error_code', proj ->> 'evidence_ref', NULL, pg_temp.a320_id(30000 + n * 10 + 4));
  IF proj ->> 'disposition' IS DISTINCT FROM 'succeeded' THEN
    RAISE EXCEPTION 'A320: projection failed: %', proj;
  END IF;
  RETURN proj;
END
$$;
CREATE FUNCTION pg_temp.a320_in(p_chat INTEGER, p_body TEXT, p_seconds_ago INTEGER) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE chat TEXT := '7996770' || lpad(p_chat::TEXT, 4, '0') || '@c.us'; at TIMESTAMPTZ := pg_temp.a320_ago(p_seconds_ago);
  wid TEXT := 'false_' || chat || '_A320' || lpad(nextval('pg_temp.a320_seq')::TEXT, 15, '0');
BEGIN
  PERFORM pg_temp.a320_run(jsonb_build_object('id', wid, 'timestamp', extract(epoch FROM at)::BIGINT, 'from', chat,
    'fromMe', false, 'source', 'app', 'body', p_body), at);
  RETURN (SELECT m.id FROM platform.communication_messages m JOIN platform_private.waha_message_bindings b
    ON b.organization_id = m.organization_id AND b.communication_message_id = m.id WHERE b.raw_message_id = wid);
END
$$;
CREATE FUNCTION pg_temp.a320_conv(p_chat INTEGER) RETURNS UUID LANGUAGE SQL AS $$
  SELECT binding.conversation_id FROM platform_private.waha_direct_chat_bindings binding
  WHERE binding.organization_id = pg_temp.a320_id(1) AND binding.normalized_chat_id = '7996770' || lpad(p_chat::TEXT, 4, '0') || '@c.us'
$$;
SELECT pg_temp.a320_in(1, 'Здравствуйте, хочу учиться в Китае', 7200) AS a320_m1 \gset
SELECT pg_temp.a320_in(1, 'Сколько стоит обучение?', 7100) AS a320_m2 \gset
SELECT pg_temp.a320_in(2, 'Добрый день, интересует Малайзия', 6200) AS a320_m3 \gset
SELECT pg_temp.a320_in(3, 'Привет, как поступить?', 5200) AS a320_m4 \gset
SELECT pg_temp.a320_conv(1) AS a320_c1 \gset
SELECT pg_temp.a320_conv(2) AS a320_c2 \gset
SELECT pg_temp.a320_conv(3) AS a320_c3 \gset
SELECT pg_temp.a320_assert(:'a320_c1' IS NOT NULL AND :'a320_c2' IS NOT NULL AND :'a320_c3' IS NOT NULL
  AND :'a320_c1' <> :'a320_c2' AND :'a320_c2' <> :'a320_c3',
  'fixture: three WhatsApp conversations through the real projection chain');

-- Seeded rows (owner, triggers off): clients, leads, cases, a document, the chat of the case.
SET LOCAL session_replication_role = replica;
INSERT INTO platform.clients (id, organization_id, display_name, normalized_name, email, normalized_email, phone, normalized_phone,
  lifecycle_state, created_at, updated_at)
SELECT c.id, c.org, c.name, platform_private.normalize_person_name(c.name), c.email,
  platform_private.normalize_person_email(c.email), c.phone, platform_private.normalize_person_phone(c.phone), 'active', c.created, c.created
FROM (VALUES
  (pg_temp.a320_id(501), pg_temp.a320_id(1), 'A320 Клиент Один', 'a320.client1@example.invalid', '+996555320001', clock_timestamp() - INTERVAL '10 days'),
  (pg_temp.a320_id(502), pg_temp.a320_id(1), 'A320 Клиент Два', 'a320.client2@example.invalid', '+996555320002', clock_timestamp() - INTERVAL '12 days'),
  (pg_temp.a320_id(503), pg_temp.a320_id(1), 'A320 Клиент Пять', 'a320.client5@example.invalid', '+996555320005', clock_timestamp() - INTERVAL '9 days'),
  (pg_temp.a320_id(504), pg_temp.a320_id(2), 'A320 Чужой Клиент', NULL::TEXT, '+996555320003', clock_timestamp() - INTERVAL '1 day'),
  (pg_temp.a320_id(505), pg_temp.a320_id(1), 'A320 Клиент Шесть', NULL::TEXT, '+996555320006', clock_timestamp() - INTERVAL '6 days')
) AS c(id, org, name, email, phone, created);
INSERT INTO platform.leads (id, organization_id, client_id, current_owner_membership_id, stage_key, source_key, lifecycle_state,
  interest_direction, created_at, updated_at) VALUES
  (pg_temp.a320_id(601), pg_temp.a320_id(1), pg_temp.a320_id(501), pg_temp.a320_id(301), 'qualified', 'website', 'open', 'CN',
    clock_timestamp() - INTERVAL '5 days', clock_timestamp() - INTERVAL '1 day'),
  (pg_temp.a320_id(602), pg_temp.a320_id(1), pg_temp.a320_id(502), pg_temp.a320_id(301), 'new', 'whatsapp', 'open', 'MY',
    clock_timestamp() - INTERVAL '12 days', clock_timestamp() - INTERVAL '10 days'),
  (pg_temp.a320_id(603), pg_temp.a320_id(1), pg_temp.a320_id(503), pg_temp.a320_id(301), 'qualified', 'website', 'open', 'CN',
    clock_timestamp() - INTERVAL '9 days', clock_timestamp() - INTERVAL '8 days'),
  (pg_temp.a320_id(604), pg_temp.a320_id(2), pg_temp.a320_id(504), NULL, 'new', 'website', 'open', 'CN',
    clock_timestamp() - INTERVAL '1 day', clock_timestamp() - INTERVAL '1 day');
INSERT INTO platform.student_cases (id, organization_id, student_membership_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, program_direction, intake, operational_stage, state, handoff_at, closed_at,
  current_scope_id, current_scope_version, admissions_direction, pipeline_stage, canonical_client_id, canonical_lead_id, next_action,
  created_at, updated_at) VALUES
  (pg_temp.a320_id(701), pg_temp.a320_id(1), pg_temp.a320_id(302), pg_temp.a320_id(301), pg_temp.a320_id(301), 'a320-case-1',
    'A320 Клиент Один', 'China', 'bachelor', 'CN', '2027-09', 'intake', 'active', clock_timestamp() - INTERVAL '3 days', NULL,
    pg_temp.a320_id(401), 1, 'CN', 'documents', pg_temp.a320_id(501), pg_temp.a320_id(601), 'Собрать документы',
    clock_timestamp() - INTERVAL '4 days', clock_timestamp() - INTERVAL '1 hour'),
  (pg_temp.a320_id(702), pg_temp.a320_id(1), NULL, pg_temp.a320_id(301), NULL, 'a320-case-2',
    'A320 Клиент Два', 'Malaysia', 'master', 'MY', '2027-02', 'intake', 'pending', NULL, NULL,
    pg_temp.a320_id(401), 1, 'MY', 'new', pg_temp.a320_id(502), pg_temp.a320_id(602), NULL,
    clock_timestamp() - INTERVAL '3 days', clock_timestamp() - INTERVAL '2 hours'),
  (pg_temp.a320_id(703), pg_temp.a320_id(2), NULL, pg_temp.a320_id(303), NULL, 'a320-case-3',
    'A320 Чужой Студент', 'China', 'bachelor', 'CN', NULL, 'intake', 'pending', NULL, NULL,
    pg_temp.a320_id(402), 1, 'CN', 'new', pg_temp.a320_id(504), pg_temp.a320_id(604), NULL,
    clock_timestamp() - INTERVAL '1 day', clock_timestamp() - INTERVAL '1 day'),
  -- A second case of student 2 that knows its client only (no lead): the chat of that client follows student 2.
  (pg_temp.a320_id(705), pg_temp.a320_id(1), pg_temp.a320_id(302), pg_temp.a320_id(301), NULL, 'a320-case-5',
    'A320 Клиент Шесть', 'Malaysia', 'bachelor', 'MY', NULL, 'intake', 'pending', NULL, NULL,
    pg_temp.a320_id(401), 1, 'MY', 'new', pg_temp.a320_id(505), NULL, NULL,
    clock_timestamp() - INTERVAL '2 days', clock_timestamp() - INTERVAL '2 hours'),
  (pg_temp.a320_id(704), pg_temp.a320_id(1), pg_temp.a320_id(305), pg_temp.a320_id(301), pg_temp.a320_id(301), 'a320-case-4',
    'A320 Клиент Пять', 'China', 'bachelor', 'CN', '2027-09', 'intake', 'active', clock_timestamp() - INTERVAL '3 days', NULL,
    pg_temp.a320_id(401), 1, 'CN', 'documents', pg_temp.a320_id(503), pg_temp.a320_id(603), NULL,
    clock_timestamp() - INTERVAL '4 days', clock_timestamp() - INTERVAL '1 hour');
UPDATE platform.communication_conversations SET canonical_client_id = pg_temp.a320_id(501), canonical_lead_id = pg_temp.a320_id(601)
  WHERE id = :'a320_c1'::UUID;
UPDATE platform.communication_conversations SET canonical_client_id = pg_temp.a320_id(502), canonical_lead_id = pg_temp.a320_id(602)
  WHERE id = :'a320_c3'::UUID;
INSERT INTO platform.document_requirements (id, organization_id, target_country, target_degree, program_direction, checklist_version,
  requirement_key, label, instructions, created_by_membership_id) VALUES
  (pg_temp.a320_id(801), pg_temp.a320_id(1), 'China', 'bachelor', 'CN', 1, 'passport', 'Паспорт', 'Скан разворота', pg_temp.a320_id(301));
INSERT INTO platform.document_slots (id, organization_id, student_case_id, requirement_id, status, deadline, current_version_id,
  current_version_no, created_by_membership_id, created_at, updated_at, intent_kind, display_label, group_label) VALUES
  (pg_temp.a320_id(811), pg_temp.a320_id(1), pg_temp.a320_id(701), pg_temp.a320_id(801), 'approved', NULL, pg_temp.a320_id(821), 1,
    pg_temp.a320_id(301), clock_timestamp() - INTERVAL '3 days', clock_timestamp() - INTERVAL '1 day', 'baseline', NULL, NULL);
INSERT INTO platform.document_versions (id, organization_id, student_case_id, document_slot_id, version_no, original_filename, declared_mime_type,
  byte_size, sha256_hex, ingest_evidence_ref, submitted_by_membership_id, integrity_status, malware_status, malware_scan_attestation_id, created_at) VALUES
  (pg_temp.a320_id(821), pg_temp.a320_id(1), pg_temp.a320_id(701), pg_temp.a320_id(811), 1, 'passport.pdf', 'application/pdf', 12345,
    repeat('a', 64), 'ev:821', pg_temp.a320_id(302), 'verified', 'clean', pg_temp.a320_id(861), clock_timestamp() - INTERVAL '2 days');
INSERT INTO platform_private.document_storage_bindings (id, organization_id, student_case_id, document_slot_id, document_version_id,
  upload_reservation_id, bucket_id, object_name) VALUES
  (pg_temp.a320_id(831), pg_temp.a320_id(1), pg_temp.a320_id(701), pg_temp.a320_id(811), pg_temp.a320_id(821), pg_temp.a320_id(841),
    'platform-documents', 'aa/' || repeat('1', 62));
INSERT INTO platform.case_chat_messages (id, organization_id, student_case_id, author_membership_id, body, created_at) VALUES
  (pg_temp.a320_id(1061), pg_temp.a320_id(1), pg_temp.a320_id(701), pg_temp.a320_id(302), 'Какие документы ещё нужны?', clock_timestamp() - INTERVAL '90 minutes'),
  (pg_temp.a320_id(1062), pg_temp.a320_id(1), pg_temp.a320_id(701), pg_temp.a320_id(301), 'Пришлите аттестат, пожалуйста.', clock_timestamp() - INTERVAL '60 minutes');
SET LOCAL session_replication_role = origin;

-- The first read creates the 7 agents of each organization; the sales agent is switched on.
SELECT pg_temp.a320_as(1, format('SELECT platform.ai_agents_list_v1(%L)', pg_temp.a320_id(1))) AS a320_list1 \gset
SELECT pg_temp.a320_assert(jsonb_array_length((:'a320_list1'::JSONB) -> 'agents') = 7, 'the first read seeds 7 agents');
SELECT pg_temp.a320_as(1, format('SELECT platform.ai_agents_update_v1(%L, %L, %s, %L::jsonb, %L)', pg_temp.a320_id(1), 'sales',
  (SELECT config_version FROM platform_private.ai_agents WHERE organization_id = pg_temp.a320_id(1) AND key = 'sales'),
  '{"enabled":true}', pg_temp.a320_id(2001))) AS a320_u1 \gset
SELECT pg_temp.a320_assert((:'a320_u1'::JSONB) ? 'configVersion', 'the sales agent is enabled: ' || :'a320_u1');

-- ---------------------------------------------------------------------------
-- 1. Posture.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a320_assert(
  (SELECT c.relrowsecurity AND c.relforcerowsecurity FROM pg_class c WHERE c.oid = 'platform_private.student_ai_consents'::REGCLASS)
  AND NOT has_table_privilege('authenticated', 'platform_private.student_ai_consents', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'platform_private.student_ai_consents', 'INSERT')
  AND NOT has_table_privilege('service_role', 'platform_private.student_ai_consents', 'SELECT')
  AND NOT has_table_privilege('anon', 'platform_private.student_ai_consents', 'SELECT')
  AND NOT has_table_privilege('supabase_auth_admin', 'platform_private.student_ai_consents', 'SELECT'),
  '320 posture: the consent table is closed to every API role with row security forced');
SELECT pg_temp.a320_assert(
  (SELECT count(*) = 3 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform' AND p.proname IN ('portal_ai_consent_get_v1', 'portal_ai_consent_set_v1', 'staff_student_ai_consent_v1')
      AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[]
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE') AND NOT has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE'))
  AND (SELECT count(*) = 6 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform_private' AND p.proname IN ('student_ai_consent_policy_version', 'student_ai_consent_state',
      'student_ai_consent_org', 'student_case_ai_consent', 'ai_agent_student_ai_allowed', 'ai_agent_conversation_ai_allowed')
      AND p.proconfig = ARRAY['search_path=""']::TEXT[]
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')),
  '320 posture: three definer RPCs for authenticated only; six closed helpers; empty search_path everywhere');
SELECT pg_temp.a320_assert(
  (SELECT count(*) = 24 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'platform' AND p.proname LIKE 'ai\_agent\_tool\_%'
     AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[]
     AND has_function_privilege('service_role', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
  AND (SELECT count(*) = 3 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'platform' AND p.proname LIKE 'ai\_agent\_mcp\_%'
     AND p.prosecdef AND has_function_privilege('service_role', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  'the tool family keeps its number and its grants: 24 tools, 3 MCP functions (service_role only)');
SELECT pg_temp.a320_assert(
  (SELECT count(*) = 3 FROM pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE
     AND p.proname IN ('ai_agent_tool_get_document_file_v1', 'ai_agent_tool_get_case_chat_v1', 'ai_agent_mcp_file_resolve_v1')
     AND strpos(p.prosrc, 'ai_agent_student_ai_allowed(') > 0)
  AND (SELECT count(*) = 2 FROM pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE
     AND p.proname IN ('ai_agent_tool_get_conversation_v1', 'ai_agent_tool_list_conversations_v1')
     AND strpos(p.prosrc, 'ai_agent_conversation_ai_allowed(') > 0)
  AND (SELECT strpos(p.prosrc, 'ai_agent_audit_read(') > 0 FROM pg_proc p WHERE p.oid = 'platform.ai_agent_tool_get_case_chat_v1(uuid,text,jsonb)'::REGPROCEDURE),
  'bodies: the check in the five replaced functions, the 319 audit still in the reads');
SELECT pg_temp.a320_assert(platform_private.student_ai_consent_policy_version() = '2026-10-25',
  'the current policy version is 2026-10-25');

-- ---------------------------------------------------------------------------
-- 2. The student RPCs.
-- ---------------------------------------------------------------------------
-- Only about oneself, only a student: anon, service_role, no claims, staff and a foreign organization's admin are refused.
SELECT pg_temp.a320_assert(
  pg_temp.a320_err(pg_temp.a320_anon('SELECT platform.portal_ai_consent_get_v1()')) = '42501'
  AND pg_temp.a320_err(pg_temp.a320_svc('SELECT platform.portal_ai_consent_get_v1()')) = '42501'
  AND pg_temp.a320_err(pg_temp.a320_call('authenticated', '', 'SELECT platform.portal_ai_consent_get_v1()')) = '42501'
  AND pg_temp.a320_msg(pg_temp.a320_call('authenticated', '', 'SELECT platform.portal_ai_consent_get_v1()')) = 'ai_consent_unavailable'
  AND pg_temp.a320_msg(pg_temp.a320_get(1)) = 'ai_consent_unavailable' AND pg_temp.a320_msg(pg_temp.a320_get(3)) = 'ai_consent_unavailable'
  AND pg_temp.a320_err(pg_temp.a320_set(1, 'granted', '2026-10-25', 'ios', 3001)) = '42501'
  AND pg_temp.a320_err(pg_temp.a320_anon(format('SELECT platform.portal_ai_consent_set_v1(%L, %L, %L, %L)', 'granted', '2026-10-25', 'ios', pg_temp.a320_id(3001)))) = '42501'
  AND pg_temp.a320_err(pg_temp.a320_svc(format('SELECT platform.portal_ai_consent_set_v1(%L, %L, %L, %L)', 'granted', '2026-10-25', 'ios', pg_temp.a320_id(3001)))) = '42501'
  AND (SELECT count(*) = 0 FROM platform_private.student_ai_consents),
  'the student RPCs refuse anon, service_role, no claims and staff (an Admin of this or another organization); nothing is written');

-- An empty state for a student who was never asked.
SELECT pg_temp.a320_get(2) AS a320_g0 \gset
SELECT pg_temp.a320_assert((:'a320_g0'::JSONB) = '{"status": null, "policyVersion": null, "decidedAt": null, "currentPolicyVersion": "2026-10-25"}'::JSONB,
  'a student never asked reads {null, null, null, current}: ' || :'a320_g0');

-- Wrong input is refused before anything is written.
SELECT pg_temp.a320_assert(
  pg_temp.a320_msg(pg_temp.a320_set(2, 'maybe', '2026-10-25', 'portal_web', 3002)) = 'ai_consent_invalid_status'
  AND pg_temp.a320_err(pg_temp.a320_set(2, 'maybe', '2026-10-25', 'portal_web', 3002)) = '22023'
  AND pg_temp.a320_msg(pg_temp.a320_set(2, NULL, '2026-10-25', 'portal_web', 3002)) = 'ai_consent_invalid_status'
  AND pg_temp.a320_msg(pg_temp.a320_set(2, 'granted', '2026-10-25', 'android', 3002)) = 'ai_consent_invalid_source'
  AND pg_temp.a320_msg(pg_temp.a320_set(2, 'granted', '2026-10-25', NULL, 3002)) = 'ai_consent_invalid_source'
  AND pg_temp.a320_msg(pg_temp.a320_set(2, 'granted', '2026-01-01', 'portal_web', 3002)) = 'ai_consent_policy_version_mismatch'
  AND pg_temp.a320_msg(pg_temp.a320_set(2, 'granted', NULL, 'portal_web', 3002)) = 'ai_consent_policy_version_mismatch'
  AND pg_temp.a320_err(pg_temp.a320_set(2, 'granted', '2099-12-31', 'portal_web', 3002)) = '22023'
  AND pg_temp.a320_msg(pg_temp.a320_set(2, 'granted', '2026-10-25', 'portal_web', NULL)) = 'ai_consent_invalid_request'
  AND (SELECT count(*) = 0 FROM platform_private.student_ai_consents)
  AND (SELECT count(*) = 0 FROM platform.audit_events WHERE action LIKE 'ai.consent.%'),
  'a wrong status, source, version or request id is refused with 22023 and nothing is written');

-- A grant: one row, one journal event (system actor, state and version only).
SELECT pg_temp.a320_set(2, 'granted', '2026-10-25', 'portal_web', 3003) AS a320_s1 \gset
SELECT pg_temp.a320_assert(
  (:'a320_s1'::JSONB) ->> 'status' = 'granted' AND (:'a320_s1'::JSONB) ->> 'policyVersion' = '2026-10-25'
  AND (:'a320_s1'::JSONB) ->> 'currentPolicyVersion' = '2026-10-25' AND (:'a320_s1'::JSONB) ->> 'decidedAt' IS NOT NULL
  AND (SELECT count(*) = 1 AND bool_and(k.status = 'granted' AND k.source = 'portal_web' AND k.organization_id = pg_temp.a320_id(1)
      AND k.auth_user_id = pg_temp.a320_id(102)) FROM platform_private.student_ai_consents k)
  AND (SELECT count(*) = 1 AND bool_and(e.action = 'ai.consent.grant' AND e.resource_type = 'student_ai_consent'
      AND e.actor_kind = 'system' AND e.actor_principal = 'auth:' || pg_temp.a320_id(102)::TEXT AND e.actor_profile_id IS NULL
      AND e.organization_id = pg_temp.a320_id(1) AND e.before_state IS NULL
      AND e.after_state = '{"status":"granted","policy_version":"2026-10-25","source":"portal_web"}'::JSONB)
    FROM platform.audit_events e WHERE e.action LIKE 'ai.consent.%')
  AND (SELECT e.resource_id = k.id FROM platform.audit_events e, platform_private.student_ai_consents k WHERE e.action = 'ai.consent.grant'),
  'a grant writes one row and one journal event about it, with the state, the version and the source only: ' || :'a320_s1');
SELECT pg_temp.a320_get(2) AS a320_g1 \gset
SELECT pg_temp.a320_assert((:'a320_g1'::JSONB) = (:'a320_s1'::JSONB), 'get reads what set returned: ' || :'a320_g1');

-- Replay of the same request: the same answer, no second event, the time is not renewed.
SELECT pg_temp.a320_set(2, 'granted', '2026-10-25', 'portal_web', 3003) AS a320_s1b \gset
SELECT pg_temp.a320_assert((:'a320_s1b'::JSONB) = (:'a320_s1'::JSONB)
  AND (SELECT count(*) = 1 FROM platform.audit_events WHERE action LIKE 'ai.consent.%')
  AND (SELECT count(*) = 1 FROM platform_private.student_ai_consents),
  'the same request again is the same answer, one event, one row');
-- The same decision again under a NEW request id is no change: no event, the decision time stays.
SELECT pg_temp.a320_set(2, 'granted', '2026-10-25', 'ios', 3004) AS a320_s1c \gset
SELECT pg_temp.a320_assert((:'a320_s1c'::JSONB) = (:'a320_s1'::JSONB)
  AND (SELECT count(*) = 1 FROM platform.audit_events WHERE action LIKE 'ai.consent.%')
  AND (SELECT source = 'portal_web' FROM platform_private.student_ai_consents),
  'the same status on the same version again is no change: no event, the source and the time stay');

-- A decline replaces the row (one row per student) and writes the second event with the previous state.
SELECT pg_temp.a320_set(2, 'declined', '2026-10-25', 'ios', 3005) AS a320_s2 \gset
SELECT pg_temp.a320_assert(
  (:'a320_s2'::JSONB) ->> 'status' = 'declined' AND (:'a320_s2'::JSONB) ->> 'decidedAt' <> (:'a320_s1'::JSONB) ->> 'decidedAt'
  AND (SELECT count(*) = 1 AND bool_and(k.status = 'declined' AND k.source = 'ios') FROM platform_private.student_ai_consents k)
  AND (SELECT count(*) = 2 FROM platform.audit_events WHERE action LIKE 'ai.consent.%')
  AND (SELECT e.before_state = '{"status":"granted","policy_version":"2026-10-25"}'::JSONB
        AND e.after_state = '{"status":"declined","policy_version":"2026-10-25","source":"ios"}'::JSONB
        AND e.actor_kind = 'system'
      FROM platform.audit_events e WHERE e.action = 'ai.consent.decline'),
  'a decline replaces the single row and writes one event with the previous state: ' || :'a320_s2');
-- A stale replay of the first request (after the later decision) neither flips the decision nor writes an event.
SELECT pg_temp.a320_set(2, 'granted', '2026-10-25', 'portal_web', 3003) AS a320_s1d \gset
SELECT pg_temp.a320_assert((:'a320_s1d'::JSONB) = (:'a320_s2'::JSONB)
  AND (SELECT status = 'declined' FROM platform_private.student_ai_consents)
  AND (SELECT count(*) = 2 FROM platform.audit_events WHERE action LIKE 'ai.consent.%'),
  'a stale replay of an old request returns the CURRENT state and does not flip it');
-- Reusing a request id for another decision is a conflict (55000).
SELECT pg_temp.a320_assert(
  pg_temp.a320_err(pg_temp.a320_set(2, 'granted', '2026-10-25', 'ios', 3005)) = '55000'
  AND pg_temp.a320_msg(pg_temp.a320_set(2, 'granted', '2026-10-25', 'ios', 3005)) = 'ai_consent_request_conflict'
  AND pg_temp.a320_err(pg_temp.a320_set(2, 'declined', '2026-10-25', 'portal_web', 3005)) = '55000'
  AND (SELECT status = 'declined' FROM platform_private.student_ai_consents),
  'the same request id with another decision or source is a conflict and changes nothing');

-- A decision on an older policy version is read back as stored (the client compares the version) and a new decision replaces it.
UPDATE platform_private.student_ai_consents SET status = 'granted', policy_version = '2025-01-01';
SELECT pg_temp.a320_get(2) AS a320_g2 \gset
SELECT pg_temp.a320_assert((:'a320_g2'::JSONB) ->> 'status' = 'granted' AND (:'a320_g2'::JSONB) ->> 'policyVersion' = '2025-01-01'
  AND (:'a320_g2'::JSONB) ->> 'currentPolicyVersion' = '2026-10-25', 'an old-version decision is read back as stored: ' || :'a320_g2');
SELECT pg_temp.a320_set(2, 'granted', '2026-10-25', 'portal_web', 3006) AS a320_s3 \gset
SELECT pg_temp.a320_assert((:'a320_s3'::JSONB) ->> 'status' = 'granted' AND (:'a320_s3'::JSONB) ->> 'policyVersion' = '2026-10-25'
  AND (SELECT count(*) = 3 FROM platform.audit_events WHERE action LIKE 'ai.consent.%')
  AND (SELECT e.before_state = '{"status":"granted","policy_version":"2025-01-01"}'::JSONB FROM platform.audit_events e
      WHERE e.request_id = public.uuid_generate_v5((SELECT id FROM platform_private.student_ai_consents), 'ai.consent.set:' || pg_temp.a320_id(3006)::TEXT)),
  'granting again on the current version replaces the old-version decision and is one more event');

-- The same identity as the account deletion: an applicant without a profile or a membership reaches the single анкета organization.
SELECT pg_temp.a320_get(6) AS a320_g6 \gset
SELECT pg_temp.a320_set(6, 'declined', '2026-10-25', 'ios', 3007) AS a320_s6 \gset
SELECT pg_temp.a320_assert((:'a320_g6'::JSONB) ->> 'status' IS NULL AND (:'a320_s6'::JSONB) ->> 'status' = 'declined'
  AND (SELECT k.organization_id = pg_temp.a320_id(1) AND k.auth_user_id = pg_temp.a320_id(106)
    FROM platform_private.student_ai_consents k WHERE k.auth_user_id = pg_temp.a320_id(106)),
  'an applicant (no membership) decides in the organization of the анкета, exactly as the account deletion resolves it');
-- The journal only grows, so a student may change the decision at most 20 times an hour (the first decision above is one of them).
CREATE FUNCTION pg_temp.a320_flip(p_from INTEGER, p_to INTEGER) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE r JSONB; ok INTEGER := 0; last_error TEXT;
BEGIN
  FOR i IN p_from..p_to LOOP
    r := pg_temp.a320_set(6, CASE WHEN i % 2 = 0 THEN 'granted' ELSE 'declined' END, '2026-10-25', 'ios', 4000 + i);
    IF r ? 'error' THEN last_error := r ->> 'error' || ':' || (r ->> 'message'); ELSE ok := ok + 1; END IF;
  END LOOP;
  RETURN ok || '/' || COALESCE(last_error, '');
END
$$;
SELECT pg_temp.a320_flip(2, 20) AS a320_flip_ok, pg_temp.a320_flip(21, 21) AS a320_flip_limited \gset
SELECT pg_temp.a320_assert(:'a320_flip_ok' = '19/' AND :'a320_flip_limited' = '0/54000:ai_consent_rate_limited'
  AND (SELECT count(*) = 20 FROM platform.audit_events e JOIN platform_private.student_ai_consents k ON k.id = e.resource_id
      WHERE k.auth_user_id = pg_temp.a320_id(106) AND e.action LIKE 'ai.consent.%'),
  'twenty changes in an hour are allowed, the twenty-first is refused with 54000 and writes nothing: ' || :'a320_flip_ok' || ' / ' || :'a320_flip_limited');
-- A replay of an accepted request and the same decision again are still answered when the limit is reached (they write nothing).
SELECT pg_temp.a320_assert(NOT (pg_temp.a320_set(6, 'declined', '2026-10-25', 'ios', 4019) ? 'error'),
  'a replay of an accepted request is answered at the limit');
DELETE FROM platform_private.student_ai_consents WHERE auth_user_id = pg_temp.a320_id(106);

-- ---------------------------------------------------------------------------
-- 3. The enforcement helper, case by case. Case 701: student 2 has a portal account (active student membership).
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.a320_allowed(p_case INTEGER) RETURNS BOOLEAN LANGUAGE SQL AS $$
  SELECT platform_private.ai_agent_student_ai_allowed(pg_temp.a320_id(1), pg_temp.a320_id(p_case))
$$;
CREATE FUNCTION pg_temp.a320_conv_allowed(p_conv UUID) RETURNS BOOLEAN LANGUAGE SQL AS $$
  SELECT platform_private.ai_agent_conversation_ai_allowed(pg_temp.a320_id(1), p_conv)
$$;
-- The row of student 2 as the owner sets it (the RPC path is proven above).
CREATE FUNCTION pg_temp.a320_put(p_actor INTEGER, p_status TEXT, p_version TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM platform_private.student_ai_consents WHERE auth_user_id = pg_temp.a320_id(100 + p_actor);
  IF p_status IS NOT NULL THEN
    INSERT INTO platform_private.student_ai_consents(organization_id, auth_user_id, status, policy_version, source)
    VALUES (pg_temp.a320_id(1), pg_temp.a320_id(100 + p_actor), p_status, p_version, 'portal_web');
  END IF;
END
$$;

SELECT pg_temp.a320_put(2, NULL, NULL);
SELECT pg_temp.a320_assert(pg_temp.a320_allowed(701) = FALSE, 'student with a portal account, not asked: NOT allowed');
SELECT pg_temp.a320_put(2, 'granted', '2026-10-25');
SELECT pg_temp.a320_assert(pg_temp.a320_allowed(701) = TRUE, 'student with a portal account, granted on the current version: allowed');
SELECT pg_temp.a320_put(2, 'declined', '2026-10-25');
SELECT pg_temp.a320_assert(pg_temp.a320_allowed(701) = FALSE, 'student with a portal account, declined: NOT allowed');
SELECT pg_temp.a320_put(2, 'declined', '2025-01-01');
SELECT pg_temp.a320_assert(pg_temp.a320_allowed(701) = FALSE, 'declined on an older version is still a decline: NOT allowed');
SELECT pg_temp.a320_put(2, 'granted', '2025-01-01');
SELECT pg_temp.a320_assert(pg_temp.a320_allowed(701) = FALSE, 'granted on an OLDER version counts as not decided: NOT allowed');
-- A student without a portal account (no membership on the case; a suspended membership): allowed unless declined.
SELECT pg_temp.a320_assert(pg_temp.a320_allowed(702) = TRUE, 'a case with no student membership (no portal account): allowed on the contract / policy basis');
SELECT pg_temp.a320_assert(pg_temp.a320_allowed(704) = TRUE, 'a case whose student membership is suspended (no active portal account), not asked: allowed');
SELECT pg_temp.a320_put(5, 'declined', '2026-10-25');
SELECT pg_temp.a320_assert(pg_temp.a320_allowed(704) = FALSE, 'a decline is honoured even when the membership is no longer active');
SELECT pg_temp.a320_put(5, 'granted', '2025-01-01');
SELECT pg_temp.a320_assert(pg_temp.a320_allowed(704) = TRUE, 'granted on an old version, no active portal account: allowed');
SELECT pg_temp.a320_put(5, NULL, NULL);
-- Unknown, foreign and empty cases fail closed.
SELECT pg_temp.a320_assert(
  platform_private.ai_agent_student_ai_allowed(pg_temp.a320_id(1), pg_temp.a320_id(9999)) = FALSE
  AND platform_private.ai_agent_student_ai_allowed(pg_temp.a320_id(1), pg_temp.a320_id(703)) = FALSE
  AND platform_private.ai_agent_student_ai_allowed(pg_temp.a320_id(2), pg_temp.a320_id(701)) = FALSE
  AND platform_private.ai_agent_student_ai_allowed(NULL, NULL) = FALSE,
  'an unknown case, a case of another organization and null arguments are refused (fail closed)');
-- Conversations: c1 is linked to the client and the lead of case 701; c3 to those of case 702; c2 to nobody.
SELECT pg_temp.a320_put(2, NULL, NULL);
SELECT pg_temp.a320_assert(
  pg_temp.a320_conv_allowed(:'a320_c1'::UUID) = FALSE AND pg_temp.a320_conv_allowed(:'a320_c2'::UUID) = TRUE
  AND pg_temp.a320_conv_allowed(:'a320_c3'::UUID) = TRUE AND pg_temp.a320_conv_allowed(pg_temp.a320_id(9999)) = TRUE,
  'a chat linked to a student with a portal account who has not allowed is NOT allowed; a chat of a lead without a student, and the chat of a student without a portal account, are allowed');
SELECT pg_temp.a320_put(2, 'granted', '2026-10-25');
SELECT pg_temp.a320_assert(pg_temp.a320_conv_allowed(:'a320_c1'::UUID) = TRUE, 'the linked chat is allowed once the student allows');
-- Linked by the case itself (a curator-queue chat of the case), by the client only, and by the lead only.
SET LOCAL session_replication_role = replica;
UPDATE platform.communication_conversations SET queue = 'curator', current_curator_membership_id = pg_temp.a320_id(301),
  student_case_id = pg_temp.a320_id(701), sales_authority_source = 'provider_linked', amocrm_account_id = 3200, amocrm_lead_id = 3201,
  amocrm_contact_id = 3202, canonical_client_id = NULL, canonical_lead_id = NULL
  WHERE id = :'a320_c2'::UUID;
SET LOCAL session_replication_role = origin;
SELECT pg_temp.a320_put(2, 'declined', '2026-10-25');
SELECT pg_temp.a320_assert(pg_temp.a320_conv_allowed(:'a320_c2'::UUID) = FALSE, 'a chat linked by student_case_id follows the student of that case');
SELECT pg_temp.a320_put(2, 'granted', '2026-10-25');
SELECT pg_temp.a320_assert(pg_temp.a320_conv_allowed(:'a320_c2'::UUID) = TRUE, 'and is allowed once that student allows');
SET LOCAL session_replication_role = replica;
UPDATE platform.communication_conversations SET queue = 'sales', current_curator_membership_id = NULL, student_case_id = NULL,
  sales_authority_source = 'platform_intake', amocrm_account_id = NULL, amocrm_lead_id = NULL, amocrm_contact_id = NULL,
  canonical_client_id = pg_temp.a320_id(505), canonical_lead_id = NULL
  WHERE id = :'a320_c2'::UUID;
SET LOCAL session_replication_role = origin;
SELECT pg_temp.a320_put(2, 'declined', '2026-10-25');
SELECT pg_temp.a320_assert(pg_temp.a320_conv_allowed(:'a320_c2'::UUID) = FALSE, 'a chat linked only by the client follows the cases of that client (a case with no lead)');
SELECT pg_temp.a320_put(2, 'granted', '2026-10-25');
SELECT pg_temp.a320_assert(pg_temp.a320_conv_allowed(:'a320_c2'::UUID) = TRUE, 'and is allowed once that student allows');
SELECT pg_temp.a320_put(2, 'declined', '2026-10-25');
UPDATE platform.communication_conversations SET canonical_client_id = pg_temp.a320_id(501), canonical_lead_id = NULL WHERE id = :'a320_c2'::UUID;
SELECT pg_temp.a320_assert(pg_temp.a320_conv_allowed(:'a320_c2'::UUID) = FALSE, 'a chat linked only by the client reaches the case through the lead of the client too');
UPDATE platform.communication_conversations SET canonical_client_id = NULL, canonical_lead_id = pg_temp.a320_id(601)
  WHERE id = :'a320_c2'::UUID;
SELECT pg_temp.a320_assert(pg_temp.a320_conv_allowed(:'a320_c2'::UUID) = FALSE, 'a chat linked only by the lead follows the cases of that lead');
-- A chat linked ONLY by a lead (no client of its own), where that lead's client belongs to a case that knows its client only
-- (case 705, student 2, no lead): the client comes from the lead of the chat, so the chat follows that case too.
SET LOCAL session_replication_role = replica;
INSERT INTO platform.leads (id, organization_id, client_id, current_owner_membership_id, stage_key, source_key, lifecycle_state,
  interest_direction, created_at, updated_at) VALUES
  (pg_temp.a320_id(605), pg_temp.a320_id(1), pg_temp.a320_id(505), pg_temp.a320_id(301), 'new', 'whatsapp', 'open', 'MY',
    clock_timestamp() - INTERVAL '2 days', clock_timestamp() - INTERVAL '2 days');
UPDATE platform.communication_conversations SET canonical_client_id = NULL, canonical_lead_id = pg_temp.a320_id(605)
  WHERE id = :'a320_c2'::UUID;
SET LOCAL session_replication_role = origin;
SELECT pg_temp.a320_put(2, 'declined', '2026-10-25');
SELECT pg_temp.a320_assert(pg_temp.a320_conv_allowed(:'a320_c2'::UUID) = FALSE,
  'a chat linked only by a lead whose client has a case linked by client only follows that case (the client comes from the lead of the chat)');
SELECT pg_temp.a320_put(2, 'granted', '2026-10-25');
SELECT pg_temp.a320_assert(pg_temp.a320_conv_allowed(:'a320_c2'::UUID) = TRUE, 'and is allowed once that student allows');
UPDATE platform.communication_conversations SET canonical_client_id = NULL, canonical_lead_id = NULL WHERE id = :'a320_c2'::UUID;
SET LOCAL session_replication_role = replica;
DELETE FROM platform.leads WHERE id = pg_temp.a320_id(605);
SET LOCAL session_replication_role = origin;
SELECT pg_temp.a320_assert(pg_temp.a320_conv_allowed(:'a320_c2'::UUID) = TRUE, 'unlinked again: allowed');

-- ---------------------------------------------------------------------------
-- 4. The tools. Student 2 / case 701 / chat c1 / document 821. Counts first.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.a320_reads() RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT count(*) FROM platform.audit_events WHERE action IN ('ai.agent.tool.read', 'ai.agent.document.read')
$$;
CREATE FUNCTION pg_temp.a320_grants() RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT count(*) FROM platform_private.ai_agent_file_grants
$$;
CREATE FUNCTION pg_temp.a320_chat(p_case INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a320_tool('get_case_chat', 'sales', format('{"case_id":"%s"}', pg_temp.a320_id(p_case)))
$$;
CREATE FUNCTION pg_temp.a320_file() RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a320_tool('get_document_file', 'sales', format('{"document_version_id":"%s"}', pg_temp.a320_id(821)))
$$;
CREATE FUNCTION pg_temp.a320_conv_read(p_conv UUID) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a320_tool('get_conversation', 'sales', format('{"conversation_id":"%s"}', p_conv))
$$;
CREATE FUNCTION pg_temp.a320_list() RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a320_tool('list_conversations', 'sales', '{"filter":"all","queue":"all"}')
$$;
CREATE FUNCTION pg_temp.a320_preview(p_list JSONB, p_conv UUID) RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT i FROM jsonb_array_elements(p_list -> 'items') i WHERE i ->> 'conversation_id' = p_conv::TEXT
$$;
SELECT pg_temp.a320_reads() AS a320_reads0, pg_temp.a320_grants() AS a320_grants0 \gset

-- Not asked / declined / granted on an older version: the three reads answer ai_consent_missing and give nothing.
CREATE FUNCTION pg_temp.a320_refused(p_what TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE r JSONB;
BEGIN
  FOR r IN SELECT * FROM unnest(ARRAY[pg_temp.a320_chat(701), pg_temp.a320_file(), pg_temp.a320_conv_read(pg_temp.a320_conv(1))]) LOOP
    PERFORM pg_temp.a320_assert(r ->> 'error' = '42501' AND r ->> 'message' = 'ai_consent_missing', p_what || ' must answer ai_consent_missing: ' || r::TEXT);
  END LOOP;
END
$$;
SELECT pg_temp.a320_put(2, NULL, NULL);
SELECT pg_temp.a320_refused('not asked');
SELECT pg_temp.a320_put(2, 'declined', '2026-10-25');
SELECT pg_temp.a320_refused('declined');
SELECT pg_temp.a320_put(2, 'granted', '2025-01-01');
SELECT pg_temp.a320_refused('granted on an older version');
SELECT pg_temp.a320_assert(pg_temp.a320_reads() = :a320_reads0 AND pg_temp.a320_grants() = :a320_grants0,
  'a refused read writes no "read" audit row and issues no file grant');

-- The list keeps the row but withholds the text; the other rows are unchanged.
SELECT pg_temp.a320_list() AS a320_l_no \gset
SELECT pg_temp.a320_assert(
  (pg_temp.a320_preview(:'a320_l_no'::JSONB, :'a320_c1'::UUID) ->> 'last_text_preview') IS NULL
  AND (pg_temp.a320_preview(:'a320_l_no'::JSONB, :'a320_c1'::UUID) ->> 'ai_consent_missing') = 'true'
  AND (pg_temp.a320_preview(:'a320_l_no'::JSONB, :'a320_c1'::UUID) ->> 'last_message_at') IS NOT NULL
  AND (pg_temp.a320_preview(:'a320_l_no'::JSONB, :'a320_c1'::UUID) ->> 'last_direction') = 'inbound'
  AND (pg_temp.a320_preview(:'a320_l_no'::JSONB, :'a320_c1'::UUID) ->> 'lead_id') = pg_temp.a320_id(601)::TEXT
  AND (pg_temp.a320_preview(:'a320_l_no'::JSONB, :'a320_c2'::UUID) ->> 'last_text_preview') = 'Добрый день, интересует Малайзия'
  AND NOT (pg_temp.a320_preview(:'a320_l_no'::JSONB, :'a320_c2'::UUID) ? 'ai_consent_missing')
  AND (pg_temp.a320_preview(:'a320_l_no'::JSONB, :'a320_c3'::UUID) ->> 'last_text_preview') = 'Привет, как поступить?'
  AND NOT (pg_temp.a320_preview(:'a320_l_no'::JSONB, :'a320_c3'::UUID) ? 'ai_consent_missing'),
  'list_conversations keeps the rows; the student''s chat has no preview and says ai_consent_missing, the others are unchanged: ' || :'a320_l_no');

-- What is not correspondence or a file stays readable for the same student: the case, the client card, the lead.
SELECT pg_temp.a320_tool('get_case', 'sales', format('{"case_id":"%s","include":["documents","tasks","notes","profile"]}', pg_temp.a320_id(701))) AS a320_case_no \gset
SELECT pg_temp.a320_tool('get_client_card', 'sales', format('{"client_id":"%s"}', pg_temp.a320_id(501))) AS a320_card_no \gset
SELECT pg_temp.a320_tool('get_lead', 'sales', format('{"lead_id":"%s"}', pg_temp.a320_id(601))) AS a320_lead_no \gset
SELECT pg_temp.a320_assert(
  (:'a320_case_no'::JSONB) #>> '{case,student_name}' = 'A320 Клиент Один' AND jsonb_array_length((:'a320_case_no'::JSONB) -> 'documents') = 1
  AND (:'a320_case_no'::JSONB) #>> '{documents,0,requirement}' = 'Паспорт' AND (:'a320_case_no'::JSONB) #>> '{documents,0,status}' = 'approved'
  AND (:'a320_card_no'::JSONB) #>> '{client,name}' = 'A320 Клиент Один' AND jsonb_array_length((:'a320_card_no'::JSONB) -> 'conversations') = 1
  AND (:'a320_lead_no'::JSONB) #>> '{lead,stage}' = 'qualified' AND jsonb_array_length((:'a320_lead_no'::JSONB) -> 'conversation_ids') = 1,
  'case metadata (name, stage, document slots with statuses), the client card and the lead stay readable without the consent');

-- A chat with no student, and the chat and the chat of the case of a student without a portal account, are read as before.
SELECT pg_temp.a320_conv_read(:'a320_c2'::UUID) AS a320_r_c2 \gset
SELECT pg_temp.a320_conv_read(:'a320_c3'::UUID) AS a320_r_c3 \gset
SELECT pg_temp.a320_chat(702) AS a320_r_chat702 \gset
SELECT pg_temp.a320_assert(
  jsonb_array_length((:'a320_r_c2'::JSONB) -> 'messages') = 1 AND (:'a320_r_c2'::JSONB) #>> '{messages,0,text}' = 'Добрый день, интересует Малайзия'
  AND jsonb_array_length((:'a320_r_c3'::JSONB) -> 'messages') = 1 AND (:'a320_r_c3'::JSONB) #>> '{messages,0,text}' = 'Привет, как поступить?'
  AND (:'a320_r_chat702'::JSONB) ? 'messages' AND NOT ((:'a320_r_chat702'::JSONB) ? 'error'),
  'the chat of a lead without a student, the chat of a student without a portal account and the chat of that case are read as before');
SELECT pg_temp.a320_assert(pg_temp.a320_reads() = :a320_reads0 + 6,
  'the six permitted audited reads (case, client card, lead, two allowed chats, the case chat of a student without a portal account) wrote their rows: '
  || pg_temp.a320_reads() || ' vs ' || :a320_reads0);

-- Granted on the current version: the same three reads answer, with data, a link and the audit row.
SELECT pg_temp.a320_put(2, 'granted', '2026-10-25');
SELECT pg_temp.a320_reads() AS a320_reads1, pg_temp.a320_grants() AS a320_grants1 \gset
SELECT pg_temp.a320_chat(701) AS a320_ok_chat \gset
SELECT pg_temp.a320_file() AS a320_ok_file \gset
SELECT pg_temp.a320_conv_read(:'a320_c1'::UUID) AS a320_ok_conv \gset
SELECT pg_temp.a320_list() AS a320_l_yes \gset
SELECT pg_temp.a320_assert(
  jsonb_array_length((:'a320_ok_chat'::JSONB) -> 'messages') = 2 AND (:'a320_ok_chat'::JSONB) #>> '{messages,1,text}' = 'Пришлите аттестат, пожалуйста.'
  AND (:'a320_ok_file'::JSONB) ->> 'file_name' = 'passport.pdf' AND length((:'a320_ok_file'::JSONB) ->> 'token') = 43
  AND jsonb_array_length((:'a320_ok_conv'::JSONB) -> 'messages') = 2
  AND (:'a320_ok_conv'::JSONB) #>> '{messages,0,text}' = 'Здравствуйте, хочу учиться в Китае'
  AND (pg_temp.a320_preview(:'a320_l_yes'::JSONB, :'a320_c1'::UUID) ->> 'last_text_preview') = 'Сколько стоит обучение?'
  AND NOT (pg_temp.a320_preview(:'a320_l_yes'::JSONB, :'a320_c1'::UUID) ? 'ai_consent_missing')
  AND pg_temp.a320_reads() = :a320_reads1 + 3 AND pg_temp.a320_grants() = :a320_grants1 + 1
  AND (SELECT count(*) = 1 FROM platform.audit_events WHERE action = 'ai.agent.document.read' AND organization_id = pg_temp.a320_id(1)),
  'granted on the current version: the case chat, the file link and the WhatsApp chat are served, the list shows the preview, each read and the file are audited');

-- A link issued while the student allowed stops working after a decline (the use count is not spent) and works again after a grant.
SELECT platform_private.ai_agent_sha256((:'a320_ok_file'::JSONB) ->> 'token') AS a320_sha \gset
SELECT used_count AS a320_used0 FROM platform_private.ai_agent_file_grants WHERE token_sha256 = :'a320_sha' \gset
SELECT pg_temp.a320_put(2, 'declined', '2026-10-25');
SELECT pg_temp.a320_svc(format('SELECT platform.ai_agent_mcp_file_resolve_v1(%L)', :'a320_sha')) AS a320_res_no \gset
SELECT pg_temp.a320_assert(pg_temp.a320_err(:'a320_res_no'::JSONB) = 'P0002' AND pg_temp.a320_msg(:'a320_res_no'::JSONB) = 'not_found'
  AND (SELECT used_count = :a320_used0 FROM platform_private.ai_agent_file_grants WHERE token_sha256 = :'a320_sha'),
  'a file link issued before a decline is refused (not_found) and its use is not spent: ' || :'a320_res_no');
SELECT pg_temp.a320_put(2, 'granted', '2026-10-25');
SELECT pg_temp.a320_svc(format('SELECT platform.ai_agent_mcp_file_resolve_v1(%L)', :'a320_sha')) AS a320_res_yes \gset
SELECT pg_temp.a320_assert((:'a320_res_yes'::JSONB) ->> 'bucket' = 'platform-documents' AND (:'a320_res_yes'::JSONB) ->> 'fileName' = 'passport.pdf'
  AND (SELECT used_count = :a320_used0 + 1 FROM platform_private.ai_agent_file_grants WHERE token_sha256 = :'a320_sha'),
  'after a grant the same link resolves and spends one use: ' || :'a320_res_yes');
-- The resolver still refuses what it refused before: an unknown token, a malformed one, an exhausted one.
SELECT pg_temp.a320_assert(
  pg_temp.a320_err(pg_temp.a320_svc(format('SELECT platform.ai_agent_mcp_file_resolve_v1(%L)', repeat('0', 64)))) = 'P0002'
  AND pg_temp.a320_err(pg_temp.a320_svc('SELECT platform.ai_agent_mcp_file_resolve_v1(''xyz'')')) = 'P0002'
  AND pg_temp.a320_err(pg_temp.a320_as(1, format('SELECT platform.ai_agent_mcp_file_resolve_v1(%L)', :'a320_sha'))) IS NOT NULL,
  'the file resolver keeps its old refusals and stays closed to authenticated');

-- A student of a case with no portal account who DECLINED is refused too (the decline is honoured without a membership).
SELECT pg_temp.a320_put(5, 'declined', '2026-10-25');
SELECT pg_temp.a320_chat(704) AS a320_chat704 \gset
SELECT pg_temp.a320_assert((:'a320_chat704'::JSONB) ->> 'message' = 'ai_consent_missing', 'a decline of a student whose membership is suspended still closes the chat: ' || :'a320_chat704');
SELECT pg_temp.a320_put(5, NULL, NULL);
SELECT pg_temp.a320_chat(704) AS a320_chat704b \gset
SELECT pg_temp.a320_assert((:'a320_chat704b'::JSONB) ? 'messages', 'not asked and no active portal account: the chat is served');

-- A foreign organization's case or document stays "not found", whatever the consent.
SELECT pg_temp.a320_assert(
  pg_temp.a320_err(pg_temp.a320_tool('get_case_chat', 'sales', format('{"case_id":"%s"}', pg_temp.a320_id(703)))) = 'P0002'
  AND pg_temp.a320_err(pg_temp.a320_tool('get_document_file', 'sales', format('{"document_version_id":"%s"}', pg_temp.a320_id(9998)))) = 'P0002'
  AND pg_temp.a320_err(pg_temp.a320_tool('get_conversation', 'sales', format('{"conversation_id":"%s"}', pg_temp.a320_id(9997)))) = 'P0002',
  'a foreign case, an unknown document and an unknown chat are still not_found (the consent state is not disclosed for them)');

-- ---------------------------------------------------------------------------
-- 5. The staff read.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.a320_staff_read(p_actor INTEGER, p_case INTEGER, p_org INTEGER DEFAULT 1) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a320_as(p_actor, format('SELECT platform.staff_student_ai_consent_v1(%L, %L)', pg_temp.a320_id(p_org), pg_temp.a320_id(p_case)))
$$;
SELECT pg_temp.a320_put(2, NULL, NULL);
SELECT pg_temp.a320_staff_read(1, 701) AS a320_st_none \gset
SELECT pg_temp.a320_put(2, 'granted', '2026-10-25');
SELECT pg_temp.a320_staff_read(1, 701) AS a320_st_yes \gset
SELECT pg_temp.a320_put(2, 'declined', '2026-10-25');
SELECT pg_temp.a320_staff_read(1, 701) AS a320_st_no \gset
SELECT pg_temp.a320_put(2, 'granted', '2025-01-01');
SELECT pg_temp.a320_staff_read(1, 701) AS a320_st_old \gset
SELECT pg_temp.a320_staff_read(1, 702) AS a320_st_noportal \gset
SELECT pg_temp.a320_assert(
  (:'a320_st_none'::JSONB) = '{"status": null, "decidedAt": null, "aiAllowed": false}'::JSONB
  AND (:'a320_st_yes'::JSONB) ->> 'status' = 'granted' AND (:'a320_st_yes'::JSONB) ->> 'decidedAt' IS NOT NULL AND (:'a320_st_yes'::JSONB) ->> 'aiAllowed' = 'true'
  AND (:'a320_st_no'::JSONB) ->> 'status' = 'declined' AND (:'a320_st_no'::JSONB) ->> 'decidedAt' IS NOT NULL AND (:'a320_st_no'::JSONB) ->> 'aiAllowed' = 'false'
  AND (:'a320_st_old'::JSONB) = '{"status": null, "decidedAt": null, "aiAllowed": false}'::JSONB
  AND (:'a320_st_noportal'::JSONB) = '{"status": null, "decidedAt": null, "aiAllowed": true}'::JSONB
  AND (SELECT count(*) = 3 FROM jsonb_object_keys(:'a320_st_yes'::JSONB)),
  'the staff read: granted / declined as decided, null when not asked or on an older version, aiAllowed as the enforcement answers: '
  || :'a320_st_none' || :'a320_st_yes' || :'a320_st_no' || :'a320_st_old' || :'a320_st_noportal');
SELECT pg_temp.a320_assert(
  pg_temp.a320_err(pg_temp.a320_staff_read(2, 701)) = '42501'
  AND pg_temp.a320_err(pg_temp.a320_staff_read(3, 701)) = '42501'
  AND pg_temp.a320_err(pg_temp.a320_staff_read(3, 701, 2)) = '42501'
  AND pg_temp.a320_err(pg_temp.a320_staff_read(1, 703)) = '42501'
  AND pg_temp.a320_err(pg_temp.a320_staff_read(1, 9999)) = '42501'
  AND pg_temp.a320_err(pg_temp.a320_anon(format('SELECT platform.staff_student_ai_consent_v1(%L, %L)', pg_temp.a320_id(1), pg_temp.a320_id(701)))) = '42501'
  AND pg_temp.a320_err(pg_temp.a320_svc(format('SELECT platform.staff_student_ai_consent_v1(%L, %L)', pg_temp.a320_id(1), pg_temp.a320_id(701)))) = '42501'
  AND pg_temp.a320_err(pg_temp.a320_as(1, 'SELECT platform.staff_student_ai_consent_v1(NULL, NULL)')) = '42501',
  'the staff read is refused to the student himself, to another organization''s Admin (both ways), to anon, service_role, and for an unknown or foreign case or null');

-- ---------------------------------------------------------------------------
-- 6. Account deletion. Student 4 has no case: a SIMPLE account. Its consent row is in the own set.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a320_set(4, 'granted', '2026-10-25', 'ios', 3101) AS a320_s4 \gset
SELECT pg_temp.a320_set(4, 'declined', '2026-10-25', 'ios', 3102) AS a320_s4b \gset
SELECT pg_temp.a320_assert((:'a320_s4b'::JSONB) ->> 'status' = 'declined'
  AND (SELECT count(*) = 2 FROM platform.audit_events e JOIN platform_private.student_ai_consents k ON k.id = e.resource_id
      WHERE k.auth_user_id = pg_temp.a320_id(104) AND e.action LIKE 'ai.consent.%'),
  'student 4 decided twice: one row, two events');
SELECT platform_private.account_deletion_check(pg_temp.a320_id(1), pg_temp.a320_id(104)) AS a320_chk \gset
SELECT pg_temp.a320_assert(
  (:'a320_chk'::JSONB) -> 'reasons' = '[]'::JSONB
  AND (:'a320_chk'::JSONB) #> '{closure,other}' = '[]'::JSONB
  AND jsonb_array_length((:'a320_chk'::JSONB) #> '{closure,rows,"platform_private.student_ai_consents"}') = 1
  AND jsonb_array_length((:'a320_chk'::JSONB) #> '{closure,rows,"platform.audit_events"}') = 2,
  'an account with a consent row is still SIMPLE: no reason, no other_records, the row and its two events are in the own set: ' || :'a320_chk');
-- A student with a case stays "not simple" for its case, never for the consent row.
SELECT platform_private.account_deletion_closure(pg_temp.a320_id(1), pg_temp.a320_id(102)) AS a320_clo2 \gset
SELECT pg_temp.a320_assert(
  ((:'a320_clo2'::JSONB) -> 'rows') ? 'platform_private.student_ai_consents'
  AND NOT (((:'a320_clo2'::JSONB) -> 'other') ? 'platform_private.student_ai_consents')
  AND ((platform_private.account_deletion_check(pg_temp.a320_id(1), pg_temp.a320_id(102)) -> 'reasons') ? 'case'),
  'student 2 (a case) is not simple for its case, and the consent row is in the own set, never in "other"');
-- The real path: the student asks, the Admin processes. (Student 4 asks for himself.)
SELECT pg_temp.a320_as(4, format('SELECT platform.request_account_deletion_v2(%L)', pg_temp.a320_id(3201))) AS a320_dreq \gset
SELECT pg_temp.a320_assert(NOT ((:'a320_dreq'::JSONB) ? 'error'), 'student 4 could not request deletion: ' || :'a320_dreq');
SELECT d.id AS a320_dreq_id FROM platform_private.account_deletion_requests d WHERE d.subject_auth_user_id = pg_temp.a320_id(104) \gset
SELECT count(*) AS a320_evt0 FROM platform.audit_events WHERE action LIKE 'ai.consent.%' \gset
SELECT pg_temp.a320_as(1, format('SELECT platform.process_account_deletion_v1(%L)', :'a320_dreq_id')) AS a320_dproc \gset
SELECT pg_temp.a320_assert((:'a320_dproc'::JSONB) ->> 'status' = 'processing' AND NOT ((:'a320_dproc'::JSONB) ? 'error'),
  'the Admin''s automatic processing of the account with a consent row: ' || :'a320_dproc');
SELECT pg_temp.a320_assert(
  NOT EXISTS (SELECT 1 FROM platform_private.student_ai_consents WHERE auth_user_id = pg_temp.a320_id(104))
  AND NOT EXISTS (SELECT 1 FROM platform.audit_events e WHERE e.action LIKE 'ai.consent.%'
      AND e.actor_principal = 'auth:' || pg_temp.a320_id(104)::TEXT)
  AND (SELECT count(*) = :a320_evt0 - 2 FROM platform.audit_events WHERE action LIKE 'ai.consent.%')
  AND EXISTS (SELECT 1 FROM platform.audit_events e WHERE e.action = 'account.deletion.request' AND e.resource_id = :'a320_dreq_id'::UUID)
  AND EXISTS (SELECT 1 FROM platform.audit_events e WHERE e.action = 'account.deletion.process' AND e.resource_id = :'a320_dreq_id'::UUID)
  AND NOT EXISTS (SELECT 1 FROM platform.profiles WHERE auth_user_id = pg_temp.a320_id(104))
  AND (SELECT count(*) = 1 FROM platform_private.student_ai_consents WHERE auth_user_id = pg_temp.a320_id(102)),
  'processing erased the consent row and its journal events and nothing of anyone else; the request and its own events stay');
DELETE FROM auth.users WHERE id = pg_temp.a320_id(104);
SELECT pg_temp.a320_as(1, format('SELECT platform.complete_account_deletion_v1(%L)', :'a320_dreq_id')) AS a320_dcomp \gset
SELECT pg_temp.a320_assert((:'a320_dcomp'::JSONB) ->> 'status' = 'completed' AND (:'a320_dcomp'::JSONB) ->> 'mode' = 'automatic',
  'the request completes after the Auth user is gone: ' || :'a320_dcomp');
-- The manual path: deleting the Auth user (after the team's own work) removes the row by the foreign key.
-- The cascade itself (a user with a consent row and nothing else referencing it).
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES (pg_temp.a320_id(107), 'a320-7@example.invalid', '{}'::JSONB);
INSERT INTO platform_private.student_ai_consents(organization_id, auth_user_id, status, policy_version, source)
VALUES (pg_temp.a320_id(1), pg_temp.a320_id(107), 'granted', '2026-10-25', 'ios');
-- (the legacy V1 sign-up trigger gives every new Auth user an account and a profile of its own: removed first)
DELETE FROM public.profiles WHERE user_id = pg_temp.a320_id(107);
DELETE FROM public.accounts WHERE owner_user_id = pg_temp.a320_id(107);
DELETE FROM auth.users WHERE id = pg_temp.a320_id(107);
SELECT pg_temp.a320_assert(NOT EXISTS (SELECT 1 FROM platform_private.student_ai_consents WHERE auth_user_id = pg_temp.a320_id(107)),
  'deleting the Auth user cascades the consent row');

-- ---------------------------------------------------------------------------
-- 7. The journal.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a320_assert(
  'ai.consent.grant' = ANY (platform_private.p7a_safe_audit_actions()) AND 'ai.consent.decline' = ANY (platform_private.p7a_safe_audit_actions())
  AND NOT ('ai.consent.grant' = ANY (platform_private.p7a_safe_audit_actions_pre_student_ai_consent()))
  AND cardinality(platform_private.p7a_safe_audit_actions()) = cardinality(platform_private.p7a_safe_audit_actions_pre_student_ai_consent()) + 2
  AND 'student_ai_consent' = ANY (platform_private.p7a_safe_audit_resource_types())
  AND NOT ('student_ai_consent' = ANY (platform_private.p7a_safe_audit_resource_types_pre_student_ai_consent()))
  AND cardinality(platform_private.p7a_safe_audit_resource_types()) = cardinality(platform_private.p7a_safe_audit_resource_types_pre_student_ai_consent()) + 1
  AND 'ai.agent.tool.read' = ANY (platform_private.p7a_safe_audit_actions()) AND 'account.deletion.request' = ANY (platform_private.p7a_safe_audit_actions())
  AND platform_private.p7a_changed_field_codes('ai.consent.grant') = ARRAY['ai_status']::TEXT[]
  AND platform_private.p7a_changed_field_codes('ai.consent.decline') = ARRAY['ai_status']::TEXT[],
  'the journal allowlist gained exactly two actions and one object type (older ones stay); both actions take the ai.% field-code branch');
-- ---------------------------------------------------------------------------
-- 8. Gemini and document recognition (320, h): the same refusal on every path that hands correspondence or files to a
--    third-party model. Student 2 (a portal account) / case 701 / chat c1 is the student; chat c2 (no student) and chat
--    c3 (case 702, no portal account) must stay as they were. The agent role calls the platform_ai_agent functions as the
--    private service does; the organization's Gemini consent is recorded by the Admin like in production.
-- ---------------------------------------------------------------------------
GRANT evo_ai_agent TO postgres WITH INHERIT FALSE, SET TRUE;
CREATE FUNCTION pg_temp.a320_agent(p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a320_call('evo_ai_agent', NULL, p_sql)
$$;
-- (c2 is a plain sales chat with no student, as section 3 left it.)
SELECT pg_temp.a320_as(1, format('SELECT platform.ai_agent_consent_record_v1(%L, ''grant'', ''gemini-v1-2026-10-06'', %L)',
  pg_temp.a320_id(1), pg_temp.a320_id(5001))) AS a320_org_consent \gset
SELECT pg_temp.a320_assert((:'a320_org_consent'::JSONB) ->> 'status' = 'granted', 'the Admin records the Gemini consent of the organization: ' || :'a320_org_consent');

-- 8a. P1, the sales-chat helper: ticket, redemption, context.
CREATE FUNCTION pg_temp.a320_ticket(p_conv UUID) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a320_as(1, format('SELECT platform.ai_agent_ticket_v1(%L, ''answer'', %L, NULL)', pg_temp.a320_id(1), p_conv))
$$;
CREATE FUNCTION pg_temp.a320_redeem(p_ticket JSONB) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a320_agent(format('SELECT platform_ai_agent.redeem_ticket_v1(%L, ''answer'')', p_ticket ->> 'ticket'))
$$;
CREATE FUNCTION pg_temp.a320_context(p_redemption JSONB) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a320_agent(format('SELECT platform_ai_agent.conversation_context_v1(%L)', p_redemption ->> 'redemptionId'))
$$;
CREATE FUNCTION pg_temp.a320_tickets() RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT count(*) FROM platform_private.ai_tickets WHERE organization_id = pg_temp.a320_id(1)
$$;

SELECT pg_temp.a320_put(2, 'declined', '2026-10-25');
SELECT pg_temp.a320_tickets() AS a320_tickets0 \gset
SELECT pg_temp.a320_ticket(:'a320_c1'::UUID) AS a320_t_no \gset
SELECT pg_temp.a320_assert(pg_temp.a320_err(:'a320_t_no'::JSONB) = '42501' AND pg_temp.a320_msg(:'a320_t_no'::JSONB) = 'ai_consent_missing'
  AND pg_temp.a320_tickets() = :a320_tickets0,
  'P1: a declined student''s chat gets no ticket (ai_consent_missing, 42501) and no ticket row (the quota is not spent): ' || :'a320_t_no');
SELECT pg_temp.a320_put(2, NULL, NULL);
SELECT pg_temp.a320_assert(pg_temp.a320_msg(pg_temp.a320_ticket(:'a320_c1'::UUID)) = 'ai_consent_missing',
  'P1: a student with a portal account who was never asked gets no ticket either');
SELECT pg_temp.a320_put(2, 'granted', '2025-01-01');
SELECT pg_temp.a320_assert(pg_temp.a320_msg(pg_temp.a320_ticket(:'a320_c1'::UUID)) = 'ai_consent_missing',
  'P1: a grant on an older text version counts as not decided: no ticket');
-- A chat with no student and the chat of a student without a portal account are unchanged.
SELECT pg_temp.a320_ticket(:'a320_c2'::UUID) AS a320_t_c2 \gset
SELECT pg_temp.a320_ticket(:'a320_c3'::UUID) AS a320_t_c3 \gset
SELECT pg_temp.a320_assert((:'a320_t_c2'::JSONB ->> 'ticket') ~ '^[0-9a-f]{64}$' AND (:'a320_t_c3'::JSONB ->> 'ticket') ~ '^[0-9a-f]{64}$',
  'P1: a chat with no student and the chat of a student without a portal account still get tickets: ' || :'a320_t_c2' || :'a320_t_c3');
-- The organization''s own consent still decides first (PT412) and the other ticket purposes are untouched.
SELECT pg_temp.a320_assert(
  (pg_temp.a320_as(1, format('SELECT platform.ai_agent_ticket_v1(%L, ''laboratory'', NULL, NULL)', pg_temp.a320_id(1))) ->> 'ticket') ~ '^[0-9a-f]{64}$',
  'P1: the laboratory ticket (no student data) is not affected');
-- Granted on the current version: a ticket, its redemption and the context with the messages and the lead card.
SELECT pg_temp.a320_put(2, 'granted', '2026-10-25');
SELECT pg_temp.a320_ticket(:'a320_c1'::UUID) AS a320_t_yes \gset
SELECT pg_temp.a320_redeem(:'a320_t_yes'::JSONB) AS a320_red_yes \gset
SELECT pg_temp.a320_context(:'a320_red_yes'::JSONB) AS a320_ctx_yes \gset
SELECT pg_temp.a320_assert((:'a320_t_yes'::JSONB ->> 'ticket') ~ '^[0-9a-f]{64}$' AND (:'a320_red_yes'::JSONB) ? 'redemptionId'
  AND jsonb_array_length((:'a320_ctx_yes'::JSONB) -> 'messages') = 2
  AND (:'a320_ctx_yes'::JSONB) #>> '{messages,1,text}' = 'Сколько стоит обучение?',
  'P1: granted on the current version, the ticket is issued, redeemed and the context holds the messages: ' || :'a320_ctx_yes');
-- The student declines while a redeemed ticket is still valid (5 minutes): every further read is refused.
SELECT pg_temp.a320_ticket(:'a320_c1'::UUID) AS a320_t_mid \gset
SELECT pg_temp.a320_redeem(:'a320_t_mid'::JSONB) AS a320_red_mid \gset
SELECT pg_temp.a320_ticket(:'a320_c1'::UUID) AS a320_t_unredeemed \gset
SELECT pg_temp.a320_put(2, 'declined', '2026-10-25');
SELECT pg_temp.a320_context(:'a320_red_mid'::JSONB) AS a320_ctx_mid \gset
SELECT pg_temp.a320_redeem(:'a320_t_unredeemed'::JSONB) AS a320_red_late \gset
SELECT pg_temp.a320_assert(pg_temp.a320_err(:'a320_ctx_mid'::JSONB) = '42501' AND pg_temp.a320_msg(:'a320_ctx_mid'::JSONB) = 'ai_redemption_invalid'
  AND pg_temp.a320_err(:'a320_red_late'::JSONB) = '42501' AND pg_temp.a320_msg(:'a320_red_late'::JSONB) = 'ai_ticket_invalid'
  AND pg_temp.a320_err(pg_temp.a320_context(:'a320_red_yes'::JSONB)) = '42501',
  'P1: after a decline a redeemed ticket reads nothing (ai_redemption_invalid) and an unredeemed one cannot be redeemed (ai_ticket_invalid): '
  || :'a320_ctx_mid' || :'a320_red_late');
-- The search and the answer claim of a redeemed ticket go through the same check.
SELECT pg_temp.a320_assert(pg_temp.a320_err(pg_temp.a320_agent(format('SELECT platform_ai_agent.rate_take_v1(%L)', :'a320_red_yes'::JSONB ->> 'redemptionId'))) = '42501',
  'P1: the rate take of a redeemed ticket is refused after a decline too');
SELECT pg_temp.a320_put(2, 'granted', '2026-10-25');
SELECT pg_temp.a320_assert(NOT (pg_temp.a320_context(:'a320_red_yes'::JSONB) ? 'error'),
  'P1: the same redemption reads again after a new grant (the check follows the live decision)');

-- The window learns the reason without asking for a ticket: studentAiAllowed, and no saved answer for a refused chat.
SELECT pg_temp.a320_as(1, format('SELECT platform.ai_agent_answer_current_v1(%L, %L, NULL)', pg_temp.a320_id(1), :'a320_c1'::UUID)) AS a320_cur_yes \gset
SELECT pg_temp.a320_put(2, 'declined', '2026-10-25');
SELECT pg_temp.a320_as(1, format('SELECT platform.ai_agent_answer_current_v1(%L, %L, NULL)', pg_temp.a320_id(1), :'a320_c1'::UUID)) AS a320_cur_no \gset
SELECT pg_temp.a320_as(1, format('SELECT platform.ai_agent_answer_current_v1(%L, %L, NULL)', pg_temp.a320_id(1), :'a320_c2'::UUID)) AS a320_cur_c2 \gset
SELECT pg_temp.a320_assert((:'a320_cur_yes'::JSONB ->> 'studentAiAllowed') = 'true' AND (:'a320_cur_no'::JSONB ->> 'studentAiAllowed') = 'false'
  AND (:'a320_cur_c2'::JSONB ->> 'studentAiAllowed') = 'true'
  AND (:'a320_cur_no'::JSONB -> 'answer') = 'null'::JSONB AND (:'a320_cur_no'::JSONB ->> 'consentRecorded') = 'true'
  AND (:'a320_cur_no'::JSONB ->> 'latestInboundMessageId') IS NOT NULL AND (:'a320_cur_no'::JSONB ->> 'lastMessageDirection') = 'inbound',
  'P1: the saved-answer read says studentAiAllowed (false for the declined chat, true otherwise) and hides the answer: ' || :'a320_cur_no');


-- 8b. P3, the memory of the Gemini conversations: nothing is queued, read or stored for a chat of a student who has not allowed.
SELECT version AS a320_aiv FROM platform_private.ai_settings WHERE organization_id = pg_temp.a320_id(1) \gset
SELECT pg_temp.a320_as(1, format('SELECT platform.ai_agent_memory_toggle_v1(%L, TRUE, %s, %L)', pg_temp.a320_id(1), :'a320_aiv', pg_temp.a320_id(5002))) AS a320_mem_on \gset
SELECT pg_temp.a320_assert((:'a320_mem_on'::JSONB) ->> 'status' = 'applied' AND (:'a320_mem_on'::JSONB) ->> 'memoryEnabled' = 'true',
  'the Admin switches the memory on: ' || :'a320_mem_on');
CREATE FUNCTION pg_temp.a320_queue() RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE n BIGINT;
BEGIN
  EXECUTE 'SELECT count(*) FROM pgmq.q_ai_agent_work_v1' INTO n;
  RETURN n;
END
$$;
CREATE FUNCTION pg_temp.a320_due(p_conv UUID) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a320_agent(format('SELECT platform_ai_agent.memory_due_v1(ARRAY[%L]::UUID[]) -> ''items'' -> 0', p_conv))
$$;
CREATE FUNCTION pg_temp.a320_mem_ctx(p_conv UUID) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a320_agent(format('SELECT platform_ai_agent.memory_context_v1(%L, ''a320-worker'', 120)', p_conv))
$$;
CREATE FUNCTION pg_temp.a320_mem_put(p_conv UUID, p_claim JSONB) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a320_agent(format('SELECT platform_ai_agent.memory_put_v1(%L, ''a320-worker'', %s, %L, NULL, NULL, NULL, %L, ''gemini-3-flash'')',
    p_conv, p_claim #>> '{prior,version}', 'Интерес: Китай', p_claim ->> 'interestMessageId'))
$$;
CREATE FUNCTION pg_temp.a320_mem_view(p_conv UUID) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a320_as(1, format('SELECT platform.ai_agent_memory_v1(%L, %L)', pg_temp.a320_id(1), p_conv))
$$;

-- Granted: the chat is queued, claimed and stored as before.
SELECT pg_temp.a320_put(2, 'granted', '2026-10-25');
SELECT pg_temp.a320_queue() AS a320_q0 \gset
SELECT pg_temp.a320_due(:'a320_c1'::UUID) AS a320_due_yes \gset
SELECT pg_temp.a320_mem_ctx(:'a320_c1'::UUID) AS a320_mctx_yes \gset
SELECT pg_temp.a320_assert((:'a320_due_yes'::JSONB) ->> 'status' = 'enqueued' AND pg_temp.a320_queue() = :a320_q0 + 1
  AND (:'a320_mctx_yes'::JSONB) ->> 'status' = 'claimed' AND (:'a320_mctx_yes'::JSONB) ->> 'mode' = 'interest'
  AND jsonb_array_length((:'a320_mctx_yes'::JSONB) -> 'window') = 2,
  'P3: a student who allowed: the chat is queued, claimed and the context holds the messages: ' || :'a320_due_yes' || :'a320_mctx_yes');
-- The student declines while the worker holds the claim: the result is refused and not stored.
SELECT pg_temp.a320_put(2, 'declined', '2026-10-25');
SELECT pg_temp.a320_mem_put(:'a320_c1'::UUID, :'a320_mctx_yes'::JSONB) AS a320_mput_no \gset
SELECT pg_temp.a320_assert(pg_temp.a320_err(:'a320_mput_no'::JSONB) = '42501' AND pg_temp.a320_msg(:'a320_mput_no'::JSONB) = 'ai_consent_missing'
  AND (SELECT interest IS NULL AND summary IS NULL FROM platform_private.ai_client_memory WHERE conversation_id = :'a320_c1'::UUID),
  'P3: a result that comes after a decline is refused (ai_consent_missing) and nothing is stored: ' || :'a320_mput_no');
-- The next claim reads no text, drops the pointer and the lease, and says why.
SELECT pg_temp.a320_mem_ctx(:'a320_c1'::UUID) AS a320_mctx_no \gset
SELECT pg_temp.a320_assert((:'a320_mctx_no'::JSONB) ->> 'status' = 'none' AND (:'a320_mctx_no'::JSONB) ->> 'reason' = 'ai_consent_missing'
  AND (:'a320_mctx_no'::JSONB) ->> 'mode' = 'none' AND (:'a320_mctx_no'::JSONB) ? 'version'
  AND NOT ((:'a320_mctx_no'::JSONB) ? 'window') AND NOT ((:'a320_mctx_no'::JSONB) ? 'leaving')
  AND (SELECT lease_owner IS NULL AND lease_expires_at IS NULL AND enqueued_at IS NULL
      FROM platform_private.ai_client_memory WHERE conversation_id = :'a320_c1'::UUID),
  'P3: a queued chat of a student who declined is dropped without reading a text: ' || :'a320_mctx_no');
-- Polling queues nothing for it; the chat of a student without a portal account and the chat with no student are queued.
SELECT pg_temp.a320_queue() AS a320_q1 \gset
SELECT pg_temp.a320_due(:'a320_c1'::UUID) AS a320_due_no \gset
SELECT pg_temp.a320_assert((:'a320_due_no'::JSONB) ->> 'status' = 'skipped' AND (:'a320_due_no'::JSONB) ->> 'reason' = 'ai_consent_missing'
  AND pg_temp.a320_queue() = :a320_q1,
  'P3: the poll skips the chat of a student who declined and puts nothing in the queue: ' || :'a320_due_no');
SELECT pg_temp.a320_due(:'a320_c2'::UUID) AS a320_due_c2 \gset
SELECT pg_temp.a320_due(:'a320_c3'::UUID) AS a320_due_c3 \gset
SELECT pg_temp.a320_mem_ctx(:'a320_c2'::UUID) AS a320_mctx_c2 \gset
SELECT pg_temp.a320_mem_ctx(:'a320_c3'::UUID) AS a320_mctx_c3 \gset
SELECT pg_temp.a320_mem_put(:'a320_c3'::UUID, :'a320_mctx_c3'::JSONB) AS a320_mput_c3 \gset
SELECT pg_temp.a320_assert((:'a320_due_c2'::JSONB) ->> 'status' = 'enqueued' AND (:'a320_due_c3'::JSONB) ->> 'status' = 'enqueued'
  AND (:'a320_mctx_c2'::JSONB) ->> 'status' = 'claimed' AND (:'a320_mctx_c3'::JSONB) ->> 'status' = 'claimed'
  AND (:'a320_mput_c3'::JSONB) ->> 'status' = 'saved'
  AND (SELECT interest = 'Интерес: Китай' FROM platform_private.ai_client_memory WHERE conversation_id = :'a320_c3'::UUID),
  'P3: a chat with no student and the chat of a student without a portal account are queued, claimed and stored as before: '
  || :'a320_due_c2' || :'a320_due_c3' || :'a320_mput_c3');
-- A summary stored earlier stays visible to staff (and can be forgotten), but the memory is not active for the refused chat.
SELECT pg_temp.a320_put(2, 'granted', '2026-10-25');
SELECT pg_temp.a320_due(:'a320_c1'::UUID) AS a320_due_again \gset
SELECT pg_temp.a320_mem_ctx(:'a320_c1'::UUID) AS a320_mctx_again \gset
SELECT pg_temp.a320_mem_put(:'a320_c1'::UUID, :'a320_mctx_again'::JSONB) AS a320_mput_again \gset
SELECT pg_temp.a320_mem_view(:'a320_c1'::UUID) AS a320_mv_yes \gset
SELECT pg_temp.a320_put(2, 'declined', '2026-10-25');
SELECT pg_temp.a320_mem_view(:'a320_c1'::UUID) AS a320_mv_no \gset
SELECT pg_temp.a320_mem_view(:'a320_c3'::UUID) AS a320_mv_c3 \gset
SELECT pg_temp.a320_assert((:'a320_mput_again'::JSONB) ->> 'status' = 'saved'
  AND (:'a320_mv_yes'::JSONB ->> 'studentAiAllowed') = 'true' AND (:'a320_mv_yes'::JSONB ->> 'active') = 'true'
  AND (:'a320_mv_yes'::JSONB #>> '{memory,interest}') = 'Интерес: Китай'
  AND (:'a320_mv_no'::JSONB ->> 'studentAiAllowed') = 'false' AND (:'a320_mv_no'::JSONB ->> 'active') = 'false'
  AND (:'a320_mv_no'::JSONB ->> 'interestDue') = 'false' AND (:'a320_mv_no'::JSONB ->> 'summaryDue') = 'false'
  AND (:'a320_mv_no'::JSONB ->> 'enabled') = 'true' AND (:'a320_mv_no'::JSONB ->> 'consentRecorded') = 'true'
  AND (:'a320_mv_no'::JSONB #>> '{memory,interest}') = 'Интерес: Китай'
  AND (:'a320_mv_c3'::JSONB ->> 'studentAiAllowed') = 'true' AND (:'a320_mv_c3'::JSONB ->> 'active') = 'true',
  'P3: the memory block says studentAiAllowed; for a declined chat the memory is not active, nothing is due, what was stored stays visible: '
  || :'a320_mv_no');
SELECT pg_temp.a320_queue() AS a320_q2 \gset
SELECT pg_temp.a320_as(1, format('SELECT platform.ai_agent_memory_clear_v1(%L, %L, %L)', pg_temp.a320_id(1), :'a320_c1'::UUID, pg_temp.a320_id(5003))) AS a320_forget \gset
SELECT pg_temp.a320_assert((:'a320_forget'::JSONB) ->> 'status' = 'cleared' AND (:'a320_forget'::JSONB) ->> 'deleted' = 'true'
  AND (:'a320_forget'::JSONB) ->> 'enqueued' = 'false' AND pg_temp.a320_queue() = :a320_q2
  AND NOT EXISTS (SELECT 1 FROM platform_private.ai_client_memory WHERE conversation_id = :'a320_c1'::UUID),
  'P3: "forget the summary" works for a declined chat and does not start a rebuild: ' || :'a320_forget');


-- 8c. P4, the night autoresponder: the decision is skipped with its own reason on every stage, no text is handed out, the
--     night summary does not take the chat. The autoresponder is switched on for the whole test (a date override covers today),
--     the three inbound messages are made fresh, so a chat that is allowed really gets as far as «decide».
SELECT platform_private.ai_autosend_settings_row(pg_temp.a320_id(1)) IS NOT NULL AS a320_as_row \gset
UPDATE platform_private.ai_autosend_settings SET enabled = TRUE, shadow_mode = TRUE, enabled_at = clock_timestamp(),
  responsible_membership_id = pg_temp.a320_id(301),
  date_overrides = jsonb_build_array(jsonb_build_object(
    'from', to_char((clock_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE - 2, 'YYYY-MM-DD'),
    'to', to_char((clock_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE + 2, 'YYYY-MM-DD'), 'mode', 'on'))
WHERE organization_id = pg_temp.a320_id(1);
SELECT pg_temp.a320_assert(platform_private.ai_autosend_gate(pg_temp.a320_id(1)), 'the autoresponder gate is open for the test');
SELECT (platform_private.ai_autosend_window(platform_private.ai_autosend_settings_row(pg_temp.a320_id(1)), clock_timestamp()) ->> 'intervalStart')::TIMESTAMPTZ AS a320_istart \gset
SET LOCAL session_replication_role = replica;
UPDATE platform.communication_messages SET created_at = greatest(clock_timestamp() - INTERVAL '30 seconds', :'a320_istart'::TIMESTAMPTZ + INTERVAL '1 second')
  WHERE id IN (:'a320_m2'::UUID, :'a320_m3'::UUID, :'a320_m4'::UUID);
SET LOCAL session_replication_role = origin;
-- A ticket for the window counts as staff activity in the chat (15 minutes); the P1 tickets above are removed first.
DELETE FROM platform_private.ai_tickets WHERE organization_id = pg_temp.a320_id(1);
CREATE FUNCTION pg_temp.a320_due_items(p_c1 UUID, p_m1 UUID, p_c2 UUID, p_m2 UUID, p_c3 UUID, p_m3 UUID) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a320_agent(format('SELECT platform_ai_agent.autosend_due_v1(%L::jsonb)',
    jsonb_build_array(
      jsonb_build_object('conversationId', p_c1, 'messageId', p_m1),
      jsonb_build_object('conversationId', p_c2, 'messageId', p_m2),
      jsonb_build_object('conversationId', p_c3, 'messageId', p_m3))::TEXT))
$$;
SELECT pg_temp.a320_put(2, 'declined', '2026-10-25');
SELECT pg_temp.a320_due_items(:'a320_c1'::UUID, :'a320_m2'::UUID, :'a320_c2'::UUID, :'a320_m3'::UUID, :'a320_c3'::UUID, :'a320_m4'::UUID) AS a320_ad \gset
SELECT pg_temp.a320_assert(NOT ((:'a320_ad'::JSONB) ? 'error'), 'autosend_due_v1 answers: ' || :'a320_ad');
SELECT pg_temp.a320_assert(
  (SELECT i FROM jsonb_array_elements((:'a320_ad'::JSONB) -> 'items') i WHERE i ->> 'conversationId' = :'a320_c1') ->> 'status' = 'skipped'
  AND (SELECT i FROM jsonb_array_elements((:'a320_ad'::JSONB) -> 'items') i WHERE i ->> 'conversationId' = :'a320_c1') ->> 'reasonCode' = 'ai_consent_missing'
  AND (SELECT i FROM jsonb_array_elements((:'a320_ad'::JSONB) -> 'items') i WHERE i ->> 'conversationId' = :'a320_c1') ->> 'enqueued' = 'false'
  AND (SELECT l.status = 'skipped' AND l.reason_code = 'ai_consent_missing' AND l.reason_ru = 'Студент не дал согласия на ИИ-помощников'
        AND l.body IS NULL AND l.text IS NULL
      FROM platform_private.ai_autosend_log l WHERE l.client_message_id = :'a320_m2'::UUID),
  'P4: the declined student''s message is skipped with ai_consent_missing, in Russian words, with no text drafted: ' || :'a320_ad');
SELECT pg_temp.a320_assert(
  (SELECT count(*) = 2 FROM jsonb_array_elements((:'a320_ad'::JSONB) -> 'items') i
    WHERE i ->> 'conversationId' IN (:'a320_c2', :'a320_c3') AND i ->> 'status' = 'considering' AND (i ->> 'enqueued')::BOOLEAN),
  'P4: the chat with no student and the chat of a student without a portal account are taken for a decision as before: ' || :'a320_ad');
-- The pre-claimed decision row of a chat whose student declines AFTER it was queued: the context gives no text.
SELECT l.id AS a320_dec_c2 FROM platform_private.ai_autosend_log l WHERE l.client_message_id = :'a320_m3'::UUID \gset
SELECT l.id AS a320_dec_c3 FROM platform_private.ai_autosend_log l WHERE l.client_message_id = :'a320_m4'::UUID \gset
SELECT pg_temp.a320_agent(format('SELECT platform_ai_agent.autosend_context_v1(%L, ''a320-worker'', 120)', :'a320_dec_c2')) AS a320_actx_c2 \gset
SELECT pg_temp.a320_assert((:'a320_actx_c2'::JSONB) ->> 'action' = 'decide' AND jsonb_array_length((:'a320_actx_c2'::JSONB) -> 'messages') = 1
  AND (:'a320_actx_c2'::JSONB) #>> '{messages,0,text}' = 'Добрый день, интересует Малайзия',
  'P4: a chat with no student is handed to the decision with its messages, as before: ' || :'a320_actx_c2');
-- Student 2 gets a second chat of the case (linked), a message of which reaches the decision stage through a row made by the owner.
SET LOCAL session_replication_role = replica;
UPDATE platform.communication_conversations SET canonical_client_id = pg_temp.a320_id(501), canonical_lead_id = pg_temp.a320_id(601)
  WHERE id = :'a320_c2'::UUID;
SET LOCAL session_replication_role = origin;
SELECT pg_temp.a320_agent(format('SELECT platform_ai_agent.autosend_context_v1(%L, ''a320-worker'', 120)', :'a320_dec_c2')) AS a320_actx_c2b \gset
SELECT pg_temp.a320_assert((:'a320_actx_c2b'::JSONB) ->> 'action' = 'skip' AND (:'a320_actx_c2b'::JSONB) ->> 'reasonCode' = 'ai_consent_missing'
  AND NOT ((:'a320_actx_c2b'::JSONB) ? 'messages') AND NOT ((:'a320_actx_c2b'::JSONB) ? 'lead')
  AND (SELECT status = 'skipped' AND reason_code = 'ai_consent_missing' AND lease_owner IS NULL
      FROM platform_private.ai_autosend_log WHERE id = :'a320_dec_c2'::UUID),
  'P4: a decision already queued for a chat whose student declined meanwhile gets no messages: skipped, no lease: ' || :'a320_actx_c2b');
SET LOCAL session_replication_role = replica;
UPDATE platform.communication_conversations SET canonical_client_id = NULL, canonical_lead_id = NULL WHERE id = :'a320_c2'::UUID;
SET LOCAL session_replication_role = origin;

-- The check itself, on every stage, for the declined chat and for the allowed ones (the first reason on the way is not ours).
CREATE FUNCTION pg_temp.a320_check(p_decision UUID, p_stage TEXT) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT platform_private.ai_autosend_check(l, p_stage, NULL, NULL) FROM platform_private.ai_autosend_log l WHERE l.id = p_decision
$$;
SELECT l.id AS a320_dec_c1 FROM platform_private.ai_autosend_log l WHERE l.client_message_id = :'a320_m2'::UUID \gset
SELECT pg_temp.a320_assert(pg_temp.a320_check(:'a320_dec_c1'::UUID, 'due') = 'ai_consent_missing'
  AND pg_temp.a320_check(:'a320_dec_c1'::UUID, 'commit') = 'ai_consent_missing'
  AND pg_temp.a320_check(:'a320_dec_c1'::UUID, 'authorize') = 'ai_consent_missing'
  AND pg_temp.a320_check(:'a320_dec_c3'::UUID, 'due') IS NULL
  AND pg_temp.a320_check(:'a320_dec_c3'::UUID, 'authorize') IS DISTINCT FROM 'ai_consent_missing',
  'P4: the check answers ai_consent_missing at due, commit and authorize for a declined student and not for the others');
-- The student allows: the same decision row passes the check again (the check follows the live decision).
SELECT pg_temp.a320_put(2, 'granted', '2026-10-25');
SELECT pg_temp.a320_assert(pg_temp.a320_check(:'a320_dec_c1'::UUID, 'due') IS DISTINCT FROM 'ai_consent_missing',
  'P4: after a grant the check no longer answers ai_consent_missing');
SELECT pg_temp.a320_put(2, 'declined', '2026-10-25');

-- The night summary hands Gemini the messages of the chats it covers: not the refused one.
INSERT INTO platform_private.ai_autosend_summaries (id, organization_id, interval_start, interval_end, shadow_night, counts, items)
VALUES (pg_temp.a320_id(5101), pg_temp.a320_id(1), clock_timestamp() - INTERVAL '1 day', clock_timestamp() + INTERVAL '1 hour', TRUE, '{}'::JSONB,
  jsonb_build_array(jsonb_build_object('conversationId', :'a320_c1'::UUID, 'qualification', '{}'::JSONB),
    jsonb_build_object('conversationId', :'a320_c2'::UUID, 'qualification', '{}'::JSONB)));
SELECT pg_temp.a320_agent(format('SELECT platform_ai_agent.autosend_summary_context_v1(%L, ''a320-worker'', 120)', pg_temp.a320_id(5101))) AS a320_sum_no \gset
SELECT pg_temp.a320_put(2, 'granted', '2026-10-25');
UPDATE platform_private.ai_autosend_summaries SET lease_owner = NULL, lease_expires_at = NULL WHERE id = pg_temp.a320_id(5101);
SELECT pg_temp.a320_agent(format('SELECT platform_ai_agent.autosend_summary_context_v1(%L, ''a320-worker'', 120)', pg_temp.a320_id(5101))) AS a320_sum_yes \gset
SELECT pg_temp.a320_assert(
  (:'a320_sum_no'::JSONB) ->> 'status' = 'claimed' AND jsonb_array_length((:'a320_sum_no'::JSONB) -> 'chats') = 1
  AND (:'a320_sum_no'::JSONB) #>> '{chats,0,conversationId}' = :'a320_c2'
  AND (:'a320_sum_no'::JSONB)::TEXT NOT LIKE '%Сколько стоит обучение%' AND (:'a320_sum_no'::JSONB)::TEXT NOT LIKE '%хочу учиться в Китае%'
  AND jsonb_array_length((:'a320_sum_yes'::JSONB) -> 'chats') = 2
  AND (:'a320_sum_yes'::JSONB)::TEXT LIKE '%Сколько стоит обучение%',
  'P4: the night summary takes the chat with no student and leaves out the declined student''s chat; after a grant it takes both: '
  || :'a320_sum_no');
SELECT pg_temp.a320_assert(
  platform_private.ai_autosend_reason_ru('ai_consent_missing') = 'Студент не дал согласия на ИИ-помощников'
  AND platform_private.ai_autosend_reason_ru('no_consent') = 'Нет согласия на передачу текстов в Gemini'
  AND platform_private.ai_autosend_reason_ru('paused') = 'Автоответчик на паузе',
  'P4: the reason has its Russian words and the older ones are unchanged');


-- 8d. Document recognition (queue 162/163): the file of the case goes to Google only for a student who allowed. The real
--     chain: configuration, profile, a source with the scan proof of the real ingress RPCs, enqueue, claim, source grant.
INSERT INTO platform_private.document_recognition_configs(organization_id, config, registry_version, prompt_policy_version, enabled)
VALUES (pg_temp.a320_id(1),
  '{"enabled":true,"projectId":"a320-project","model":"gemini-3.1-flash","configVersion":"a320-v1",
    "pricingPolicyVersion":"a320-price-v1","paidProjectId":"a320-project","paidEligibilityReference":"a320-no-billing-proof",
    "perJobBudgetMicros":10000,"dailyOrgBudgetMicros":100000,"inputTokenCeiling":10000,"outputTokenCeiling":6000,
    "inputMicrosPerMillionTokens":100000,"outputMicrosPerMillionTokens":200000}'::JSONB,
  'evo-profile-61-v1', 'a320-prompt-v1', TRUE);
SELECT pg_temp.a320_as(1, format('SELECT platform.start_student_profile(%L, %L, 0, ''A320 partial profile'', %L)',
  pg_temp.a320_id(1), pg_temp.a320_id(701), pg_temp.a320_id(5201))) AS a320_prof \gset
SELECT pg_temp.a320_assert(NOT ((:'a320_prof'::JSONB) ? 'error'), 'the staff starts the profile of case 701: ' || :'a320_prof');
INSERT INTO platform.document_slots(id, organization_id, student_case_id, requirement_id, intent_kind, display_label, group_label, created_by_membership_id)
VALUES (pg_temp.a320_id(812), pg_temp.a320_id(1), pg_temp.a320_id(701), NULL, 'custom', 'A320 recognition source', 'A320 documents', pg_temp.a320_id(301));
SELECT pg_temp.a320_svc(format('SELECT platform.reserve_document_upload_after_ingress_scan(%L, %L, %L, ''a320.pdf'', ''application/pdf'', 128, %L, ''clean'', ''ClamAV'', ''1.5.3'', ''27889'', ''clamd-zinstream-v1'', statement_timestamp(), %L)',
  pg_temp.a320_id(1), pg_temp.a320_id(101), pg_temp.a320_id(812), repeat('b', 64), pg_temp.a320_id(5202))) AS a320_up \gset
SELECT pg_temp.a320_assert(NOT ((:'a320_up'::JSONB) ? 'error'), 'the ingress reserves the upload: ' || :'a320_up');
INSERT INTO storage.buckets(id, name, public) VALUES ('platform-documents', 'platform-documents', FALSE) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.objects(bucket_id, name, metadata, created_at)
VALUES ((:'a320_up'::JSONB) ->> 'bucket_id', (:'a320_up'::JSONB) ->> 'object_name', '{"size":128,"mimetype":"application/pdf"}', statement_timestamp());
SELECT pg_temp.a320_svc(format('SELECT platform.finalize_document_upload_with_scan(%L, %L, ''ClamAV'', ''1.5.3'', ''27889'', ''clamd-zinstream-v1'', %L, statement_timestamp(), %L)',
  pg_temp.a320_id(1), (:'a320_up'::JSONB) ->> 'upload_reservation_id', repeat('b', 64), pg_temp.a320_id(5203))) AS a320_fin \gset
SELECT pg_temp.a320_assert(NOT ((:'a320_fin'::JSONB) ? 'error'), 'the ingress finalizes the upload with its scan proof: ' || :'a320_fin');
SELECT (:'a320_up'::JSONB) ->> 'document_version_id' AS a320_ver \gset
CREATE FUNCTION pg_temp.a320_enqueue(p_request INTEGER, p_retry UUID DEFAULT NULL) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a320_as(1, format('SELECT platform.enqueue_document_recognition(%L, %L, %L, 1, %L, %L)',
    pg_temp.a320_id(1), pg_temp.a320_id(701), current_setting('a320.ver'), pg_temp.a320_id(p_request), p_retry))
$$;
SELECT set_config('a320.ver', :'a320_ver', TRUE);
CREATE FUNCTION pg_temp.a320_jobs() RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT count(*) FROM platform_private.document_recognition_jobs WHERE organization_id = pg_temp.a320_id(1)
$$;

-- A student who has not allowed: nothing is queued.
SELECT pg_temp.a320_put(2, 'declined', '2026-10-25');
SELECT pg_temp.a320_enqueue(5301) AS a320_enq_no \gset
SELECT pg_temp.a320_put(2, NULL, NULL);
SELECT pg_temp.a320_enqueue(5302) AS a320_enq_none \gset
SELECT pg_temp.a320_assert(pg_temp.a320_err(:'a320_enq_no'::JSONB) = '42501' AND pg_temp.a320_msg(:'a320_enq_no'::JSONB) = 'ai_consent_missing'
  AND pg_temp.a320_err(:'a320_enq_none'::JSONB) = '42501' AND pg_temp.a320_msg(:'a320_enq_none'::JSONB) = 'ai_consent_missing'
  AND pg_temp.a320_jobs() = 0,
  'recognition: a declined student and a student never asked (with a portal account) cannot have the document enqueued; no job: '
  || :'a320_enq_no' || :'a320_enq_none');
-- Allowed: queued as before.
SELECT pg_temp.a320_put(2, 'granted', '2026-10-25');
SELECT pg_temp.a320_enqueue(5303) AS a320_enq_yes \gset
SELECT pg_temp.a320_assert((:'a320_enq_yes'::JSONB) ->> 'state' = 'queued' AND (:'a320_enq_yes'::JSONB) ->> 'replayed' = 'false' AND pg_temp.a320_jobs() = 1,
  'recognition: a student who allowed has the document queued as before: ' || :'a320_enq_yes');
-- The student declines while the job waits: the claim fails the job (access_revoked), releases the reservation, starts nothing.
SELECT pg_temp.a320_put(2, 'declined', '2026-10-25');
SELECT pg_temp.a320_svc('SELECT platform.claim_document_recognition(''a320-worker'')') AS a320_claim_no \gset
SELECT pg_temp.a320_assert((:'a320_claim_no'::JSONB) = 'null'::JSONB
  AND (SELECT j.state = 'failed' AND j.failure_code = 'access_revoked' AND j.reservation_released_at IS NOT NULL AND j.upload_started_at IS NULL
      FROM platform_private.document_recognition_jobs j WHERE j.id = ((:'a320_enq_yes'::JSONB) ->> 'job_id')::UUID)
  AND NOT EXISTS (SELECT 1 FROM platform_private.document_recognition_attempts)
  AND NOT EXISTS (SELECT 1 FROM platform_private.document_recognition_provider_files),
  'recognition: the claim of a job whose student declined meanwhile fails it as access_revoked, frees the budget and starts no attempt, no upload: '
  || :'a320_claim_no');
-- Allowed again: a retry is queued, claimed, and the worker is granted the exact file; then the student declines mid-flight.
SELECT pg_temp.a320_put(2, 'granted', '2026-10-25');
SELECT pg_temp.a320_enqueue(5304, ((:'a320_enq_yes'::JSONB) ->> 'job_id')::UUID) AS a320_enq_retry \gset
SELECT pg_temp.a320_svc('SELECT platform.claim_document_recognition(''a320-worker'')') AS a320_claim_yes \gset
SELECT pg_temp.a320_assert((:'a320_enq_retry'::JSONB) ->> 'state' = 'queued' AND (:'a320_claim_yes'::JSONB) ->> 'state' = 'preflight'
  AND (:'a320_claim_yes'::JSONB) ->> 'attempt_id' IS NOT NULL,
  'recognition: after a new grant the retry is queued and claimed: ' || :'a320_enq_retry' || :'a320_claim_yes');
SELECT pg_temp.a320_svc(format('SELECT platform.grant_document_recognition_source(%L, %L)', (:'a320_claim_yes'::JSONB) ->> 'attempt_id',
  (:'a320_claim_yes'::JSONB) ->> 'claim_token')) AS a320_grant_yes \gset
SELECT pg_temp.a320_assert((:'a320_grant_yes'::JSONB) ->> 'bucket_id' = 'platform-documents' AND (:'a320_grant_yes'::JSONB) ->> 'object_name' IS NOT NULL
  AND (SELECT count(*) = 1 FROM platform.document_access_events WHERE access_purpose = 'document_recognition'),
  'recognition: the worker is granted the exact file of an allowed student (one access event): ' || :'a320_grant_yes');
SELECT pg_temp.a320_put(2, 'declined', '2026-10-25');
SELECT pg_temp.a320_svc(format('SELECT platform.grant_document_recognition_source(%L, %L)', (:'a320_claim_yes'::JSONB) ->> 'attempt_id',
  (:'a320_claim_yes'::JSONB) ->> 'claim_token')) AS a320_grant_no \gset
SELECT pg_temp.a320_svc(format('SELECT platform.renew_document_recognition_lease(%L, %L)', (:'a320_claim_yes'::JSONB) ->> 'attempt_id',
  (:'a320_claim_yes'::JSONB) ->> 'claim_token')) AS a320_renew_no \gset
SELECT pg_temp.a320_svc(format('SELECT platform.begin_document_recognition_upload(%L, %L)', (:'a320_claim_yes'::JSONB) ->> 'attempt_id',
  (:'a320_claim_yes'::JSONB) ->> 'claim_token')) AS a320_upload_no \gset
SELECT pg_temp.a320_assert(
  pg_temp.a320_msg(:'a320_grant_no'::JSONB) = 'ai_consent_missing' AND pg_temp.a320_err(:'a320_grant_no'::JSONB) = '42501'
  AND pg_temp.a320_msg(:'a320_renew_no'::JSONB) = 'ai_consent_missing' AND pg_temp.a320_msg(:'a320_upload_no'::JSONB) = 'ai_consent_missing'
  AND (SELECT count(*) = 1 FROM platform.document_access_events WHERE access_purpose = 'document_recognition')
  AND (SELECT upload_started_at IS NULL FROM platform_private.document_recognition_jobs WHERE id = ((:'a320_claim_yes'::JSONB) ->> 'job_id')::UUID)
  AND NOT EXISTS (SELECT 1 FROM platform_private.document_recognition_provider_files),
  'recognition: after a decline the same attempt gets no new grant, no lease renewal and no upload (ai_consent_missing); nothing goes to the provider: '
  || :'a320_grant_no' || :'a320_renew_no' || :'a320_upload_no');
-- Every stage of the queue goes through the one check; a case without a portal account passes it.
SELECT pg_temp.a320_assert(
  (SELECT count(*) = 8 FROM pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE
    AND p.proname IN ('enqueue_document_recognition', 'claim_document_recognition', 'renew_document_recognition_lease',
      'grant_document_recognition_source', 'seal_document_recognition_preflight', 'begin_document_recognition_upload',
      'begin_document_recognition_generation', 'publish_document_recognition_proposals')
    AND strpos(p.prosrc, 'document_recognition_require_actor(') > 0),
  'recognition: the eight stages that touch the source or publish call the one check');
CREATE FUNCTION pg_temp.a320_try(p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END
$$;
CREATE FUNCTION pg_temp.a320_require(p_case INTEGER) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT pg_temp.a320_try(format('SELECT platform_private.document_recognition_require_actor(%L, %L, %L, %L)',
    pg_temp.a320_id(1), pg_temp.a320_id(p_case), pg_temp.a320_id(101), pg_temp.a320_id(301)))
$$;
SELECT pg_temp.a320_put(2, 'declined', '2026-10-25');
SELECT pg_temp.a320_assert(pg_temp.a320_require(702) = 'ok' AND pg_temp.a320_require(701) = '42501:ai_consent_missing',
  'recognition: the check passes for a case whose student has no portal account and refuses the declined one');
SELECT pg_temp.a320_put(2, 'granted', '2026-10-25');
SELECT pg_temp.a320_assert(pg_temp.a320_require(701) = 'ok', 'recognition: and passes once that student allows');
-- A staff member without the rights learns nothing of the consent: the older refusal comes first.
SELECT pg_temp.a320_put(2, 'declined', '2026-10-25');
SELECT pg_temp.a320_assert(pg_temp.a320_try(format('SELECT platform_private.document_recognition_require_actor(%L, %L, %L, %L)',
  pg_temp.a320_id(1), pg_temp.a320_id(701), pg_temp.a320_id(102), pg_temp.a320_id(302))) = '42501:unavailable',
  'recognition: the order of the check is kept - a caller without the staff rights gets the old "unavailable", not the consent state');


-- 8e. The legacy Gemini proposals (U9, 066): the staff request and the service's context both refuse a declined student.
CREATE FUNCTION pg_temp.a320_u9_request(p_conv UUID, p_msg UUID, p_req INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a320_as(1, format('SELECT to_jsonb(r) FROM platform.request_gemini_proposal(%L, %L, %L, %L, ''gemini-3.7-flash'', 2, ''u9-gemini-human-review-v1'', ''A320 check'') r',
    pg_temp.a320_id(1), p_conv, p_msg, pg_temp.a320_id(p_req)))
$$;
CREATE FUNCTION pg_temp.a320_u9_begin(p_conv UUID, p_msg UUID, p_req INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a320_svc(format('SELECT to_jsonb(b) FROM platform.begin_gemini_proposal(%L, %L, %L, %L, ''gemini-3.7-flash'', 2, ''u9-gemini-human-review-v1'') b',
    pg_temp.a320_id(1), p_conv, p_msg, pg_temp.a320_id(p_req)))
$$;
SELECT pg_temp.a320_put(2, 'declined', '2026-10-25');
SELECT pg_temp.a320_u9_request(:'a320_c1'::UUID, :'a320_m2'::UUID, 5401) AS a320_u9_no \gset
SELECT pg_temp.a320_assert(pg_temp.a320_err(:'a320_u9_no'::JSONB) = '42501' AND pg_temp.a320_msg(:'a320_u9_no'::JSONB) = 'ai_consent_missing'
  AND NOT EXISTS (SELECT 1 FROM platform_private.gemini_proposal_request_receipts),
  'U9: the staff request for a declined student''s chat is refused (ai_consent_missing) and leaves no receipt: ' || :'a320_u9_no');
SELECT pg_temp.a320_put(2, 'granted', '2026-10-25');
SELECT pg_temp.a320_u9_request(:'a320_c1'::UUID, :'a320_m2'::UUID, 5402) AS a320_u9_yes \gset
SELECT pg_temp.a320_assert(NOT ((:'a320_u9_yes'::JSONB) ? 'error') AND (SELECT count(*) = 1 FROM platform_private.gemini_proposal_request_receipts),
  'U9: a student who allowed - the request is taken as before: ' || :'a320_u9_yes');
SELECT pg_temp.a320_put(2, 'declined', '2026-10-25');
SELECT pg_temp.a320_u9_begin(:'a320_c1'::UUID, :'a320_m2'::UUID, 5402) AS a320_u9_begin_no \gset
SELECT pg_temp.a320_assert(pg_temp.a320_err(:'a320_u9_begin_no'::JSONB) = '42501' AND pg_temp.a320_msg(:'a320_u9_begin_no'::JSONB) = 'ai_consent_missing'
  AND NOT EXISTS (SELECT 1 FROM platform_private.gemini_proposal_requests),
  'U9: the service gets no message text for a student who declined after the request, and no request is stored: ' || :'a320_u9_begin_no');
SELECT pg_temp.a320_put(2, 'granted', '2026-10-25');
SELECT pg_temp.a320_u9_begin(:'a320_c1'::UUID, :'a320_m2'::UUID, 5402) AS a320_u9_begin_yes \gset
SELECT pg_temp.a320_assert(NOT ((:'a320_u9_begin_yes'::JSONB) ? 'error') AND (:'a320_u9_begin_yes'::JSONB) #>> '{context,source_message,body_text}' = 'Сколько стоит обучение?',
  'U9: for a student who allowed the service gets the context as before: ' || :'a320_u9_begin_yes');
SELECT pg_temp.a320_put(2, 'declined', '2026-10-25');
SELECT pg_temp.a320_u9_begin(:'a320_c1'::UUID, :'a320_m2'::UUID, 5402) AS a320_u9_replay_no \gset
SELECT pg_temp.a320_assert(pg_temp.a320_msg(:'a320_u9_replay_no'::JSONB) = 'ai_consent_missing',
  'U9: the stored context is not replayed to the service after a decline either: ' || :'a320_u9_replay_no');

\echo A320_STUDENT_AI_CONSENT_SUITE_PASSED
ROLLBACK;
