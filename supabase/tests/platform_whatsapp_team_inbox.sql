\set ON_ERROR_STOP on
-- Boundary suite for migration 261 (owner decision 06.10.2026, «нет, все могут»):
-- every staff member who may work with WhatsApp sees the sales WhatsApp
-- conversations and answers them from the CRM, not only the member who owns
-- them. Runs on the LATEST chain with its own synthetic organizations; no
-- provider, Auth invitation, real person or production action. Members are
-- modelled EXACTLY like production (the fixtures of the 244/248 suites): invited
-- staff have organization_memberships.current_role NULL, the JWT says 'staff',
-- and permissions come only from scoped role assignments with the production
-- permission keys (Admissions 35 keys at `own`, Admissions Manager 36 and Sales
-- Manager 23 at `department`, the two «общие разделы» roles at `organization`).
-- Only the system Admin (the intake owner, the head of sales) carries the coarse
-- role. Every conversation is created by the REAL WAHA projection chain
-- (enqueue, exact claim, project, finish) and every reply goes through the REAL
-- manual-send chain (request -> authority trigger -> exact claim -> finish).
--
-- Proves:
--  1. the problem: with the migration-155 evaluator (261 reverted inside this
--     transaction) a non-owner Admissions member lists no sales conversation and
--     the send request is refused 42501; the suite is therefore RED without 261;
--  2. after 261, through the real RPCs and direct RLS selects, Admissions
--     (own), the Admissions Manager (department), a non-admin Sales Manager
--     (department), a role without AI review and a read-only role list the sales
--     conversations, snapshot them, page their messages and read the command
--     context and the latest send attempt; the Admin sees everything;
--  3. no widening beyond that: a role without communication keys, the Student,
--     another organization's Admin and anonymous callers are refused/empty; a
--     record-scoped reader sees exactly the granted conversation; a handed-off
--     (curator-queue) conversation stays owner-scoped (the curator, and the
--     department of the owner as before, only); every other conversation
--     permission in the EVALUATOR (read.summary, ai.draft.*, decision.*) and every
--     other resource (lead, student case) stays owner-scoped; no cross-tenant
--     match. NOTE: the direct-SELECT RLS policies of the AI draft tables and the
--     Gemini readers do not use that evaluator key (044/091/096): they gate on
--     communication.read.full of the conversation (and, for the readers, on
--     ai.draft.review as a plain permission), so a holder of ai.draft.review who
--     reads a sales chat reads its drafts; AI is off, to be decided before it is
--     switched on (docs/PLAN_CHANGES.md, 2026-10-06 clarification);
--  4. a non-owner replies: the request is authorized, the authority trigger
--     records the access version, the exact claim creates the sender participant
--     of THAT member (kind sales) and finish stores the outbound message with
--     that participant; the audit event names the member's profile; a second
--     member cannot reply to the same inbound message, yet a second member does
--     answer the customer's NEXT message with its own participant (4b); a member without
--     communication.manual.send, a curator-queue conversation, a Student and a
--     foreign-organization Admin are refused 42501;
--  4c/4d. the identity and assignment filters still bind: inactive/blocked/invited
--     membership, blocked profile, archived role and revoked assignment lose both
--     keys at the evaluator, and a revoked assignment with a still-valid JWT is
--     refused by the real readers and the send request (positive control around
--     each case);
--  5. the evaluator is still a hardened definer nobody can execute directly, the
--     sibling matcher is byte-identical to migration 155, and the Gemini readers
--     keep requiring ai.draft.review (the page guards that coupling).
BEGIN;

DO $n261_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$n261_auth_role$;

