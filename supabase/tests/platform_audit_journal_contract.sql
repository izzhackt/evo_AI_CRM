\set ON_ERROR_STOP on
-- P7A journal contract (fix for the defect PLAN_CHANGES 29.09.2026 —
-- «Журнал действий»: контракт аудита отстал от сервера): src/lib/platform-
-- audit.ts mirrors the server's safe-projection allowlists
-- (platform_private.p7a_safe_audit_actions/p7a_safe_audit_resource_types/
-- p7a_changed_field_codes) by hand, and migrations 083 through 191 extended
-- those allowlists 14 times after the 071 baseline without the TS file ever
-- being told. This suite runs on the LATEST chain (after every migration),
-- next to platform_today_university_deadlines.sql, and proves the TS/server
-- contract match from the LIVE function output rather than re-deriving it:
-- it does not assert any hardcoded action/resource-type list itself (that
-- assertion already exists per-migration in the historical suites, e.g.
-- platform_audit_search_export_rls.sql at 071) — it inserts one row per
-- CURRENT server-safe action, reads them back through the real
-- platform.search_audit_events() as a real Platform Admin, and prints both
-- the server's live contract and every page it read to stdout, for
-- scripts/check-platform-audit-journal-contract.mjs to replay through the
-- REAL src/lib/platform-audit.ts normalizer (see that script's own header).
--
-- Extended by migration 255 (proposal, not applied — PLAN_CHANGES.md
-- «2026-09-29 — «Журнал действий»: серверный allowlist аудита расширен на 72
-- действия (предложение, миграция 255)», whose «Правка лида» (PR #1120, head
-- 170efb75) sub-section corrects the count to 71 and whose «Правка по ревью»
-- (head 24b3184b) sub-section adds the 16th resource type document_export)
-- with two additions to the "no hardcoded list" rule above:
--
--  (1) a privacy pin: a hardcoded list of the 29 actions and 4 resource types
--      255 deliberately did NOT allowlist (see 255's own header for the
--      per-action reasons), asserted absent from
--      p7a_safe_audit_actions()/p7a_safe_audit_resource_types(), plus five
--      seeded excluded-action rows proven absent from a real
--      search_audit_events() read. It exists to catch a future migration
--      accidentally re-adding one of these, not to re-derive the INCLUDE
--      contract this suite already proves live.
--  (2) a real-writer pair check: the per-action fixture above gives every
--      action the same resource type ('organization'), so it proves the two
--      allowlists independently but never an (action, resource_type) PAIR as
--      a real writer produces it. search_audit_events() keeps a row only when
--      BOTH are allowlisted, so a missing resource type hides a whole action
--      without failing any other assertion — which is how the 9
--      document.export.* actions were once half visible (university-form and
--      partner-package exports write 'document_export'). The hardcoded list
--      of the 80 real pairs of the 71 actions 255 added is seeded and every
--      pair must be read back; that page is emitted too, so the checker
--      script replays it through the real TS normalizer.
--
-- Fixture: one organization + one Platform Admin membership, modelled like
-- production per 155 (platform_private.staff_membership_identity,
-- staff_context_can_access lines ~299-322 and ~746-770): is_system_admin =
-- TRUE gives system_role = 'admin', which alone satisfies
-- platform_private.p7a_require_audit_admin()'s 'audit.read' / 'organization'
-- scope check — no role bundle grant is needed for THAT permission, but
-- current_role='admin' still requires a published 'admin' bundle to satisfy
-- organization_memberships' own current_role/current_bundle_id pairing CHECK
-- (bundle content itself is irrelevant here). Modelled after
-- platform_today_university_deadlines.sql's admin fixture (actor 1 there).
--
-- Actor label (migration 256): after those per-action assertions the suite
-- adds a Student, a staff member with no coarse role, a profile whose only
-- membership is in another organization and a Student whose side once changed,
-- writes audit rows for them the way the real writers do (the Student's rows
-- leave actor_membership_id NULL, bar one that records it), reads them back
-- through the same real platform.search_audit_events() and proves the
-- actor_display_label of every row: Student, Staff, the neutral User, Service
-- and System, with no key outside the ten safe ones. That page is emitted too,
-- so the checker script replays it through the real TS normalizer -- the proof
-- that the TS parser accepts Student/User for a 'user' actor.
--
-- Isolated synthetic SQL fixture only -- no Auth invitation, real person,
-- provider or production action. Everything below runs inside one
-- transaction and is rolled back at the end.
BEGIN;

DO $p7aj_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$p7aj_auth_role$;

CREATE FUNCTION pg_temp.p7aj_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('a7a10000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.p7aj_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'P7AJ: %', message; END IF;
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.p7aj_id(INTEGER), pg_temp.p7aj_assert(BOOLEAN, TEXT) TO authenticated;

SELECT 'P7AJ_JOURNAL_CONTRACT_SUITE_START' AS p7aj_suite_marker;

-- ---------------------------------------------------------------------------
-- Fixture: organization + one Platform Admin (is_system_admin = TRUE).
-- ---------------------------------------------------------------------------
INSERT INTO platform.organizations(id, name) VALUES (pg_temp.p7aj_id(1), 'P7AJ Fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  VALUES (pg_temp.p7aj_id(101), 'p7aj-admin@example.invalid', '{}'::JSONB);
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  VALUES (pg_temp.p7aj_id(201), pg_temp.p7aj_id(101), 'P7AJ Admin', 'active', 1);
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  VALUES (pg_temp.p7aj_id(301), pg_temp.p7aj_id(1), pg_temp.p7aj_id(201), 'active', 'admin',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'admin' AND status = 'published' ORDER BY version DESC LIMIT 1));
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id = pg_temp.p7aj_id(301);

INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.p7aj_id(401), pg_temp.p7aj_id(1), 'organization', pg_temp.p7aj_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.p7aj_id(1), pg_temp.p7aj_id(301), pg_temp.p7aj_id(401), 1, 1, TRUE, 'system',
    'P7AJ synthetic organization scope', pg_temp.p7aj_id(402));

SELECT pg_temp.p7aj_assert(
  (SELECT m.is_system_admin AND m."current_role" = 'admin' AND m.current_bundle_id IS NOT NULL
    FROM platform.organization_memberships m WHERE m.id = pg_temp.p7aj_id(301)),
  'the fixture Admin membership is a real system-admin row with a published bundle');

-- ---------------------------------------------------------------------------
-- One platform.audit_events row per CURRENT server-safe action. The resource
-- type is the same allowlisted value ('organization') for every row: the
-- server's projection validates action and resource type independently
-- (platform_private.p7a_safe_audit_row, 071), so this does not need to
-- reproduce which resource type each action uses in production.
-- ---------------------------------------------------------------------------
INSERT INTO platform.audit_events(
  organization_id, actor_kind, actor_principal, action, resource_type, resource_id,
  after_state, reason, request_id
)
SELECT pg_temp.p7aj_id(1), 'system', 'P7AJ synthetic fixture actor', action, 'organization',
  gen_random_uuid(), '{}'::JSONB, 'P7AJ synthetic audit contract fixture row', gen_random_uuid()
FROM unnest(platform_private.p7a_safe_audit_actions()) AS action;

SELECT pg_temp.p7aj_assert(
  (SELECT count(*) FROM platform.audit_events WHERE organization_id = pg_temp.p7aj_id(1))
    = cardinality(platform_private.p7a_safe_audit_actions()),
  'one platform.audit_events row exists per current server-safe action');
SELECT pg_temp.p7aj_assert(
  (SELECT count(DISTINCT action) FROM platform.audit_events WHERE organization_id = pg_temp.p7aj_id(1))
    = cardinality(platform_private.p7a_safe_audit_actions()),
  'every fixture row has a distinct action — no action was inserted twice');

-- ---------------------------------------------------------------------------
-- Privacy pin (255's own header + PLAN_CHANGES.md «2026-09-29 — «Журнал
-- действий»: серверный allowlist аудита расширен на 72 действия (предложение,
-- миграция 255)», итог по «Правке лида» — 71): the
-- actions 255 deliberately did NOT allowlist (student.application.approve/
-- reject, application.document.submit, application.catalog.select,
-- application.requirements.initialize, staff.auth.prepare/recovery.observed,
-- 19 machine-plumbing work.*/communication.*/media.*/company.file.download.
-- consume/integration.*/configuration.*/platform.observability.probe
-- actions, and the two one-off deploy backfills) and the 4 resource types
-- that must never be allowlisted (student_application, staff_auth_request,
-- waha_session_observation, provider_webhook_event) stay out of the LIVE
-- server contract. (i) is a static check against the allowlist functions
-- themselves; (ii) below seeds real rows for a representative sample and
-- proves the real platform.search_audit_events() never returns them to the
-- fixture Admin, the same way an ineligible action already fails the exact
-- action-set assertions after this suite's page loop.
-- ---------------------------------------------------------------------------
SELECT pg_temp.p7aj_assert(
  NOT (platform_private.p7a_safe_audit_actions() && ARRAY[
    'student.application.approve', 'student.application.reject',
    'application.document.submit', 'application.catalog.select',
    'application.requirements.initialize',
    'staff.auth.prepare', 'staff.auth.recovery.observed',
    'work.enqueue', 'work.enqueue.deduplicate', 'work.claim', 'work.lease.extend',
    'work.retry.schedule', 'work.dead.letter', 'work.succeed', 'work.unknown.review',
    'work.conflict.review', 'communication.leadagent.sessionstatus',
    'communication.leadagent.sync', 'communication.webhook.persist',
    'media.archive.claim', 'media.archive.finish', 'media.download.consume',
    'company.file.download.consume', 'integration.amocrm.mapping.discovery.persist',
    'configuration.waha.provision', 'platform.observability.probe',
    'lead.sales.stage.normalized', 'staff.roles.migrated',
    -- Lead's correction (PR #1120, head 170efb75): moved here from a draft
    -- INCLUDE — same X5 one-off-backfill class, its only writer is the
    -- DO $$ ... $$ block inside already-applied migration 115 (115:611-690).
    'document.slot.scaninvalidate'
  ]::TEXT[]),
  'none of the 29 deliberately-excluded actions is in p7a_safe_audit_actions()');
SELECT pg_temp.p7aj_assert(
  NOT (platform_private.p7a_safe_audit_resource_types() && ARRAY[
    'student_application', 'staff_auth_request', 'waha_session_observation',
    'provider_webhook_event'
  ]::TEXT[]),
  'none of the 4 never-add resource types is in p7a_safe_audit_resource_types()');

-- (ii) Seed one row per representative excluded action, same fixture
-- organization, inserted AFTER the exact-count assertions above so they
-- never affect the "one row per current server-safe action" counts. Each
-- uses the resource_type its real writer uses (228, 177/216-class pre-account
-- intake, staff_auth_request internals, 045 durable work queue, 115 document
-- slot scan invalidation) — three of the five are otherwise-safe resource
-- types (university_application, durable_work_item, document_slot),
-- proving the ACTION exclusion alone hides the row, not merely an unsafe
-- resource type riding along with it. actor_kind='system'
-- throughout (not 'user'): platform.audit_events_actor_check (041) requires
-- a real actor_profile_id whenever actor_kind='user', and this suite has no
-- second (Student) profile fixture to attach — irrelevant to what this pin
-- tests, which is action/resource-type exclusion, not actor attribution.
INSERT INTO platform.audit_events(
  organization_id, actor_kind, actor_principal, action, resource_type, resource_id,
  after_state, reason, request_id
)
VALUES
  (pg_temp.p7aj_id(1), 'system', 'P7AJ excluded fixture actor',
    'student.application.approve', 'student_application', gen_random_uuid(),
    '{}'::JSONB, 'P7AJ synthetic excluded-action fixture row', gen_random_uuid()),
  (pg_temp.p7aj_id(1), 'system', 'P7AJ excluded fixture actor',
    'application.document.submit', 'university_application', gen_random_uuid(),
    '{}'::JSONB, 'P7AJ synthetic excluded-action fixture row', gen_random_uuid()),
  (pg_temp.p7aj_id(1), 'system', 'P7AJ excluded fixture actor',
    'staff.auth.prepare', 'staff_auth_request', gen_random_uuid(),
    '{}'::JSONB, 'P7AJ synthetic excluded-action fixture row', gen_random_uuid()),
  (pg_temp.p7aj_id(1), 'system', 'P7AJ excluded fixture actor',
    'work.claim', 'durable_work_item', gen_random_uuid(),
    '{}'::JSONB, 'P7AJ synthetic excluded-action fixture row', gen_random_uuid()),
  (pg_temp.p7aj_id(1), 'system', 'P7AJ excluded fixture actor',
    'document.slot.scaninvalidate', 'document_slot', gen_random_uuid(),
    '{}'::JSONB, 'P7AJ synthetic excluded-action fixture row', gen_random_uuid());

-- ---------------------------------------------------------------------------
-- Read back as the Admin, through the REAL platform.search_audit_events(),
-- paging (100 per page, snapshot+cursor) until has_more = false.
-- ---------------------------------------------------------------------------
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p7aj_id(101),
  'claims', jsonb_build_object('sub', pg_temp.p7aj_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT
  AS p7aj_admin_claims \gset
SET LOCAL request.jwt.claims TO :'p7aj_admin_claims';
SET LOCAL ROLE authenticated;

CREATE TEMP TABLE p7aj_pages(page_index INTEGER PRIMARY KEY, page JSONB);

DO $p7aj_page_loop$
DECLARE
  current_page JSONB;
  page_index INTEGER := 0;
  snap_created TIMESTAMPTZ := NULL;
  snap_id UUID := NULL;
  cur_created TIMESTAMPTZ := NULL;
  cur_id UUID := NULL;
  more BOOLEAN := TRUE;
BEGIN
  WHILE more LOOP
    page_index := page_index + 1;
    IF page_index > 20 THEN
      RAISE EXCEPTION 'P7AJ: pagination of the safe-action fixture did not terminate within 20 pages';
    END IF;
    SELECT platform.search_audit_events(
      NULL, NULL, NULL, NULL, NULL, 100,
      snap_created, snap_id, cur_created, cur_id
    ) INTO current_page;
    INSERT INTO p7aj_pages(page_index, page) VALUES (page_index, current_page);
    more := (current_page ->> 'has_more')::BOOLEAN;
    snap_created := (current_page ->> 'snapshot_created_at')::TIMESTAMPTZ;
    snap_id := (current_page ->> 'snapshot_id')::UUID;
    cur_created := (current_page ->> 'next_cursor_created_at')::TIMESTAMPTZ;
    cur_id := (current_page ->> 'next_cursor_id')::UUID;
  END LOOP;
END
$p7aj_page_loop$;

RESET ROLE;

-- The read is scoped to the fixture organization by construction (P7A's RLS
-- boundary, unrelated to this suite): count and action-set assertions below
-- only hold if no other organization's rows leaked in, which the exact
-- cardinality match already proves. platform_private is not exposed to
-- authenticated, so these run back as postgres (direct table asserts only
-- after RESET ROLE, matching the other latest-chain suites' convention).
SELECT pg_temp.p7aj_assert(
  (SELECT count(*) FROM p7aj_pages, jsonb_array_elements(page -> 'rows'))
    = cardinality(platform_private.p7a_safe_audit_actions()),
  'total rows across every page equals the number of current server-safe actions');
SELECT pg_temp.p7aj_assert(
  (SELECT count(DISTINCT r ->> 'action') FROM p7aj_pages, jsonb_array_elements(page -> 'rows') AS r)
    = cardinality(platform_private.p7a_safe_audit_actions()),
  'every action was read back exactly once');
SELECT pg_temp.p7aj_assert(
  (SELECT array_agg(DISTINCT r ->> 'action' ORDER BY r ->> 'action')
    FROM p7aj_pages, jsonb_array_elements(page -> 'rows') AS r)
    = (SELECT array_agg(a ORDER BY a) FROM unnest(platform_private.p7a_safe_audit_actions()) AS a),
  'the exact set of actions read back equals platform_private.p7a_safe_audit_actions()');
SELECT pg_temp.p7aj_assert(
  (SELECT bool_and((page ->> 'has_more')::BOOLEAN = (page_index <> (SELECT max(page_index) FROM p7aj_pages)))
    FROM p7aj_pages),
  'has_more is true on every page except the last');

-- Privacy pin (ii): the exact action-set equality above (line ~233) already
-- proves this implicitly — any leaked excluded row would add an action
-- outside platform_private.p7a_safe_audit_actions() and fail it — but the
-- excluded seed is asserted explicitly here too, by name, so this suite
-- documents and fails on exactly what it is testing rather than relying on
-- an indirect equality.
SELECT pg_temp.p7aj_assert(
  NOT EXISTS (
    SELECT 1 FROM p7aj_pages, jsonb_array_elements(page -> 'rows') AS r
    WHERE r ->> 'action' IN (
      'student.application.approve', 'application.document.submit',
      'staff.auth.prepare', 'work.claim', 'document.slot.scaninvalidate'
    )
  ),
  'none of the 5 seeded excluded-action rows was returned by search_audit_events() to the fixture Admin');

-- ---------------------------------------------------------------------------
-- Real-writer pairs (PR #1120 review correction, head 24b3184b). Each pair is
-- (action, resource_type) exactly as the LATEST writer of that action in the
-- migration chain writes it; the resource types were read off the
-- INSERT INTO platform.audit_events of each writer function in the built
-- chain (not guessed from the action name). The 9 document.export.* actions
-- appear with both of their real types: 'student_profile' for a profile
-- export and 'document_export' for a university-form or partner-package
-- artifact (169: record_document_export_event / complete_document_export_
-- download). Seeded AFTER the page loop and its exact-count assertions above,
-- so the per-action contract is unaffected, with one shared resource_id so a
-- single resource-filtered search_audit_events() page (80 rows < 100) returns
-- exactly these rows when — and only when — each pair passes BOTH allowlists.
-- actor_kind='system' for the same reason as the excluded-action seed above.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE p7aj_pairs(action TEXT NOT NULL, resource_type TEXT NOT NULL, PRIMARY KEY (action, resource_type));
INSERT INTO p7aj_pairs(action, resource_type) VALUES
    ('application.document.review', 'university_application'),
    ('application.requirements.save', 'university_application'),
    ('case.coverage.return', 'student_case'),
    ('case.coverage.start', 'student_case'),
    ('case.handoff.acknowledge', 'student_case'),
    ('case.handoff.clarification', 'student_case'),
    ('case.handoff.decline', 'student_case'),
    ('case.next.action.change', 'student_case'),
    ('case.payment.receipt.upload', 'payment_receipt_file'),
    ('case.tranche.save', 'payment_obligation'),
    ('company.file.download.grant', 'company_file_version'),
    ('company.file.file.archive', 'company_file'),
    ('company.file.file.create', 'company_file'),
    ('company.file.file.move', 'company_file'),
    ('company.file.file.rename', 'company_file'),
    ('company.file.folder.archive', 'company_file_folder'),
    ('company.file.folder.create', 'company_file_folder'),
    ('company.file.folder.move', 'company_file_folder'),
    ('company.file.folder.rename', 'company_file_folder'),
    ('company.file.upload.finalize', 'company_file_version'),
    ('company.file.upload.reserve', 'company_file_version'),
    ('docs.student.create', 'student_case'),
    ('document.export.begun', 'student_profile'),
    ('document.export.begun', 'document_export'),
    ('document.export.download.failed', 'student_profile'),
    ('document.export.download.failed', 'document_export'),
    ('document.export.download.verified', 'student_profile'),
    ('document.export.download.verified', 'document_export'),
    ('document.export.failed', 'student_profile'),
    ('document.export.failed', 'document_export'),
    ('document.export.prepared', 'student_profile'),
    ('document.export.prepared', 'document_export'),
    ('document.export.ready', 'student_profile'),
    ('document.export.ready', 'document_export'),
    ('document.export.reconciled', 'student_profile'),
    ('document.export.reconciled', 'document_export'),
    ('document.export.sealed', 'student_profile'),
    ('document.export.sealed', 'document_export'),
    ('document.export.unknown', 'student_profile'),
    ('document.export.unknown', 'document_export'),
    ('lead.lifecycle.change', 'lead'),
    ('lead.manual.create', 'lead'),
    ('lead.sale.conditions.save', 'lead'),
    ('lead.sales.workflow.changed', 'lead'),
    ('lead.website.receive', 'lead'),
    ('media.download.grant', 'communication_media'),
    ('prompt.artifact.publish', 'ai_prompt_artifact_version'),
    ('prompt.artifact.retire', 'ai_prompt_artifact_version'),
    ('sales.register.archive', 'sales_register'),
    ('sales.register.create', 'sales_register'),
    ('sales.register.import', 'sales_register_import'),
    ('sales.register.lead.link', 'sales_register'),
    ('sales.register.lead.unlink', 'sales_register'),
    ('sales.register.manager.label', 'sales_manager_label'),
    ('sales.register.pipeline', 'sales_register'),
    ('sales.register.restore', 'sales_register'),
    ('sales.register.target', 'sales_register_target'),
    ('sales.register.update', 'sales_register'),
    ('staff.role.archive', 'staff_role'),
    ('staff.role.assignments', 'membership'),
    ('staff.role.copy', 'staff_role'),
    ('staff.role.create', 'staff_role'),
    ('staff.role.publish', 'staff_role'),
    ('staff.role.restore', 'staff_role'),
    ('staff.role.save', 'staff_role'),
    ('staff.system.admin', 'membership'),
    ('staff.task.create', 'staff_task'),
    ('staff.task.edit', 'staff_task'),
    ('staff.task.status', 'staff_task'),
    ('student.profile.export.attempted', 'student_profile'),
    ('student.profile.export.failed', 'student_profile'),
    ('student.profile.export.generated', 'student_profile'),
    ('student.profile.field.review', 'student_profile'),
    ('student.profile.recognition.publish', 'student_profile'),
    ('student.profile.start', 'student_profile'),
    ('team.chat.delete', 'team_chat_message'),
    ('team.chat.edit', 'team_chat_message'),
    ('team.chat.moderate', 'team_chat_message'),
    ('team.chat.post', 'team_chat_message'),
    ('work.review.resolve', 'work_review_case');

INSERT INTO platform.audit_events(
  organization_id, actor_kind, actor_principal, action, resource_type, resource_id,
  after_state, reason, request_id
)
SELECT pg_temp.p7aj_id(1), 'system', 'P7AJ synthetic real-writer pair fixture actor', action, resource_type,
  pg_temp.p7aj_id(901), '{}'::JSONB, 'P7AJ synthetic real-writer pair fixture row', gen_random_uuid()
FROM p7aj_pairs;

SELECT pg_temp.p7aj_assert(
  (SELECT count(DISTINCT action) FROM p7aj_pairs) = 71
    AND (SELECT count(*) FROM p7aj_pairs) = 80,
  'the real-writer pair list covers the 71 actions 255 added (80 pairs: 9 document.export.* carry two resource types)');

SET LOCAL ROLE authenticated;
CREATE TEMP TABLE p7aj_pair_pages(page JSONB);
INSERT INTO p7aj_pair_pages(page)
  SELECT platform.search_audit_events(NULL, NULL, NULL, NULL, pg_temp.p7aj_id(901), 100);
RESET ROLE;

SELECT pg_temp.p7aj_assert(
  (SELECT count(*) FROM p7aj_pair_pages) = 1
    AND (SELECT (page ->> 'has_more')::BOOLEAN FROM p7aj_pair_pages) = FALSE,
  'the real-writer pairs fit one search_audit_events() page');
SELECT pg_temp.p7aj_assert(
  NOT EXISTS (
    SELECT action, resource_type FROM p7aj_pairs
    EXCEPT
    SELECT r ->> 'action', r ->> 'resource_type'
    FROM p7aj_pair_pages, jsonb_array_elements(page -> 'rows') AS r
  ),
  'real-writer (action, resource_type) pairs hidden by search_audit_events(): '
    || COALESCE((
      SELECT string_agg(m.action || '/' || m.resource_type, ', ' ORDER BY m.action, m.resource_type)
      FROM (
        SELECT action, resource_type FROM p7aj_pairs
        EXCEPT
        SELECT r ->> 'action', r ->> 'resource_type'
        FROM p7aj_pair_pages, jsonb_array_elements(page -> 'rows') AS r
      ) AS m
    ), ''));
SELECT pg_temp.p7aj_assert(
  (SELECT count(*) FROM p7aj_pair_pages, jsonb_array_elements(page -> 'rows'))
    = (SELECT count(*) FROM p7aj_pairs),
  'search_audit_events() returned exactly one row per real-writer pair');

-- ---------------------------------------------------------------------------
-- Actor label (migration 256). platform_private.p7a_safe_audit_row signs a
-- 'user' actor by the side of its membership in the row's organization:
--   'Student' -- the membership's current_role is 'student';
--   'Staff'   -- any other membership, a staff coarse role or NULL (staff
--                invited since 157 have no coarse role);
--   'User'    -- neutral, when the side cannot be resolved honestly: no
--                membership in that organization, a recorded
--                actor_membership_id that is a different membership, or a
--                membership whose side changed per
--                platform.membership_role_history.
-- 'service' -> 'Service' and 'system' -> 'System' are unchanged. The Student
-- rows are written the way the real writers write them (200's case.chat.post,
-- 046's document.download.grant, 116's document.upload.reserve): no
-- actor_membership_id. The notification.read row is deliberately NOT that
-- shape -- its real writers (068, 153) record no membership id either -- but
-- records the Student's own membership, the shape of the writers that do
-- record one (086, 087, 140, 241, 246 ...), to prove the "a recorded
-- membership must be the actor's own" branch reads the same label.
-- Every row shares one resource id, so the read below is filtered to them and
-- the page assertions above stay untouched.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.p7aj_bundle(p_role platform.business_role) RETURNS UUID LANGUAGE SQL STABLE AS $$
  SELECT id FROM platform.role_bundle_versions WHERE role = p_role AND status = 'published' ORDER BY version DESC LIMIT 1
$$;
SELECT pg_temp.p7aj_assert(
  pg_temp.p7aj_bundle('student') IS NOT NULL AND pg_temp.p7aj_bundle('curator') IS NOT NULL,
  'a published student bundle and a published curator bundle exist');

-- Fixture, as postgres, in organization 1 unless stated: a Student (202), a
-- staff member without a coarse role (203), a profile whose only membership is
-- in organization 2 (204) and a Student whose side once changed (205, a
-- pre-155 curator-to-student history entry; 155 froze "current_role" since).
-- The Student 202 carries the provisioning history entry the real
-- provisioning writes (126: no previous role), which is not a side change.
INSERT INTO platform.organizations(id, name) VALUES (pg_temp.p7aj_id(2), 'P7AJ Fictional organization 2');
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES
  (pg_temp.p7aj_id(102), 'p7aj-student@example.invalid', '{}'::JSONB),
  (pg_temp.p7aj_id(103), 'p7aj-staff@example.invalid', '{}'::JSONB),
  (pg_temp.p7aj_id(104), 'p7aj-other-organization@example.invalid', '{}'::JSONB),
  (pg_temp.p7aj_id(105), 'p7aj-side-changed@example.invalid', '{}'::JSONB);
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version) VALUES
  (pg_temp.p7aj_id(202), pg_temp.p7aj_id(102), 'P7AJ Student', 'active', 1),
  (pg_temp.p7aj_id(203), pg_temp.p7aj_id(103), 'P7AJ Staff without coarse role', 'active', 1),
  (pg_temp.p7aj_id(204), pg_temp.p7aj_id(104), 'P7AJ Member of organization 2 only', 'active', 1),
  (pg_temp.p7aj_id(205), pg_temp.p7aj_id(105), 'P7AJ Student whose side changed', 'active', 1);
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id) VALUES
  (pg_temp.p7aj_id(302), pg_temp.p7aj_id(1), pg_temp.p7aj_id(202), 'active', 'student', pg_temp.p7aj_bundle('student')),
  (pg_temp.p7aj_id(303), pg_temp.p7aj_id(1), pg_temp.p7aj_id(203), 'active', NULL, NULL),
  (pg_temp.p7aj_id(304), pg_temp.p7aj_id(2), pg_temp.p7aj_id(204), 'active', NULL, NULL),
  (pg_temp.p7aj_id(305), pg_temp.p7aj_id(1), pg_temp.p7aj_id(205), 'active', 'student', pg_temp.p7aj_bundle('student'));
INSERT INTO platform.membership_role_history(organization_id, membership_id, profile_id, role_version,
  previous_role, new_role, previous_bundle_id, new_bundle_id, actor_kind, actor_profile_id, reason, request_id) VALUES
  (pg_temp.p7aj_id(1), pg_temp.p7aj_id(302), pg_temp.p7aj_id(202), 1,
    NULL, 'student', NULL, pg_temp.p7aj_bundle('student'),
    'system', NULL, 'P7AJ synthetic provisioning', pg_temp.p7aj_id(904)),
  (pg_temp.p7aj_id(1), pg_temp.p7aj_id(305), pg_temp.p7aj_id(205), 1,
    'curator', 'student', pg_temp.p7aj_bundle('curator'), pg_temp.p7aj_bundle('student'),
    'system', NULL, 'P7AJ synthetic pre-155 side change', pg_temp.p7aj_id(905));

SELECT pg_temp.p7aj_assert(
  (SELECT m."current_role" = 'student' AND m.current_bundle_id IS NOT NULL AND m.status = 'active'
    FROM platform.organization_memberships m
    WHERE m.id = pg_temp.p7aj_id(302) AND m.organization_id = pg_temp.p7aj_id(1) AND m.profile_id = pg_temp.p7aj_id(202))
    AND NOT EXISTS (SELECT 1 FROM platform.membership_role_history h
      WHERE h.membership_id = pg_temp.p7aj_id(302) AND h.previous_role IS NOT NULL),
  'the fixture Student is an active student membership of organization 1 whose only history entry is its provisioning');
SELECT pg_temp.p7aj_assert(
  (SELECT m."current_role" IS NULL AND m.current_bundle_id IS NULL AND m.status = 'active' AND NOT m.is_system_admin
    FROM platform.organization_memberships m
    WHERE m.id = pg_temp.p7aj_id(303) AND m.organization_id = pg_temp.p7aj_id(1) AND m.profile_id = pg_temp.p7aj_id(203)),
  'the fixture staff member is an active membership of organization 1 with no coarse role');
SELECT pg_temp.p7aj_assert(
  (SELECT m.organization_id = pg_temp.p7aj_id(2)
    FROM platform.organization_memberships m
    WHERE m.id = pg_temp.p7aj_id(304) AND m.profile_id = pg_temp.p7aj_id(204))
    AND NOT EXISTS (SELECT 1 FROM platform.organization_memberships m
      WHERE m.organization_id = pg_temp.p7aj_id(1) AND m.profile_id = pg_temp.p7aj_id(204)),
  'the fixture profile 204 is a member of organization 2 only, never of organization 1');
SELECT pg_temp.p7aj_assert(
  (SELECT m."current_role" = 'student' AND m.organization_id = pg_temp.p7aj_id(1)
    FROM platform.organization_memberships m
    WHERE m.id = pg_temp.p7aj_id(305) AND m.profile_id = pg_temp.p7aj_id(205))
    AND (SELECT count(*) = 1 FROM platform.membership_role_history h
      WHERE h.membership_id = pg_temp.p7aj_id(305) AND h.previous_role = 'curator' AND h.new_role = 'student'),
  'the fixture side-changed Student is a student membership with one curator-to-student history entry');

-- The cases. n is the suffix of the row's p7aj_id audit event id (its request
-- id is n + 40); the actor columns are suffixes of p7aj_id profile and
-- membership ids, NULL when absent; the last column is the expected label.
CREATE TEMP TABLE p7aj_actor_cases(
  n INTEGER PRIMARY KEY,
  action TEXT NOT NULL,
  actor_kind TEXT NOT NULL,
  actor_profile_n INTEGER,
  actor_membership_n INTEGER,
  expected_label TEXT NOT NULL
);
INSERT INTO p7aj_actor_cases(n, action, actor_kind, actor_profile_n, actor_membership_n, expected_label) VALUES
  -- The Student's own actions as the real writers record them (no membership
  -- id), and one that records the Student's own membership.
  (811, 'case.chat.post',          'user',    202,  NULL, 'Student'),
  (812, 'notification.read',       'user',    202,  302,  'Student'),
  (813, 'document.download.grant', 'user',    202,  NULL, 'Student'),
  (814, 'document.upload.reserve', 'user',    202,  NULL, 'Student'),
  -- Staff: no coarse role (NULL) and the Admin.
  (815, 'case.chat.post',          'user',    203,  NULL, 'Staff'),
  (816, 'case.chat.post',          'user',    201,  301,  'Staff'),
  -- Neutral: the recorded membership is another one (the Admin's, on the
  -- Student's row); no membership in this organization; the side changed.
  (817, 'case.chat.post',          'user',    202,  301,  'User'),
  (818, 'case.chat.post',          'user',    204,  NULL, 'User'),
  (819, 'case.chat.post',          'user',    205,  NULL, 'User'),
  -- Not 'user' actors: one label each, whatever else is true.
  (820, 'case.chat.post',          'service', NULL, NULL, 'Service'),
  (821, 'case.chat.post',          'system',  NULL, NULL, 'System');

INSERT INTO platform.audit_events(
  id, organization_id, actor_kind, actor_profile_id, actor_membership_id, actor_principal,
  action, resource_type, resource_id, after_state, reason, request_id
)
SELECT pg_temp.p7aj_id(c.n), pg_temp.p7aj_id(1), c.actor_kind::platform.audit_actor_kind,
  pg_temp.p7aj_id(c.actor_profile_n), pg_temp.p7aj_id(c.actor_membership_n),
  'P7AJ synthetic actor-label fixture', c.action, 'student_case', pg_temp.p7aj_id(700), '{}'::JSONB,
  'P7AJ synthetic actor-label fixture row', pg_temp.p7aj_id(c.n + 40)
FROM p7aj_actor_cases c;

SELECT pg_temp.p7aj_assert(
  (SELECT count(*) FROM platform.audit_events
    WHERE organization_id = pg_temp.p7aj_id(1) AND resource_id = pg_temp.p7aj_id(700)) = 11
    AND (SELECT count(*) FROM p7aj_actor_cases) = 11,
  'eleven actor-label fixture rows share the dedicated resource id');

-- Read them back as the Admin through the REAL platform.search_audit_events(),
-- filtered to the dedicated resource id, and keep the page for the assertions
-- and for the checker script.
SET LOCAL request.jwt.claims TO :'p7aj_admin_claims';
SET LOCAL ROLE authenticated;
SELECT platform.search_audit_events(
  NULL, NULL, NULL, NULL, pg_temp.p7aj_id(700), 100, NULL, NULL, NULL, NULL
)::TEXT AS p7aj_actor_page \gset
RESET ROLE;

CREATE TEMP TABLE p7aj_actor_rows AS
  SELECT r.row_json FROM jsonb_array_elements(:'p7aj_actor_page'::JSONB -> 'rows') AS r(row_json);
CREATE TEMP TABLE p7aj_actor_read_back AS
  SELECT c.n, c.expected_label, e.actor_kind::TEXT AS inserted_kind,
    r.row_json ->> 'actor_display_label' AS read_label, r.row_json ->> 'actor_kind' AS read_kind
  FROM p7aj_actor_cases c
  JOIN platform.audit_events e ON e.id = pg_temp.p7aj_id(c.n)
  JOIN p7aj_actor_rows r ON r.row_json ->> 'audit_event_id' = e.id::TEXT;

SELECT pg_temp.p7aj_assert(
  (:'p7aj_actor_page'::JSONB ->> 'has_more')::BOOLEAN IS FALSE,
  'actor labels: has_more is false, every fixture row fits one page');
SELECT pg_temp.p7aj_assert(
  (SELECT count(*) FROM p7aj_actor_rows) = 11,
  'actor labels: the page has exactly the 11 fixture rows');
SELECT pg_temp.p7aj_assert(
  (SELECT count(*) FROM p7aj_actor_read_back) = 11 AND (SELECT count(DISTINCT n) FROM p7aj_actor_read_back) = 11,
  'actor labels: every fixture audit event is read back exactly once');
SELECT pg_temp.p7aj_assert(
  NOT EXISTS (SELECT 1 FROM p7aj_actor_read_back WHERE read_label IS DISTINCT FROM expected_label),
  'actor labels: actor_display_label differs from the expected one for: ' || COALESCE((
    SELECT string_agg(n::TEXT || ' expected ' || expected_label || ' read ' || COALESCE(read_label, 'NULL'), '; ' ORDER BY n)
    FROM p7aj_actor_read_back WHERE read_label IS DISTINCT FROM expected_label), 'none'));
SELECT pg_temp.p7aj_assert(
  NOT EXISTS (SELECT 1 FROM p7aj_actor_read_back WHERE read_kind IS DISTINCT FROM inserted_kind),
  'actor labels: actor_kind differs from the inserted one for: ' || COALESCE((
    SELECT string_agg(n::TEXT || ' inserted ' || inserted_kind || ' read ' || COALESCE(read_kind, 'NULL'), '; ' ORDER BY n)
    FROM p7aj_actor_read_back WHERE read_kind IS DISTINCT FROM inserted_kind), 'none'));
SELECT pg_temp.p7aj_assert(
  (SELECT count(DISTINCT r.row_json ->> 'actor_display_label') = 5
      AND bool_and(r.row_json ->> 'actor_display_label' IN ('Student', 'Staff', 'User', 'Service', 'System'))
    FROM p7aj_actor_rows r),
  'actor labels: the page carries exactly the five labels Student, Staff, User, Service and System');
SELECT pg_temp.p7aj_assert(
  (SELECT bool_and(
      (SELECT count(*) FROM jsonb_object_keys(r.row_json)) = 10
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_object_keys(r.row_json) AS k
        WHERE k NOT IN ('audit_event_id', 'created_at', 'action', 'resource_type', 'resource_id',
          'actor_kind', 'actor_display_label', 'request_id', 'reason_code', 'changed_field_codes')))
    FROM p7aj_actor_rows r),
  'actor labels: every row carries exactly the ten safe keys and nothing else, no actor profile or membership id');

