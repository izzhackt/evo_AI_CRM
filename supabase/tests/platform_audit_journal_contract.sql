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
-- «2026-09-29 — «Журнал действий»: серверный allowlist аудита расширен на
-- 71 действие» and the lead's PR #1120 head 170efb75 correction) with one
-- privacy pin: a hardcoded list of the 29 actions and 4 resource types 255
-- deliberately did NOT allowlist (see 255's own header for the per-action
-- reasons), asserted absent from
-- p7a_safe_audit_actions()/p7a_safe_audit_resource_types(), plus five seeded
-- excluded-action rows proven absent from a real search_audit_events() read.
-- This is the one intentional exception to the "no hardcoded list" rule
-- above: it exists to catch a future migration accidentally re-adding one of
-- these, not to re-derive the INCLUDE contract this suite already proves
-- live.
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
-- действий»: серверный allowlist аудита расширен на 73 действия»): the
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

\pset tuples_only off
\pset format aligned

SELECT 'P7AJ_JOURNAL_CONTRACT_SUITE_PASS' AS p7aj_suite_marker;
ROLLBACK;