CREATE FUNCTION pg_temp.n261_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('26100000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
-- Identifiers of the WAHA projection chain (disjoint from the fixture ids).
CREATE FUNCTION pg_temp.n261_wid(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('26100000-0000-4000-9000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.n261_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'N261: %', message; END IF;
END
$$;
-- SQLSTATE of a failing statement, or 'ok'.
CREATE FUNCTION pg_temp.n261_error(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END
$$;
CREATE FUNCTION pg_temp.n261_sorted(VARIADIC ids UUID[]) RETURNS UUID[] LANGUAGE SQL IMMUTABLE AS $$
  SELECT COALESCE(array_agg(i ORDER BY i), ARRAY[]::UUID[]) FROM unnest(ids) AS i
$$;
-- What the current actor reads: the real queue read, the real direct selects.
CREATE FUNCTION pg_temp.n261_page() RETURNS UUID[] LANGUAGE SQL AS $$
  SELECT COALESCE(array_agg(p.conversation_id ORDER BY p.conversation_id), ARRAY[]::UUID[])
  FROM platform.staff_communication_page(pg_temp.n261_id(1), 100) AS p
$$;
CREATE FUNCTION pg_temp.n261_rls_conversations() RETURNS UUID[] LANGUAGE SQL AS $$
  SELECT COALESCE(array_agg(c.id ORDER BY c.id), ARRAY[]::UUID[]) FROM platform.communication_conversations AS c
$$;
CREATE FUNCTION pg_temp.n261_rls_message_conversations() RETURNS UUID[] LANGUAGE SQL AS $$
  SELECT COALESCE(array_agg(DISTINCT m.conversation_id ORDER BY m.conversation_id), ARRAY[]::UUID[])
  FROM platform.communication_messages AS m
$$;
CREATE FUNCTION pg_temp.n261_rls_participant_conversations() RETURNS UUID[] LANGUAGE SQL AS $$
  SELECT COALESCE(array_agg(DISTINCT p.conversation_id ORDER BY p.conversation_id), ARRAY[]::UUID[])
  FROM platform.conversation_participants AS p
$$;
CREATE FUNCTION pg_temp.n261_snapshot(p_conversation UUID) RETURNS INTEGER LANGUAGE SQL AS $$
  SELECT count(*)::INTEGER FROM platform.staff_communication_snapshot(pg_temp.n261_id(1), p_conversation)
$$;
CREATE FUNCTION pg_temp.n261_messages(p_conversation UUID) RETURNS INTEGER LANGUAGE SQL AS $$
  SELECT count(*)::INTEGER FROM platform.staff_conversation_message_page(pg_temp.n261_id(1), p_conversation, 50)
$$;
-- The readers of one conversation, each as 'rows:N' or the SQLSTATE it raised.
CREATE FUNCTION pg_temp.n261_reader(p_reader TEXT, p_conversation UUID) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE n BIGINT;
BEGIN
  EXECUTE format(CASE p_reader
    WHEN 'page' THEN 'SELECT count(*) FROM platform.staff_conversation_message_page(%L, %L, 50)'
    WHEN 'context' THEN 'SELECT count(*) FROM platform.staff_communication_command_context(%L, %L)'
    WHEN 'attempt' THEN 'SELECT count(*) FROM platform.staff_latest_manual_whatsapp_send_attempt(%L, %L)'
    WHEN 'gemini' THEN 'SELECT count(*) FROM platform.staff_gemini_proposal(%L, %L)'
    WHEN 'gemini_reviews' THEN 'SELECT count(*) FROM platform.staff_gemini_proposal_reviews(%L, %L, 20)'
  END, pg_temp.n261_id(1), p_conversation) INTO n;
  RETURN 'rows:' || n;
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END
$$;
CREATE FUNCTION pg_temp.n261_key(p_conversation UUID, p_message UUID) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(array_to_json(ARRAY['evo-platform-work-v1', 'manual_whatsapp_send',
    pg_temp.n261_id(1)::TEXT, p_conversation::TEXT, p_message::TEXT, 'staff-authored'])::TEXT, 'UTF8')), 'hex')
$$;
-- The real manual-send request of the current actor: SQLSTATE, or 'ok'.
CREATE FUNCTION pg_temp.n261_request(p_conversation UUID, p_message UUID, p_text TEXT, p_request INTEGER) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT pg_temp.n261_error(format($q$SELECT platform.request_manual_whatsapp_send_with_authorization(%L, %L, %L, NULL, %L, 'staff_confirmed_manual_send', %L, %L)$q$,
    pg_temp.n261_id(1), p_conversation, p_message, p_text, pg_temp.n261_key(p_conversation, p_message), pg_temp.n261_id(p_request)))
$$;
-- Model of what the next lines call as `authenticated`/`anon`/`service_role`.
GRANT EXECUTE ON FUNCTION pg_temp.n261_id(INTEGER), pg_temp.n261_wid(INTEGER), pg_temp.n261_assert(BOOLEAN, TEXT),
  pg_temp.n261_error(TEXT), pg_temp.n261_sorted(UUID[]), pg_temp.n261_page(), pg_temp.n261_rls_conversations(),
  pg_temp.n261_rls_message_conversations(), pg_temp.n261_rls_participant_conversations(),
  pg_temp.n261_snapshot(UUID), pg_temp.n261_messages(UUID), pg_temp.n261_reader(TEXT, UUID),
  pg_temp.n261_key(UUID, UUID), pg_temp.n261_request(UUID, UUID, TEXT, INTEGER)
  TO authenticated, anon, service_role;

SELECT 'N261_WHATSAPP_TEAM_INBOX_SUITE_START' AS n261_suite_marker;

-- ---------------------------------------------------------------------------
-- Fixture. Organization 1: 1 Admin (system; the intake owner = head of sales);
-- invited staff with coarse role NULL: 2 Admissions A (own; also the curator of
-- the handed-off chat), 3 Admissions Manager (department Admissions), 4 Sales
-- Manager (department Sales, a non-admin), 5 «WhatsApp without AI review»,
-- 6 «WhatsApp read only», 7 «общие разделы» only (no WhatsApp keys),
-- 10 record-scoped reader; 8 Student. Organization 2: 9 an Admin of another
-- organization.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE n261_actors(n INTEGER, org INTEGER, coarse platform.business_role, claims TEXT);
INSERT INTO n261_actors(n, org, coarse) VALUES (1, 1, 'admin'), (2, 1, NULL), (3, 1, NULL), (4, 1, NULL), (5, 1, NULL),
  (6, 1, NULL), (7, 1, NULL), (8, 1, 'student'), (9, 2, 'admin'), (10, 1, NULL);
GRANT SELECT ON n261_actors TO authenticated, anon;

INSERT INTO platform.organizations(id, name) VALUES (pg_temp.n261_id(1), 'N261 Fictional organization'),
  (pg_temp.n261_id(2), 'N261 Other fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.n261_id(100 + n), 'n261-' || n || '@example.invalid', '{}'::JSONB FROM n261_actors;
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES (pg_temp.n261_id(199), 'n261-none@example.invalid', '{}'::JSONB);
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.n261_id(200 + n), pg_temp.n261_id(100 + n), 'N261 Actor ' || n, 'active', 1 FROM n261_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.n261_id(300 + a.n), pg_temp.n261_id(a.org), pg_temp.n261_id(200 + a.n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM n261_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE
  WHERE id IN (pg_temp.n261_id(301), pg_temp.n261_id(309));
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.n261_id(401), pg_temp.n261_id(1), 'organization', pg_temp.n261_id(1), 1),
  (pg_temp.n261_id(402), pg_temp.n261_id(2), 'organization', pg_temp.n261_id(2), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.n261_id(1), pg_temp.n261_id(301), pg_temp.n261_id(401), 1, 1, TRUE, 'system',
    'N261 synthetic organization scope', pg_temp.n261_id(601)),
  (pg_temp.n261_id(2), pg_temp.n261_id(309), pg_temp.n261_id(402), 1, 1, TRUE, 'system',
    'N261 synthetic other-organization scope', pg_temp.n261_id(602));

-- Departments in the production shape: sales (4), admissions (3, 2).
INSERT INTO platform.staff_departments(id, organization_id, name) VALUES
  (pg_temp.n261_id(901), pg_temp.n261_id(1), 'N261 Sales'),
  (pg_temp.n261_id(902), pg_temp.n261_id(1), 'N261 Admissions');
INSERT INTO platform.staff_organizational_details(organization_id, membership_id, department_id) VALUES
  (pg_temp.n261_id(1), pg_temp.n261_id(302), pg_temp.n261_id(902)),
  (pg_temp.n261_id(1), pg_temp.n261_id(303), pg_temp.n261_id(902)),
  (pg_temp.n261_id(1), pg_temp.n261_id(304), pg_temp.n261_id(901));

-- Roles with the EXACT production permission keys (26.09 read-only audit, as the
-- 248 suite) plus two custom WhatsApp roles.
CREATE TEMP TABLE n261_roles(role_id UUID, label TEXT, keys JSONB, request_base INTEGER);
INSERT INTO n261_roles VALUES
 (pg_temp.n261_id(1101), 'Admissions', '["ai.draft.request","ai.draft.review","application.manage","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1110),
 (pg_temp.n261_id(1102), 'Admissions Manager', '["ai.draft.request","ai.draft.review","application.manage","case.curator.assign","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1120),
 (pg_temp.n261_id(1103), 'Sales Manager', '["ai.draft.request","ai.draft.review","case.read.summary","case.workflow.read","client.read","communication.manual.send","communication.read.full","communication.read.summary","contract.draft.manage","contract.evidence.confirm","document.read.sales","finance.event.confirm","finance.first.payment.confirm","finance.read.summary","lead.read","lead.sales.owner.assign","lead.sales.workflow.manage","sales.register.manage","sales.register.read","staff.task.complete","staff.task.edit","staff.task.read","task.create"]', 1130),
 (pg_temp.n261_id(1104), 'Sales common', '["catalog.read","contract.template.read","knowledge.read.approved","organization.read","reply.snippet.all","reply.snippet.manage","reply.snippet.sales","staff.assistant.use","staff.task.create","team.chat.general","team.chat.sales","workflow.contract.read"]', 1140),
 (pg_temp.n261_id(1105), 'Admissions common', '["catalog.read","company.file.download","company.file.manage","company.file.read","company.file.upload","contract.template.read","knowledge.read.approved","organization.read","reply.snippet.admissions","reply.snippet.all","reply.snippet.manage","staff.assistant.use","staff.task.create","team.chat.admissions","team.chat.general","workflow.contract.read"]', 1150),
 (pg_temp.n261_id(1106), 'WhatsApp without AI review', '["communication.manual.send","communication.read.full"]', 1160),
 (pg_temp.n261_id(1107), 'WhatsApp read only', '["ai.draft.review","communication.read.full"]', 1170);
CREATE TEMP TABLE n261_grants(membership INTEGER, role_id UUID, scope JSONB);
INSERT INTO n261_grants VALUES
 (302, pg_temp.n261_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (302, pg_temp.n261_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n261_id(1), 'resourceKind', NULL)),
 (303, pg_temp.n261_id(1102), jsonb_build_object('kind', 'department', 'key', pg_temp.n261_id(902), 'resourceKind', NULL)),
 (303, pg_temp.n261_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n261_id(1), 'resourceKind', NULL)),
 (304, pg_temp.n261_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.n261_id(901), 'resourceKind', NULL)),
 (304, pg_temp.n261_id(1104), jsonb_build_object('kind', 'organization', 'key', pg_temp.n261_id(1), 'resourceKind', NULL)),
 (305, pg_temp.n261_id(1106), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (306, pg_temp.n261_id(1107), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (307, pg_temp.n261_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n261_id(1), 'resourceKind', NULL));
CREATE TEMP TABLE n261_versions AS SELECT m.id AS membership_id, p.access_version
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = pg_temp.n261_id(1);
GRANT SELECT ON n261_roles, n261_grants, n261_versions TO authenticated;

SELECT pg_temp.n261_assert((SELECT array_agg(jsonb_array_length(keys) ORDER BY request_base) FROM n261_roles)
  = ARRAY[35, 36, 23, 12, 16, 2, 2], 'role bundles have the production key counts 35/36/23/12/16 and the two custom roles');

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.n261_id(101),
  'claims', jsonb_build_object('sub', pg_temp.n261_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS n261_admin_setup \gset
SET LOCAL request.jwt.claims TO :'n261_admin_setup';
SET LOCAL ROLE authenticated;
DO $n261_roles$
DECLARE r RECORD; published JSONB; m INTEGER; items JSONB; bindings JSONB; bundles JSONB := '{}'::JSONB;
BEGIN
  FOR r IN SELECT * FROM n261_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.n261_id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', 'N261 ' || r.label, 'description', 'Migration 261 synthetic role',
        'permissionKeys', r.keys), 'N261 create role', pg_temp.n261_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.n261_id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.n261_id(1), r.role_id, 1) ->> 'impactFingerprint',
      'N261 publish role', pg_temp.n261_id(r.request_base + 2));
    bundles := bundles || jsonb_build_object(r.role_id::TEXT, published ->> 'bundleId');
  END LOOP;
  FOR m IN SELECT DISTINCT membership FROM n261_grants ORDER BY 1 LOOP
    SELECT jsonb_agg(jsonb_build_object('roleId', g.role_id, 'scope', g.scope) ORDER BY g.role_id),
      jsonb_agg(jsonb_build_object('roleId', g.role_id, 'roleVersion', 2,
        'bundleId', (bundles ->> g.role_id::TEXT)::UUID, 'bundleVersion', 1) ORDER BY g.role_id)
      INTO items, bindings FROM n261_grants g WHERE g.membership = m;
    PERFORM platform.staff_role_assignments_save(pg_temp.n261_id(1), pg_temp.n261_id(m),
      (SELECT access_version FROM n261_versions WHERE membership_id = pg_temp.n261_id(m)), items, bindings,
      'N261 grant roles', pg_temp.n261_id(2000 + m));
  END LOOP;
END
$n261_roles$;
RESET ROLE;

-- Claims from live rows after the grants bumped access versions, all minted by
-- the installed token hook (staff and Student).
UPDATE n261_actors a SET claims = (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.n261_id(100 + a.n),
  'claims', jsonb_build_object('sub', pg_temp.n261_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT;
SELECT claims AS n261_admin FROM n261_actors WHERE n = 1 \gset
SELECT claims AS n261_adm_a FROM n261_actors WHERE n = 2 \gset
SELECT claims AS n261_adm_mgr FROM n261_actors WHERE n = 3 \gset
SELECT claims AS n261_sales_mgr FROM n261_actors WHERE n = 4 \gset
SELECT claims AS n261_wa_no_ai FROM n261_actors WHERE n = 5 \gset
SELECT claims AS n261_wa_read FROM n261_actors WHERE n = 6 \gset
SELECT claims AS n261_common_only FROM n261_actors WHERE n = 7 \gset
SELECT claims AS n261_student FROM n261_actors WHERE n = 8 \gset
SELECT claims AS n261_other_org_admin FROM n261_actors WHERE n = 9 \gset
SELECT jsonb_build_object('sub', pg_temp.n261_id(199), 'role', 'authenticated')::TEXT AS n261_no_member \gset
SELECT pg_temp.n261_assert((SELECT array_agg(claims::JSONB ->> 'platform_role' ORDER BY n) FROM n261_actors WHERE n <> 10)
  = ARRAY['admin', 'staff', 'staff', 'staff', 'staff', 'staff', 'staff', 'student', 'admin'],
  'the JWT carries staff for invited members and admin only for the system Admins');
SELECT pg_temp.n261_assert((SELECT count(*) = 6 FROM platform.organization_memberships
  WHERE organization_id = pg_temp.n261_id(1) AND "current_role" IS NULL AND current_bundle_id IS NULL
    AND id IN (pg_temp.n261_id(302), pg_temp.n261_id(303), pg_temp.n261_id(304), pg_temp.n261_id(305),
      pg_temp.n261_id(306), pg_temp.n261_id(307))), 'invited members have coarse role and bundle NULL');

-- ---------------------------------------------------------------------------
-- Conversations through the REAL projection chain: three customers write to the
-- sales WhatsApp; the intake owner of each new conversation is the Admin (head
-- of sales). Customer 2's chat is handed off to a curator below.
-- ---------------------------------------------------------------------------
-- Clear the shared queue of earlier suites' leftovers so only this fixture is claimed.
UPDATE pgmq.q_platform_work_v1 SET vt = pg_catalog.clock_timestamp() + INTERVAL '1 day'
  WHERE vt <= pg_catalog.clock_timestamp();

CREATE FUNCTION pg_temp.n261_event(p_n INTEGER, p_event TEXT, p_payload JSONB) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE
  event_id CONSTANT UUID := pg_temp.n261_wid(1000 + p_n);
BEGIN
  INSERT INTO platform_private.provider_webhook_events (id, organization_id, provider, provider_account_ref,
    provider_conversation_ref, provider_event_variant_ref, provider_request_id, waha_session_name, payload_id,
    event_type, provider_occurred_at, verification_status, raw_payload, verification_headers,
    verification_evidence_ref, payload_sha256, request_id)
  VALUES (event_id, pg_temp.n261_id(1), 'waha', 'waha:crm_primary', NULL, NULL, 'n261-' || p_n, 'crm_primary',
    p_payload ->> 'id', p_event, TIMESTAMPTZ '2026-10-06 07:00:00+00' + p_n * INTERVAL '1 second',
    'verified', jsonb_build_object('event', p_event, 'session', 'crm_primary', 'payload', p_payload),
    '{"hmac_verified":true}', 'synthetic:n261:' || p_n, lpad(to_hex(p_n), 64, '0'), pg_temp.n261_wid(1500 + p_n));
  RETURN event_id;
END
$$;
-- Enqueue, claim, project and finish one verified event (the real chain).
CREATE FUNCTION pg_temp.n261_run(p_n INTEGER, p_payload JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  org CONSTANT UUID := pg_temp.n261_id(1);
  event_id UUID := pg_temp.n261_event(p_n, 'message.any', p_payload);
  enq JSONB; claim JSONB; proj JSONB; fin JSONB; work UUID; attempt UUID;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
  enq := platform.enqueue_verified_webhook_work(org, event_id,
    encode(sha256(convert_to('n261-message.any-' || (p_payload ->> 'id'), 'UTF8')), 'hex'), 8, pg_temp.n261_wid(2000 + p_n * 10 + 1));
  work := (enq ->> 'work_item_id')::UUID;
  claim := platform.claim_waha_webhook_work_item(org, work, 60, 'n261', pg_temp.n261_wid(2000 + p_n * 10 + 2));
  attempt := (claim ->> 'attempt_id')::UUID;
  proj := platform.project_claimed_waha_event(org, work, attempt, pg_temp.n261_id(301), pg_temp.n261_wid(2000 + p_n * 10 + 3));
  fin := platform.finish_waha_webhook_work(org, work, attempt, (proj ->> 'disposition')::platform.durable_work_finish_outcome,
    proj ->> 'error_code', proj ->> 'evidence_ref', NULL, pg_temp.n261_wid(2000 + p_n * 10 + 4));
  RETURN proj || jsonb_build_object('finish_state', fin ->> 'state');
END
$$;
CREATE FUNCTION pg_temp.n261_in(p_id TEXT, p_from TEXT, p_body TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT jsonb_build_object('id', p_id, 'timestamp', 1788343200, 'from', p_from, 'fromMe', false, 'source', 'app', 'body', p_body)
$$;
CREATE FUNCTION pg_temp.n261_conv(p_chat TEXT) RETURNS UUID LANGUAGE SQL AS $$
  SELECT binding.conversation_id FROM platform_private.waha_direct_chat_bindings binding
  WHERE binding.organization_id = pg_temp.n261_id(1) AND binding.normalized_chat_id = p_chat
$$;

SELECT pg_temp.n261_run(1, pg_temp.n261_in('false_79961000001@c.us_N261AAAAAAAAAAAAAAA1', '79961000001@c.us', 'Здравствуйте, первый клиент')) AS r1 \gset
SELECT pg_temp.n261_run(2, pg_temp.n261_in('false_79961000002@c.us_N261AAAAAAAAAAAAAAA2', '79961000002@c.us', 'Здравствуйте, второй клиент')) AS r2 \gset
SELECT pg_temp.n261_run(3, pg_temp.n261_in('false_79961000003@c.us_N261AAAAAAAAAAAAAAA3', '79961000003@c.us', 'Здравствуйте, третий клиент')) AS r3 \gset
SELECT pg_temp.n261_assert((:'r1'::JSONB ->> 'disposition') = 'succeeded' AND (:'r2'::JSONB ->> 'disposition') = 'succeeded'
  AND (:'r3'::JSONB ->> 'disposition') = 'succeeded' AND (:'r1'::JSONB ->> 'finish_state') = 'succeeded',
  'three customer messages project through the real chain');
SELECT pg_temp.n261_conv('79961000001@c.us') AS c1, pg_temp.n261_conv('79961000002@c.us') AS c2,
  pg_temp.n261_conv('79961000003@c.us') AS c3 \gset
SELECT m.id AS m1 FROM platform.communication_messages m WHERE m.conversation_id = :'c1' AND m.direction = 'inbound' \gset
SELECT m.id AS m3 FROM platform.communication_messages m WHERE m.conversation_id = :'c3' AND m.direction = 'inbound' \gset
SELECT pg_temp.n261_assert((SELECT count(*) = 3 AND bool_and(queue = 'sales'
    AND responsible_sales_membership_id = pg_temp.n261_id(301) AND current_curator_membership_id IS NULL
    AND waha_session_name = 'crm_primary')
  FROM platform.communication_conversations WHERE id IN (:'c1', :'c2', :'c3')),
  'the real chain makes three sales-queue conversations owned by the intake owner (the Admin)');

-- Customer 2's chat is handed off to Admissions A (the curator): the state the
-- assignment trigger leaves (044), written as the table owner with a synthetic
-- active case, so that this conversation is a curator-queue chat.
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.n261_id(421), pg_temp.n261_id(1), 'student_case', pg_temp.n261_id(501), 1);
SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases(id, organization_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, operational_stage, state, handoff_at,
  current_scope_id, current_scope_version, pipeline_stage)
VALUES (pg_temp.n261_id(501), pg_temp.n261_id(1), pg_temp.n261_id(301), pg_temp.n261_id(302),
  'synthetic:n261:1', 'N261 Student 501', 'MY', 'Bachelor', 'contract_confirmed', 'active', clock_timestamp(),
  pg_temp.n261_id(421), 1, 'new');
-- A curator-queue chat is a provider-linked one (060's authority-source check).
UPDATE platform.communication_conversations SET student_case_id = pg_temp.n261_id(501), queue = 'curator',
  current_curator_membership_id = pg_temp.n261_id(302), current_scope_id = pg_temp.n261_id(421), current_scope_version = 1,
  sales_authority_source = 'provider_linked', amocrm_account_id = 261, amocrm_lead_id = 261, amocrm_contact_id = 261
  WHERE id = :'c2';
SET LOCAL session_replication_role = origin;
SELECT pg_temp.n261_assert((SELECT queue = 'curator' AND current_curator_membership_id = pg_temp.n261_id(302)
  FROM platform.communication_conversations WHERE id = :'c2'), 'conversation 2 is a curator-queue chat of Admissions A');
-- A lead of the head of sales (the owner of the sales conversations).
INSERT INTO platform.clients(id, organization_id, display_name, normalized_name) VALUES
  (pg_temp.n261_id(701), pg_temp.n261_id(1), 'N261 Client', platform_private.normalize_person_name('N261 Client'));
INSERT INTO platform.leads(id, organization_id, client_id, current_owner_membership_id, stage_key, source_key) VALUES
  (pg_temp.n261_id(702), pg_temp.n261_id(1), pg_temp.n261_id(701), pg_temp.n261_id(301), 'new', 'website');

-- A record-scoped reader of conversation 3 only (the Admin grants it).
SELECT set_config('n261.c3', :'c3', TRUE);
SET LOCAL request.jwt.claims TO :'n261_admin_setup';
SET LOCAL ROLE authenticated;
DO $n261_record$
DECLARE published JSONB; bundle UUID; v BIGINT;
BEGIN
  PERFORM platform.staff_role_command(pg_temp.n261_id(1), pg_temp.n261_id(1108), 0, 'create',
    jsonb_build_object('label', 'N261 WhatsApp one conversation', 'description', 'Migration 261 synthetic role',
      'permissionKeys', '["ai.draft.review","communication.read.full"]'::JSONB), 'N261 create role', pg_temp.n261_id(1181));
  published := platform.staff_role_publish(pg_temp.n261_id(1), pg_temp.n261_id(1108), 1,
    platform.staff_role_impact(pg_temp.n261_id(1), pg_temp.n261_id(1108), 1) ->> 'impactFingerprint',
    'N261 publish role', pg_temp.n261_id(1182));
  bundle := (published ->> 'bundleId')::UUID;
  SELECT access_version INTO v FROM n261_versions WHERE membership_id = pg_temp.n261_id(310);
  PERFORM platform.staff_role_assignments_save(pg_temp.n261_id(1), pg_temp.n261_id(310), v,
    jsonb_build_array(jsonb_build_object('roleId', pg_temp.n261_id(1108), 'scope',
      jsonb_build_object('kind', 'record', 'key', current_setting('n261.c3'), 'resourceKind', 'conversation'))),
    jsonb_build_array(jsonb_build_object('roleId', pg_temp.n261_id(1108), 'roleVersion', 2, 'bundleId', bundle, 'bundleVersion', 1)),
    'N261 grant one conversation', pg_temp.n261_id(2310));
END
$n261_record$;
RESET ROLE;

UPDATE n261_actors a SET claims = (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.n261_id(100 + a.n),
  'claims', jsonb_build_object('sub', pg_temp.n261_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT
  WHERE a.n = 10;
SELECT claims AS n261_record_reader FROM n261_actors WHERE n = 10 \gset
SELECT pg_temp.n261_assert((SELECT count(*) = 1 FROM platform.staff_role_assignments
  WHERE membership_id = pg_temp.n261_id(310) AND scope_kind = 'record' AND resource_kind = 'conversation'
    AND scope_key = :'c3' AND revoked_at IS NULL), 'the record-scoped reader holds exactly conversation 3');


-- ---------------------------------------------------------------------------
-- 1. The problem, red without 261: the migration-155 evaluator (261 reverted
--    inside this transaction) leaves a non-owner Admissions member with no sales
--    conversation and no way to reply. The revert must give back the byte-identical
--    155 source; the migration's own definition is restored afterwards.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.n261_exec(sql TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN EXECUTE sql; END
$$;
SELECT pg_get_functiondef('platform_private.staff_access_evaluate(uuid,uuid,text,text,uuid,boolean)'::regprocedure) AS n261_patched \gset
SELECT md5(prosrc) AS n261_patched_md5 FROM pg_proc
  WHERE oid = 'platform_private.staff_access_evaluate(uuid,uuid,text,text,uuid,boolean)'::regprocedure \gset
SELECT pg_temp.n261_assert(:'n261_patched_md5' <> '8723a6a5efb7ec0436da12f2c02e2462',
  'the installed evaluator is the 261 definition, not the 155 one');
SELECT regexp_replace(:'n261_patched',
  E'\\n  UNION ALL SELECT p_membership_id,NULL::UUID,NULL::TEXT WHERE NOT p_receiving_assignment.*?(\\n \\)\\n SELECT EXISTS)',
  E'\\1') AS n261_reverted \gset
SELECT pg_temp.n261_assert(:'n261_reverted' <> :'n261_patched', 'the 261 context row was found and removed');
SELECT pg_temp.n261_exec(:'n261_reverted');
SELECT pg_temp.n261_assert((SELECT md5(prosrc) = '8723a6a5efb7ec0436da12f2c02e2462' FROM pg_proc
  WHERE oid = 'platform_private.staff_access_evaluate(uuid,uuid,text,text,uuid,boolean)'::regprocedure),
  'without 261 the evaluator is byte-identical to migration 155');

SET LOCAL request.jwt.claims TO :'n261_adm_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n261_assert(pg_temp.n261_page() = pg_temp.n261_sorted(:'c2'),
  'RED without 261: Admissions A lists only the chat it is the curator of, no sales conversation');
SELECT pg_temp.n261_assert(pg_temp.n261_snapshot(:'c1') = 0, 'RED without 261: no snapshot of a sales conversation');
SELECT pg_temp.n261_assert(pg_temp.n261_reader('context', :'c1') = 'rows:0' AND pg_temp.n261_reader('page', :'c1') = '42501',
  'RED without 261: no command context and no transcript');
SELECT pg_temp.n261_assert(pg_temp.n261_request(:'c1', :'m1', 'N261 baseline', 3011) = '42501',
  'RED without 261: the manual-send request is refused');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n261_wa_read';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n261_assert(pg_temp.n261_page() = ARRAY[]::UUID[], 'RED without 261: a read-only member lists nothing');
RESET ROLE;

SELECT pg_temp.n261_exec(:'n261_patched');
SELECT pg_temp.n261_assert((SELECT md5(prosrc) = :'n261_patched_md5' FROM pg_proc
  WHERE oid = 'platform_private.staff_access_evaluate(uuid,uuid,text,text,uuid,boolean)'::regprocedure),
  'the 261 definition is back');

-- ---------------------------------------------------------------------------
-- 2. After 261: who lists, reads and snapshots what, through the real RPCs and
--    direct RLS selects. Sales conversations: c1, c3; curator chat: c2.
-- ---------------------------------------------------------------------------
-- The Admin (head of sales, the owner of the sales chats) sees everything.
SET LOCAL request.jwt.claims TO :'n261_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n261_assert(pg_temp.n261_page() = pg_temp.n261_sorted(:'c1', :'c2', :'c3'), 'Admin: every conversation');
SELECT pg_temp.n261_assert(pg_temp.n261_rls_conversations() = pg_temp.n261_sorted(:'c1', :'c2', :'c3'), 'Admin: direct select');
RESET ROLE;

-- Admissions A (own scope; the curator of c2): the sales chats are visible now.
SET LOCAL request.jwt.claims TO :'n261_adm_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n261_assert(pg_temp.n261_page() = pg_temp.n261_sorted(:'c1', :'c2', :'c3'),
  'Admissions A lists both sales chats and its own handed-off chat');
SELECT pg_temp.n261_assert(pg_temp.n261_rls_conversations() = pg_temp.n261_page(), 'Admissions A: direct select equals the page');
SELECT pg_temp.n261_assert(pg_temp.n261_rls_message_conversations() = pg_temp.n261_page(), 'Admissions A: messages of every listed chat');
SELECT pg_temp.n261_assert(pg_temp.n261_rls_participant_conversations() = pg_temp.n261_page(), 'Admissions A: participants of every listed chat');
SELECT pg_temp.n261_assert(pg_temp.n261_snapshot(:'c1') = 1 AND pg_temp.n261_snapshot(:'c3') = 1, 'Admissions A: snapshots of the sales chats');
SELECT pg_temp.n261_assert(pg_temp.n261_messages(:'c1') = 1, 'Admissions A: pages the transcript of a sales chat');
SELECT pg_temp.n261_assert(pg_temp.n261_reader('context', :'c1') = 'rows:1' AND pg_temp.n261_reader('attempt', :'c1') LIKE 'rows:%'
  AND pg_temp.n261_reader('page', :'c1') = 'rows:1', 'Admissions A: transcript, command context and latest send attempt of a sales chat');
SELECT pg_temp.n261_assert(pg_temp.n261_reader('gemini', :'c1') LIKE 'rows:%' AND pg_temp.n261_reader('gemini_reviews', :'c1') LIKE 'rows:%',
  'Admissions A holds ai.draft.review: the Gemini readers answer');
SELECT pg_temp.n261_assert((SELECT count(*) = 2 FROM platform.staff_communication_page(pg_temp.n261_id(1), 100, p_queue => 'sales')),
  'the sales queue filter shows exactly the two sales chats');
SELECT pg_temp.n261_assert((SELECT count(*) = 1 FROM platform.staff_communication_page(pg_temp.n261_id(1), 100, p_queue => 'curator')),
  'the curator queue holds its one chat');
RESET ROLE;

-- Admissions Manager (department scope): same, the curator chat through the department of its owner as before.
SET LOCAL request.jwt.claims TO :'n261_adm_mgr';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n261_assert(pg_temp.n261_page() = pg_temp.n261_sorted(:'c1', :'c2', :'c3'), 'Admissions Manager: sales chats and, as before, the department curator chat');
SELECT pg_temp.n261_assert(pg_temp.n261_rls_conversations() = pg_temp.n261_page(), 'Admissions Manager: direct select equals the page');
RESET ROLE;

-- Sales Manager (department scope, a non-admin): the sales chats, never the other department's curator chat.
SET LOCAL request.jwt.claims TO :'n261_sales_mgr';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n261_assert(pg_temp.n261_page() = pg_temp.n261_sorted(:'c1', :'c3'), 'Sales Manager: the sales chats only');
SELECT pg_temp.n261_assert(pg_temp.n261_rls_conversations() = pg_temp.n261_page(), 'Sales Manager: direct select equals the page');
SELECT pg_temp.n261_assert(pg_temp.n261_reader('page', :'c2') = '42501' AND pg_temp.n261_reader('context', :'c2') = 'rows:0'
  AND pg_temp.n261_reader('attempt', :'c2') = '42501' AND pg_temp.n261_snapshot(:'c2') = 0,
  'Sales Manager: the handed-off chat of another department stays closed');
RESET ROLE;

-- «WhatsApp without AI review»: reads and answers the transcript; only the Gemini readers refuse (ai.draft.review).
SET LOCAL request.jwt.claims TO :'n261_wa_no_ai';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n261_assert(pg_temp.n261_page() = pg_temp.n261_sorted(:'c1', :'c3'), 'no-AI role: the sales chats');
SELECT pg_temp.n261_assert(pg_temp.n261_reader('page', :'c1') = 'rows:1' AND pg_temp.n261_reader('context', :'c1') = 'rows:1'
  AND pg_temp.n261_reader('attempt', :'c1') LIKE 'rows:%', 'no-AI role: transcript, context and latest attempt');
SELECT pg_temp.n261_assert(pg_temp.n261_reader('gemini', :'c1') = '42501' AND pg_temp.n261_reader('gemini_reviews', :'c1') = '42501',
  'the Gemini readers still need ai.draft.review: the page must not call them for such a role');
SELECT pg_temp.n261_assert(pg_temp.n261_reader('page', :'c2') = '42501', 'no-AI role: the handed-off chat stays closed');
RESET ROLE;

-- «WhatsApp read only»: reads the sales chats.
SET LOCAL request.jwt.claims TO :'n261_wa_read';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n261_assert(pg_temp.n261_page() = pg_temp.n261_sorted(:'c1', :'c3'), 'read-only role: the sales chats');
SELECT pg_temp.n261_assert(pg_temp.n261_rls_conversations() = pg_temp.n261_page()
  AND pg_temp.n261_rls_message_conversations() = pg_temp.n261_page(), 'read-only role: direct selects equal the page');
RESET ROLE;

-- A record-scoped reader of c3 sees exactly c3: the new rule does not spill into record scope.
SET LOCAL request.jwt.claims TO :'n261_record_reader';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n261_assert(pg_temp.n261_page() = pg_temp.n261_sorted(:'c3'), 'record scope: only the granted conversation');
SELECT pg_temp.n261_assert(pg_temp.n261_rls_conversations() = pg_temp.n261_sorted(:'c3'), 'record scope: direct select');
SELECT pg_temp.n261_assert(pg_temp.n261_reader('page', :'c3') = 'rows:1' AND pg_temp.n261_reader('page', :'c1') = '42501'
  AND pg_temp.n261_reader('page', :'c2') = '42501' AND pg_temp.n261_reader('context', :'c1') = 'rows:0',
  'record scope: the other chats stay closed');
RESET ROLE;

-- No WhatsApp keys, the Student, another organization's Admin, a caller without membership and anon: refused / empty.
SET LOCAL request.jwt.claims TO :'n261_common_only';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n261_assert(pg_temp.n261_error('SELECT pg_temp.n261_page()') = '42501', '«общие разделы» only: the queue is refused');
SELECT pg_temp.n261_assert(pg_temp.n261_rls_conversations() = ARRAY[]::UUID[]
  AND pg_temp.n261_rls_message_conversations() = ARRAY[]::UUID[]
  AND pg_temp.n261_rls_participant_conversations() = ARRAY[]::UUID[], '«общие разделы» only: direct selects are empty');
SELECT pg_temp.n261_assert(pg_temp.n261_reader('page', :'c1') = '42501' AND pg_temp.n261_reader('context', :'c1') = '42501',
  '«общие разделы» only: no reader (no communication.read.full at all)');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n261_student';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n261_assert(pg_temp.n261_error('SELECT pg_temp.n261_page()') = '42501', 'Student: the staff queue is refused');
SELECT pg_temp.n261_assert(pg_temp.n261_rls_conversations() = ARRAY[]::UUID[]
  AND pg_temp.n261_rls_message_conversations() = ARRAY[]::UUID[], 'Student: direct selects are empty');
SELECT pg_temp.n261_assert(pg_temp.n261_reader('page', :'c1') = '42501', 'Student: no transcript');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n261_other_org_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n261_assert(pg_temp.n261_error('SELECT pg_temp.n261_page()') = '42501', 'another organization''s Admin: refused for this organization');
SELECT pg_temp.n261_assert(pg_temp.n261_rls_conversations() = ARRAY[]::UUID[]
  AND pg_temp.n261_rls_message_conversations() = ARRAY[]::UUID[], 'another organization''s Admin: direct selects are empty');
SELECT pg_temp.n261_assert(pg_temp.n261_reader('page', :'c1') = '42501', 'another organization''s Admin: no transcript');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n261_no_member';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n261_assert(pg_temp.n261_error('SELECT pg_temp.n261_page()') = '42501'
  AND pg_temp.n261_rls_conversations() = ARRAY[]::UUID[], 'no membership: refused and empty');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.n261_assert(pg_temp.n261_error('SELECT pg_temp.n261_page()') = '42501'
  AND pg_temp.n261_error('SELECT count(*) FROM platform.communication_conversations') = '42501', 'anon: no execute, no select');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 3. The evaluator itself, exactly what changed and nothing else. Called as the
--    function owner (no client role may execute it).
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.n261_can(p_member INTEGER, p_key TEXT, p_kind TEXT, p_id UUID, p_org INTEGER DEFAULT 1)
RETURNS BOOLEAN LANGUAGE SQL AS $$
  SELECT platform_private.staff_can_access(pg_temp.n261_id(p_org), pg_temp.n261_id(300 + p_member), p_key, p_kind, p_id)
$$;
SELECT pg_temp.n261_assert(
  (SELECT bool_and(pg_temp.n261_can(m, 'communication.read.full', 'conversation', :'c1')
      = (m IN (1, 2, 3, 4, 5, 6)))
   FROM unnest(ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 10]) AS m),
  'communication.read.full on a sales chat: every holder at own/department/organization (incl. the Admin), not the keyless, the Student or the record-scoped member');
SELECT pg_temp.n261_assert(
  (SELECT bool_and(pg_temp.n261_can(m, 'communication.manual.send', 'conversation', :'c1')
      = (m IN (1, 2, 3, 4, 5)))
   FROM unnest(ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 10]) AS m),
  'communication.manual.send on a sales chat: only holders of the key (the read-only role, the keyless and the Student cannot)');
SELECT pg_temp.n261_assert(
  pg_temp.n261_can(10, 'communication.read.full', 'conversation', :'c3') AND NOT pg_temp.n261_can(10, 'communication.read.full', 'conversation', :'c1'),
  'a record scope matches its own conversation only');
-- A handed-off (curator-queue) chat keeps the owner evaluation.
SELECT pg_temp.n261_assert(
  (SELECT bool_and(pg_temp.n261_can(m, 'communication.read.full', 'conversation', :'c2') = (m IN (1, 2, 3)))
   FROM unnest(ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 10]) AS m),
  'curator queue: the Admin, the curator and the owner''s department manager only');
SELECT pg_temp.n261_assert(
  (SELECT bool_and(pg_temp.n261_can(m, 'communication.manual.send', 'conversation', :'c2') = (m IN (1, 2, 3)))
   FROM unnest(ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 10]) AS m),
  'curator queue: sending stays with the curator, the department manager and the Admin');
-- Every other permission on a sales chat stays owner-scoped.
SELECT pg_temp.n261_assert(
  (SELECT bool_and(NOT pg_temp.n261_can(m, k, 'conversation', :'c1'))
   FROM unnest(ARRAY[2, 3, 4, 5, 6]) AS m,
     unnest(ARRAY['communication.read.summary', 'ai.draft.request', 'ai.draft.review', 'decision.read', 'decision.manage']) AS k),
  'communication.read.summary, ai.draft.* and decision.* on a sales chat stay owner-scoped');
-- Other resources are untouched: the head of sales'' lead and the curator''s case.
SELECT pg_temp.n261_assert(
  (SELECT bool_and(NOT pg_temp.n261_can(m, 'lead.read', 'lead', pg_temp.n261_id(702))) FROM unnest(ARRAY[2, 3, 4, 5, 6, 7]) AS m)
  AND pg_temp.n261_can(1, 'lead.read', 'lead', pg_temp.n261_id(702)),
  'the lead of the head of sales is still readable by its owner only');
SELECT pg_temp.n261_assert(
  pg_temp.n261_can(2, 'case.read.full', 'student_case', pg_temp.n261_id(501))
  AND pg_temp.n261_can(3, 'case.read.full', 'student_case', pg_temp.n261_id(501))
  AND NOT pg_temp.n261_can(4, 'case.read.full', 'student_case', pg_temp.n261_id(501))
  AND NOT pg_temp.n261_can(5, 'case.read.full', 'student_case', pg_temp.n261_id(501))
  AND NOT pg_temp.n261_can(6, 'case.read.full', 'student_case', pg_temp.n261_id(501)),
  'the Student Case stays with its curator and the department of the curator');
-- Tenants: the other organization never matches, from either side.
SELECT pg_temp.n261_assert(
  NOT pg_temp.n261_can(9, 'communication.read.full', 'conversation', :'c1', 1)
  AND NOT pg_temp.n261_can(9, 'communication.read.full', 'conversation', :'c1', 2)
  AND NOT pg_temp.n261_can(9, 'communication.manual.send', 'conversation', :'c1', 2)
  AND NOT pg_temp.n261_can(2, 'communication.read.full', 'conversation', :'c1', 2),
  'no cross-tenant match, not even for the other organization''s Admin');
-- An unknown conversation id and a NULL id never match.
SELECT pg_temp.n261_assert(
  NOT pg_temp.n261_can(2, 'communication.read.full', 'conversation', pg_temp.n261_id(999))
  AND NOT pg_temp.n261_can(2, 'communication.read.full', 'conversation', NULL), 'unknown and NULL conversations never match');

-- ---------------------------------------------------------------------------
-- 4. A non-owner replies, through the real request -> authority trigger ->
--    exact claim -> finish chain; the sender recorded is that member.
-- ---------------------------------------------------------------------------
SELECT m.id AS m2 FROM platform.communication_messages m WHERE m.conversation_id = :'c2' AND m.direction = 'inbound' \gset
INSERT INTO platform_private.messaging_integration_health_events (organization_id, target, readiness, evidence_kind,
  reason, evidence_ref, request_id, observed_at)
VALUES (pg_temp.n261_id(1), 'waha', 'ready', 'provider_observed', 'N261 synthetic fresh WAHA readiness',
  'synthetic:n261:waha-ready', pg_temp.n261_id(3001), statement_timestamp());

-- Refused: no manual.send key, no keys at all, the Student, another organization, no membership,
-- and a handed-off chat the member does not own.
SET LOCAL request.jwt.claims TO :'n261_wa_read';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n261_assert(pg_temp.n261_request(:'c3', :'m3', 'N261 refused', 3101) = '42501',
  'a read-only role reads the chat but cannot send into it');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n261_common_only';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n261_assert(pg_temp.n261_request(:'c3', :'m3', 'N261 refused', 3102) = '42501', 'a keyless member cannot send');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n261_student';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n261_assert(pg_temp.n261_request(:'c3', :'m3', 'N261 refused', 3103) = '42501', 'the Student cannot send');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n261_other_org_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n261_assert(pg_temp.n261_request(:'c3', :'m3', 'N261 refused', 3104) = '42501', 'another organization''s Admin cannot send');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n261_no_member';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n261_assert(pg_temp.n261_request(:'c3', :'m3', 'N261 refused', 3105) = '42501', 'a caller without membership cannot send');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n261_sales_mgr';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n261_assert(pg_temp.n261_request(:'c2', :'m2', 'N261 refused', 3106) = '42501',
  'a member cannot send into a handed-off chat it does not own');
RESET ROLE;
SELECT pg_temp.n261_assert((SELECT count(*) = 0 FROM platform.manual_send_authorizations
  WHERE organization_id = pg_temp.n261_id(1)), 'no refused request left an authorization');

-- Admissions A (own scope, not the owner) replies to the first customer.
SET LOCAL request.jwt.claims TO :'n261_adm_a';
SET LOCAL ROLE authenticated;
SELECT platform.request_manual_whatsapp_send_with_authorization(pg_temp.n261_id(1), :'c1', :'m1', NULL,
  'Добрый день, отвечает сотрудник', 'staff_confirmed_manual_send', pg_temp.n261_key(:'c1', :'m1'), pg_temp.n261_id(3201))::TEXT AS n261_req \gset
RESET ROLE;
SELECT :'n261_req'::JSONB ->> 'manual_send_authorization_id' AS n261_authz, :'n261_req'::JSONB ->> 'work_item_id' AS n261_work \gset
SELECT pg_temp.n261_assert((:'n261_req'::JSONB ->> 'authorized_by_membership_id') = pg_temp.n261_id(302)::TEXT
  AND (:'n261_req'::JSONB ->> 'state') = 'manual_send_authorized' AND :'n261_work' IS NOT NULL,
  'the request is authorized by Admissions A and a work item is queued');
SELECT pg_temp.n261_assert((SELECT a.authorized_by_membership_id = pg_temp.n261_id(302)
    AND a.authorized_by_profile_id = pg_temp.n261_id(202)
    AND a.authorized_access_version = (SELECT p.access_version FROM platform.profiles p WHERE p.id = pg_temp.n261_id(202))
    AND a.conversation_id = :'c1'::UUID AND a.source_message_id = :'m1'::UUID
  FROM platform.manual_send_authorizations a WHERE a.id = :'n261_authz'::UUID),
  'the authority trigger recorded the member, its profile and its access version');
SELECT pg_temp.n261_assert((SELECT count(*) = 1 FROM platform.audit_events
  WHERE action = 'communication.manual.authorize' AND resource_id = :'n261_authz'::UUID
    AND actor_profile_id = pg_temp.n261_id(202)), 'the audit event names the replying member''s profile');

-- A second member cannot reply to the same inbound message (one reply per message); nothing is left behind.
SET LOCAL request.jwt.claims TO :'n261_adm_mgr';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n261_request(:'c1', :'m1', 'N261 second reply', 3202) AS n261_second \gset
RESET ROLE;
SELECT pg_temp.n261_assert(:'n261_second' <> 'ok' AND :'n261_second' <> '42501',
  'a second member is stopped by the one-reply-per-message business key, not by access');
SELECT pg_temp.n261_assert((SELECT count(*) = 1 FROM platform.manual_send_authorizations WHERE source_message_id = :'m1'::UUID),
  'exactly one authorization exists for the inbound message');

-- The exact claim (service role) creates the sender participant of THAT member.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
SET LOCAL ROLE service_role;
SELECT platform.claim_manual_whatsapp_send_item(pg_temp.n261_id(1), :'n261_work'::UUID, 60, 'n261-worker',
  pg_temp.n261_wid(4001))::TEXT AS n261_claim \gset
RESET ROLE;
SELECT :'n261_claim'::JSONB ->> 'attempt_id' AS n261_attempt \gset
SELECT pg_temp.n261_assert((:'n261_claim'::JSONB ->> 'claimed')::BOOLEAN
  AND (:'n261_claim'::JSONB ->> 'manual_send_authorization_id') = :'n261_authz'
  AND (:'n261_claim'::JSONB ->> 'raw_chat_id') = '79961000001@c.us', 'the exact claim leases the member''s authorized send');
SELECT pg_temp.n261_assert((SELECT count(*) = 1 AND bool_and(participant_kind::TEXT = 'sales')
  FROM platform.conversation_participants
  WHERE conversation_id = :'c1'::UUID AND membership_id = pg_temp.n261_id(302)),
  'the claim created the member''s own sales participant, not the owner''s');

SELECT statement_timestamp()::TEXT AS n261_observed \gset
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
SET LOCAL ROLE service_role;
SELECT platform.finish_manual_whatsapp_send(pg_temp.n261_id(1), :'n261_work'::UUID, :'n261_attempt'::UUID, :'n261_authz'::UUID,
  'succeeded', NULL, 'true_79961000001@c.us_N261BBBBBBBBBBBBBBB1', :'n261_observed', pg_temp.n261_wid(4002))::TEXT AS n261_finish \gset
RESET ROLE;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT pg_temp.n261_assert((:'n261_finish'::JSONB ->> 'state') = 'succeeded' AND (:'n261_finish'::JSONB ->> 'outcome') = 'succeeded',
  'the send finishes');
SELECT pg_temp.n261_assert((SELECT count(*) = 1 AND bool_and(m.body_text = 'Добрый день, отвечает сотрудник'
    AND m.manual_send_authorization_id = :'n261_authz'::UUID AND p.membership_id = pg_temp.n261_id(302)
    AND p.participant_kind::TEXT = 'sales')
  FROM platform.communication_messages m
  JOIN platform.conversation_participants p ON p.organization_id = m.organization_id AND p.id = m.sender_participant_id
  WHERE m.conversation_id = :'c1'::UUID AND m.direction = 'outbound'),
  'the outbound message is stored with the replying member as its sender');
-- Everyone who may read the chat sees the reply; those who may not still do not.
SET LOCAL request.jwt.claims TO :'n261_adm_mgr';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n261_assert(pg_temp.n261_messages(:'c1') = 2, 'another member reads the transcript with the reply');
SELECT pg_temp.n261_assert((SELECT count(*) = 1 FROM platform.manual_send_authorizations WHERE id = :'n261_authz'::UUID),
  'the authorization is readable like the conversation');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n261_common_only';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n261_assert((SELECT count(*) = 0 FROM platform.manual_send_authorizations)
  AND pg_temp.n261_rls_message_conversations() = ARRAY[]::UUID[], 'a keyless member sees neither the authorization nor the messages');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 4b. Two DIFFERENT non-owners reply in the same conversation (placed before the
--     no-AI member's request, whose queued work item would otherwise be the queue
--     head the exact claim insists on): the customer
--     writes again; the Admissions Manager (not the owner, not the member who
--     answered first) answers the new message. Each reply carries its own
--     participant, message sender and audit event.
-- ---------------------------------------------------------------------------
-- The projection writes the message before its provider binding (the binding
-- check is a deferred constraint trigger); section 4 left the constraints
-- IMMEDIATE, so defer them again for the chain and check them right after.
SET CONSTRAINTS ALL DEFERRED;
SELECT pg_temp.n261_run(4, pg_temp.n261_in('false_79961000001@c.us_N261AAAAAAAAAAAAAAA4', '79961000001@c.us', 'Второе сообщение первого клиента')) AS r4 \gset
SELECT pg_temp.n261_assert((:'r4'::JSONB ->> 'disposition') = 'succeeded', 'the customer''s second message projects through the real chain');
SELECT m.id AS m4 FROM platform.communication_messages m
  WHERE m.conversation_id = :'c1' AND m.direction = 'inbound' AND m.id <> :'m1' \gset