-- ---------------------------------------------------------------------------
-- Emit the live server contract and every captured page as single-line JSON
-- for scripts/check-platform-audit-journal-contract.mjs. Unaligned,
-- tuples-only output: each SELECT below prints exactly one prefixed line.
-- ---------------------------------------------------------------------------
\pset tuples_only on
\pset format unaligned

SELECT 'P7A_JOURNAL_CONTRACT ' || jsonb_build_object(
  'actions', to_jsonb(platform_private.p7a_safe_audit_actions()),
  'resourceTypes', to_jsonb(platform_private.p7a_safe_audit_resource_types()),
  'changedFieldCodesByAction', (
    SELECT jsonb_object_agg(a, to_jsonb(platform_private.p7a_changed_field_codes(a)))
    FROM unnest(platform_private.p7a_safe_audit_actions()) AS a
  )
)::TEXT;

SELECT 'P7A_JOURNAL_PAGE ' || page::TEXT FROM p7aj_pages ORDER BY page_index;
SELECT 'P7A_JOURNAL_PAGE ' || page::TEXT FROM p7aj_pair_pages;
-- The actor-label page too: the checker replays it through the real TS
-- normalizer, which must accept Student and User for a 'user' actor.
SELECT 'P7A_JOURNAL_PAGE ' || :'p7aj_actor_page';

\pset tuples_only off
\pset format aligned

SELECT 'P7AJ_JOURNAL_CONTRACT_SUITE_PASS' AS p7aj_suite_marker;
ROLLBACK;