SELECT pg_temp.n261_assert((SELECT count(*) = 1 FROM platform.communication_messages m
  WHERE m.conversation_id = :'c1' AND m.direction = 'inbound' AND m.id = :'m4'::UUID), 'one new inbound message to answer');

SET LOCAL request.jwt.claims TO :'n261_adm_mgr';
SET LOCAL ROLE authenticated;
SELECT platform.request_manual_whatsapp_send_with_authorization(pg_temp.n261_id(1), :'c1', :'m4', NULL,
  'Ответ второго сотрудника', 'staff_confirmed_manual_send', pg_temp.n261_key(:'c1', :'m4'), pg_temp.n261_id(3301))::TEXT AS n261_req2 \gset
RESET ROLE;
SELECT :'n261_req2'::JSONB ->> 'manual_send_authorization_id' AS n261_authz2, :'n261_req2'::JSONB ->> 'work_item_id' AS n261_work2 \gset
SELECT pg_temp.n261_assert((:'n261_req2'::JSONB ->> 'authorized_by_membership_id') = pg_temp.n261_id(303)::TEXT
  AND (:'n261_req2'::JSONB ->> 'state') = 'manual_send_authorized' AND :'n261_work2' IS NOT NULL,
  'the second reply is authorized by the Admissions Manager');
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
SET LOCAL ROLE service_role;
SELECT platform.claim_manual_whatsapp_send_item(pg_temp.n261_id(1), :'n261_work2'::UUID, 60, 'n261-worker',
  pg_temp.n261_wid(4011))::TEXT AS n261_claim2 \gset
RESET ROLE;
SELECT :'n261_claim2'::JSONB ->> 'attempt_id' AS n261_attempt2 \gset
SELECT pg_temp.n261_assert((:'n261_claim2'::JSONB ->> 'claimed')::BOOLEAN
  AND (:'n261_claim2'::JSONB ->> 'manual_send_authorization_id') = :'n261_authz2', 'the exact claim leases the second reply');
SELECT statement_timestamp()::TEXT AS n261_observed2 \gset
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
SET LOCAL ROLE service_role;
SELECT platform.finish_manual_whatsapp_send(pg_temp.n261_id(1), :'n261_work2'::UUID, :'n261_attempt2'::UUID, :'n261_authz2'::UUID,
  'succeeded', NULL, 'true_79961000001@c.us_N261BBBBBBBBBBBBBBB2', :'n261_observed2', pg_temp.n261_wid(4012))::TEXT AS n261_finish2 \gset
RESET ROLE;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT pg_temp.n261_assert((:'n261_finish2'::JSONB ->> 'state') = 'succeeded', 'the second reply finishes');
SELECT pg_temp.n261_assert((SELECT count(*) = 2 AND count(DISTINCT m.sender_participant_id) = 2
    AND array_agg(p.membership_id ORDER BY p.membership_id) = ARRAY[pg_temp.n261_id(302), pg_temp.n261_id(303)]
    AND bool_and(m.manual_send_authorization_id IS NOT NULL AND p.participant_kind::TEXT = 'sales')
  FROM platform.communication_messages m
  JOIN platform.conversation_participants p ON p.organization_id = m.organization_id AND p.id = m.sender_participant_id
  WHERE m.conversation_id = :'c1'::UUID AND m.direction = 'outbound'),
  'two different non-owners answered in one conversation: each outbound message has its own sender participant');
SELECT pg_temp.n261_assert((SELECT count(*) = 1 FROM platform.conversation_participants
    WHERE conversation_id = :'c1'::UUID AND membership_id = pg_temp.n261_id(303) AND participant_kind::TEXT = 'sales')
  AND (SELECT count(*) = 1 FROM platform.conversation_participants
    WHERE conversation_id = :'c1'::UUID AND membership_id = pg_temp.n261_id(302) AND participant_kind::TEXT = 'sales'),
  'each replying member has exactly one participant row; the first one was not reused for the second');
SELECT pg_temp.n261_assert((SELECT count(*) = 1 FROM platform.audit_events
  WHERE action = 'communication.manual.authorize' AND resource_id = :'n261_authz2'::UUID
    AND actor_profile_id = pg_temp.n261_id(203)), 'the audit event of the second reply names the Admissions Manager''s profile');
SELECT pg_temp.n261_assert((SELECT count(*) = 0 FROM platform.conversation_participants
    WHERE conversation_id = :'c1'::UUID AND membership_id IN (pg_temp.n261_id(304), pg_temp.n261_id(305), pg_temp.n261_id(306))),
  'members who only read or did not reply got no participant row');

-- A member with read + send but no AI review (a custom role) replies to the third customer.
SET LOCAL request.jwt.claims TO :'n261_wa_no_ai';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n261_assert(pg_temp.n261_request(:'c3', :'m3', 'Ответ без черновика ИИ', 3203) = 'ok',
  'a role without ai.draft.review replies: the send path needs no AI key');
RESET ROLE;
SELECT pg_temp.n261_assert((SELECT count(*) = 1 AND bool_and(authorized_by_membership_id = pg_temp.n261_id(305))
  FROM platform.manual_send_authorizations WHERE conversation_id = :'c3'::UUID), 'recorded as the no-AI member');

-- ---------------------------------------------------------------------------
-- 4c. Identity and assignment filters still bind: the member that holds both
--     keys at `own` (305, «WhatsApp without AI review») loses every sales chat
--     the moment its membership is not active, its profile is blocked, its role
--     is archived or its assignment is revoked. Each state is applied with
--     triggers off (the production code path bumps the access version; here the
--     version is deliberately left unchanged, i.e. the JWT stays valid) and
--     undone, with a positive control before and after.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n261_assert(pg_temp.n261_can(5, 'communication.read.full', 'conversation', :'c1')
  AND pg_temp.n261_can(5, 'communication.manual.send', 'conversation', :'c1'), 'control: the member holds both keys on a sales chat');
SELECT set_config('n261.c1', :'c1', TRUE);
SET LOCAL session_replication_role = replica;
DO $n261_identity$
DECLARE
  c1 CONSTANT UUID := current_setting('n261.c1')::UUID;
  steps CONSTANT TEXT[][] := ARRAY[
    ARRAY['membership inactive', format('UPDATE platform.organization_memberships SET status = %L WHERE id = %L', 'inactive', pg_temp.n261_id(305)),
      format('UPDATE platform.organization_memberships SET status = %L WHERE id = %L', 'active', pg_temp.n261_id(305))],
    ARRAY['membership blocked', format('UPDATE platform.organization_memberships SET status = %L WHERE id = %L', 'blocked', pg_temp.n261_id(305)),
      format('UPDATE platform.organization_memberships SET status = %L WHERE id = %L', 'active', pg_temp.n261_id(305))],
    ARRAY['membership invited', format('UPDATE platform.organization_memberships SET status = %L WHERE id = %L', 'invited', pg_temp.n261_id(305)),
      format('UPDATE platform.organization_memberships SET status = %L WHERE id = %L', 'active', pg_temp.n261_id(305))],
    ARRAY['profile blocked', format('UPDATE platform.profiles SET status = %L WHERE id = %L', 'blocked', pg_temp.n261_id(205)),
      format('UPDATE platform.profiles SET status = %L WHERE id = %L', 'active', pg_temp.n261_id(205))],
    ARRAY['role archived', format('UPDATE platform.staff_role_definitions SET status = %L WHERE id = %L', 'archived', pg_temp.n261_id(1106)),
      format('UPDATE platform.staff_role_definitions SET status = %L WHERE id = %L', 'active', pg_temp.n261_id(1106))],
    ARRAY['assignment revoked', format('UPDATE platform.staff_role_assignments SET revoked_at = clock_timestamp() WHERE membership_id = %L AND revoked_at IS NULL', pg_temp.n261_id(305)),
      format('UPDATE platform.staff_role_assignments SET revoked_at = NULL WHERE membership_id = %L', pg_temp.n261_id(305))]
  ];
  i INTEGER;
BEGIN
  FOR i IN 1..array_length(steps, 1) LOOP
    EXECUTE steps[i][2];
    IF pg_temp.n261_can(5, 'communication.read.full', 'conversation', c1) OR pg_temp.n261_can(5, 'communication.manual.send', 'conversation', c1) THEN
      RAISE EXCEPTION 'N261: still has access with state %', steps[i][1];
    END IF;
    EXECUTE steps[i][3];
    IF NOT (pg_temp.n261_can(5, 'communication.read.full', 'conversation', c1) AND pg_temp.n261_can(5, 'communication.manual.send', 'conversation', c1)) THEN
      RAISE EXCEPTION 'N261: access did not come back after undoing %', steps[i][1];
    END IF;
  END LOOP;
END
$n261_identity$;
SET LOCAL session_replication_role = origin;

-- 4d. The real RPCs with a stale-but-valid JWT: Admissions A's assignment is
--     revoked without an access-version bump (the token still looks current).
--     Every reader and the send request are refused at once, nothing is left
--     behind, and the member is back after the assignment is restored.
SELECT m.id AS m2b FROM platform.communication_messages m WHERE m.conversation_id = :'c2' AND m.direction = 'inbound' \gset
SET LOCAL session_replication_role = replica;
UPDATE platform.staff_role_assignments SET revoked_at = clock_timestamp()
  WHERE membership_id = pg_temp.n261_id(302) AND role_id = pg_temp.n261_id(1101) AND revoked_at IS NULL;
SET LOCAL session_replication_role = origin;
SET LOCAL request.jwt.claims TO :'n261_adm_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n261_assert(pg_temp.n261_error('SELECT pg_temp.n261_page()') = '42501'
  AND pg_temp.n261_rls_conversations() = ARRAY[]::UUID[] AND pg_temp.n261_rls_message_conversations() = ARRAY[]::UUID[],
  'revoked assignment, valid JWT: the queue is refused and the direct selects are empty');
SELECT pg_temp.n261_assert(pg_temp.n261_reader('page', :'c1') = '42501' AND pg_temp.n261_reader('context', :'c1') = '42501'
  AND pg_temp.n261_reader('page', :'c2') = '42501', 'revoked assignment, valid JWT: no transcript of a sales chat or of its own handed-off chat');
SELECT pg_temp.n261_assert(pg_temp.n261_request(:'c2', :'m2b', 'N261 refused after revoke', 3401) = '42501'
  AND pg_temp.n261_request(:'c1', :'m4', 'N261 refused after revoke', 3402) = '42501',
  'revoked assignment, valid JWT: the send request is refused');
RESET ROLE;
SET LOCAL session_replication_role = replica;
UPDATE platform.staff_role_assignments SET revoked_at = NULL
  WHERE membership_id = pg_temp.n261_id(302) AND role_id = pg_temp.n261_id(1101);
SET LOCAL session_replication_role = origin;
SET LOCAL request.jwt.claims TO :'n261_adm_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n261_assert(pg_temp.n261_page() = pg_temp.n261_sorted(:'c1', :'c2', :'c3'),
  'control: with the assignment restored Admissions A lists the chats again');
RESET ROLE;
SELECT pg_temp.n261_assert((SELECT count(*) = 2 FROM platform.manual_send_authorizations WHERE conversation_id = :'c1'::UUID)
  AND (SELECT count(*) = 0 FROM platform.manual_send_authorizations WHERE conversation_id = :'c2'::UUID),
  'the refused requests left no authorization behind');

-- ---------------------------------------------------------------------------
-- 5. The evaluator is still a hardened definer nobody can execute; its sibling is untouched.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n261_assert((SELECT r.prosecdef AND r.provolatile = 's' AND r.proconfig @> ARRAY['search_path=""']::TEXT[]
    AND r.proowner = (SELECT s.proowner FROM pg_proc s WHERE s.oid = 'platform_private.staff_context_can_access(uuid,uuid,text,text,uuid,uuid,uuid,text)'::regprocedure)
    AND NOT has_function_privilege('anon', r.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', r.oid, 'EXECUTE')
    AND NOT has_function_privilege('service_role', r.oid, 'EXECUTE')
    AND NOT EXISTS (SELECT 1 FROM aclexplode(r.proacl) a WHERE a.grantee = 0)
  FROM pg_proc r WHERE r.oid = 'platform_private.staff_access_evaluate(uuid,uuid,text,text,uuid,boolean)'::regprocedure),
  'the evaluator: definer, stable, empty search_path, same owner as its matcher, no client role may execute it');
SELECT pg_temp.n261_assert((SELECT md5(prosrc) = 'f354be0f66ddcc6953bc89dabe286315' FROM pg_proc
  WHERE oid = 'platform_private.staff_context_can_access(uuid,uuid,text,text,uuid,uuid,uuid,text)'::regprocedure),
  'the sibling matcher is byte-identical to migration 155');
SELECT pg_temp.n261_assert((SELECT prosrc LIKE '%team_inbox.queue=''sales''%' FROM pg_proc
  WHERE oid = 'platform_private.staff_access_evaluate(uuid,uuid,text,text,uuid,boolean)'::regprocedure),
  'the migration''s definition is the one left installed');

SELECT 'N261_WHATSAPP_TEAM_INBOX_SUITE_PASSED' AS n261_suite_result;

ROLLBACK;
