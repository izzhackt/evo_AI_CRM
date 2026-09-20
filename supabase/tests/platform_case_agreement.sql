\set ON_ERROR_STOP on

-- Current-boundary acceptance for migration 189 (OTH-3 «Договор и оплата»).
-- Same shape as supabase/tests/platform_cabinet_invites.sql (185): synthetic
-- org/memberships, live JWT claims via the production custom_access_token_hook.
--
-- FIX 2 (adversarial review) replaced migration 189's earlier org-wide Sales
-- role widening (every org's Sales role bundle gaining 'case.update.append')
-- with a resource-scoped door: the case's OWN responsible Sales rep may use
-- the two write RPCs (and now reads the block, can_write=true) while — and
-- only while — the case is still 'pending'. This suite proves THAT door, not
-- a role grant: Sales A receives NO staff_role_assignments row at all. Only
-- the Curator is explicitly granted case.update.append (via
-- staff_role_command/staff_role_publish/staff_role_assignments_save, same
-- sequence as platform_cabinet_invites.sql:165-243) — a fresh synthetic
-- membership created AFTER migrations applied never went through 155's
-- historical legacy-role backfill, so it starts with zero
-- staff_role_assignments, and the scoped-permission system (155) reads that
-- table, not organization_memberships.current_bundle_id / the generic
-- 'curator' role_bundle_versions catalog entry.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

CREATE FUNCTION pg_temp.p188_id(n INTEGER) RETURNS UUID
LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('18800000-0000-4000-8000-'||lpad(n::TEXT, 12, '0'))::UUID
$$;

CREATE FUNCTION pg_temp.p188_assert(p_condition BOOLEAN, p_message TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Migration 189 assertion failed: %', p_message;
  END IF;
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.p188_id(INTEGER), pg_temp.p188_assert(BOOLEAN, TEXT)
  TO authenticated, service_role;

SELECT 'P188_CASE_AGREEMENT_SUITE_START' AS p188_suite_marker;

-- ---------------------------------------------------------------------------
-- Seed: organization; admin; Sales A (the case's own responsible Sales rep —
-- proves the resource-scoped door, never granted any role); Sales B (a
-- DIFFERENT Sales rep, not responsible for this case — the negative
-- resource-scope proof); Curator (granted case.update.append AFTER handoff,
-- 'own' scope); Student (the case's own portal member — must never write
-- here).
-- ---------------------------------------------------------------------------
INSERT INTO platform.organizations (id, name)
VALUES (pg_temp.p188_id(1), 'Migration 188 synthetic organization');

INSERT INTO platform.record_scopes (id, organization_id, scope_kind, scope_key, scope_version)
VALUES (pg_temp.p188_id(2), pg_temp.p188_id(1), 'organization', pg_temp.p188_id(1), 1);

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  (pg_temp.p188_id(101), 'p188-admin@example.invalid', '{}'::JSONB),
  (pg_temp.p188_id(102), 'p188-sales-a@example.invalid', '{}'::JSONB),
  (pg_temp.p188_id(103), 'p188-sales-b@example.invalid', '{}'::JSONB),
  (pg_temp.p188_id(104), 'p188-curator@example.invalid', '{}'::JSONB),
  (pg_temp.p188_id(105), 'p188-student@example.invalid', '{}'::JSONB);

INSERT INTO platform.profiles (id, auth_user_id, display_name, status, access_version)
VALUES
  (pg_temp.p188_id(201), pg_temp.p188_id(101), 'P188 Admin', 'active', 1),
  (pg_temp.p188_id(202), pg_temp.p188_id(102), 'P188 Sales A', 'active', 1),
  (pg_temp.p188_id(203), pg_temp.p188_id(103), 'P188 Sales B', 'active', 1),
  (pg_temp.p188_id(204), pg_temp.p188_id(104), 'P188 Curator', 'active', 1),
  (pg_temp.p188_id(205), pg_temp.p188_id(105), 'P188 Student', 'active', 1);

INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin
) VALUES
  (pg_temp.p188_id(301), pg_temp.p188_id(1), pg_temp.p188_id(201), 'active', 'admin',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'admin' AND status = 'published' ORDER BY version DESC LIMIT 1), TRUE),
  (pg_temp.p188_id(302), pg_temp.p188_id(1), pg_temp.p188_id(202), 'active', 'sales',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'sales' AND status = 'published' ORDER BY version DESC LIMIT 1), FALSE),
  (pg_temp.p188_id(303), pg_temp.p188_id(1), pg_temp.p188_id(203), 'active', 'sales',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'sales' AND status = 'published' ORDER BY version DESC LIMIT 1), FALSE),
  (pg_temp.p188_id(304), pg_temp.p188_id(1), pg_temp.p188_id(204), 'active', 'curator',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'curator' AND status = 'published' ORDER BY version DESC LIMIT 1), FALSE),
  (pg_temp.p188_id(305), pg_temp.p188_id(1), pg_temp.p188_id(205), 'active', 'student',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'student' AND status = 'published' ORDER BY version DESC LIMIT 1), FALSE);

SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p188_id(101), 'claims', jsonb_build_object('sub', pg_temp.p188_id(101), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p188_admin_claims \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p188_id(102), 'claims', jsonb_build_object('sub', pg_temp.p188_id(102), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p188_sales_a_claims \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p188_id(103), 'claims', jsonb_build_object('sub', pg_temp.p188_id(103), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p188_sales_b_claims \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p188_id(104), 'claims', jsonb_build_object('sub', pg_temp.p188_id(104), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p188_curator_claims \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p188_id(105), 'claims', jsonb_build_object('sub', pg_temp.p188_id(105), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p188_student_claims \gset

-- ---------------------------------------------------------------------------
-- Pending case: Sales A responsible, no curator yet. Satisfies 180's
-- student_cases_state_shape_check (pending ⇒ current_curator_membership_id/
-- handoff_at/closed_at all NULL) from the very first INSERT — CHECKs are
-- enforced unconditionally, including under session_replication_role=replica
-- used later for the handoff transition below.
-- ---------------------------------------------------------------------------
INSERT INTO platform.record_scopes (id, organization_id, scope_kind, scope_key, scope_version)
VALUES (pg_temp.p188_id(5), pg_temp.p188_id(1), 'student_case', pg_temp.p188_id(6), 1);

INSERT INTO platform.student_cases (
  id, organization_id, responsible_sales_membership_id,
  student_membership_id, source_key, student_display_name, operational_stage, state,
  current_scope_id, current_scope_version
) VALUES (
  pg_temp.p188_id(6), pg_temp.p188_id(1), pg_temp.p188_id(302),
  pg_temp.p188_id(305), 'synthetic:p188:case', 'P188 Student Case', 'intake_review', 'pending',
  pg_temp.p188_id(5), 1
);

-- The sale-conditions row and canonical_lead_id both FK a real lead: seed the
-- client+lead pair first (same shape as platform_cabinet_invites.sql).
INSERT INTO platform.clients (id, organization_id, display_name, normalized_name)
VALUES (
  pg_temp.p188_id(8), pg_temp.p188_id(1), 'P188 Agreement Client',
  platform_private.normalize_person_name('P188 Agreement Client')
);
INSERT INTO platform.leads (
  id, organization_id, client_id, current_owner_membership_id, stage_key, source_key
) VALUES (
  pg_temp.p188_id(7), pg_temp.p188_id(1), pg_temp.p188_id(8), pg_temp.p188_id(302), 'new', 'website'
);

INSERT INTO platform_private.lead_sale_conditions (organization_id, lead_id, fields, revision, updated_by_membership_id)
VALUES (
  pg_temp.p188_id(1), pg_temp.p188_id(7),
  jsonb_build_object('service_cost_minor', 500000, 'service_cost_currency', 'USD'),
  1, pg_temp.p188_id(302)
);
UPDATE platform.student_cases SET canonical_lead_id = pg_temp.p188_id(7) WHERE id = pg_temp.p188_id(6);

-- ---------------------------------------------------------------------------
-- Sales B (a different Sales rep, not responsible for this case, no role
-- grant) and the case's own Student must both be refused 42501 on tranche
-- creation — proving the door is resource-scoped to the OWNING Sales rep,
-- not "any Sales session".
-- ---------------------------------------------------------------------------
SET request.jwt.claims TO :'p188_sales_b_claims';
SET ROLE authenticated;
DO $$
BEGIN
  PERFORM platform.save_case_tranche_v1(
    pg_temp.p188_id(1), pg_temp.p188_id(901), pg_temp.p188_id(6), NULL,
    100000, 'USD', NULL, 'Транш 1', FALSE
  );
  RAISE EXCEPTION 'Sales B was unexpectedly allowed to create a tranche';
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> '42501' THEN RAISE; END IF;
END
$$;
RESET ROLE;
RESET request.jwt.claims;

SET request.jwt.claims TO :'p188_student_claims';
SET ROLE authenticated;
DO $$
BEGIN
  PERFORM platform.save_case_tranche_v1(
    pg_temp.p188_id(1), pg_temp.p188_id(902), pg_temp.p188_id(6), NULL,
    100000, 'USD', NULL, 'Транш 1', FALSE
  );
  RAISE EXCEPTION 'the case''s own Student was unexpectedly allowed to create a tranche';
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> '42501' THEN RAISE; END IF;
END
$$;
RESET ROLE;
RESET request.jwt.claims;

-- ---------------------------------------------------------------------------
-- Sales A — the case's own responsible Sales rep, PENDING, NO role grant:
-- create a tranche, record a payment. Both succeed purely through the
-- resource-scoped door (FIX 2), not a permission grant.
-- ---------------------------------------------------------------------------
SET request.jwt.claims TO :'p188_sales_a_claims';
SET ROLE authenticated;

SELECT platform.save_case_tranche_v1(
  pg_temp.p188_id(1), pg_temp.p188_id(911), pg_temp.p188_id(6), NULL,
  500000, 'USD', '2026-12-31'::DATE, 'Транш 1', FALSE
) AS p188_tranche_result \gset
SELECT (:'p188_tranche_result'::JSONB ->> 'payment_obligation_id')::UUID
  AS p188_tranche_id \gset
-- psql does not interpolate :'vars' inside $$-quoted DO bodies: publish the
-- id through a session GUC for the negative-path blocks below.
SELECT set_config('p188.tranche_id', :'p188_tranche_id', FALSE);

SELECT platform.record_case_payment_v1(
  pg_temp.p188_id(1), pg_temp.p188_id(912), pg_temp.p188_id(6), :'p188_tranche_id'::UUID,
  200000, 'USD', '2026-09-19'::DATE, NULL
) AS p188_payment_result \gset
SELECT (:'p188_payment_result'::JSONB ->> 'payment_event_id')::UUID AS p188_payment_event_id \gset

-- Replay: same request_id, same payload — must not double-count.
SELECT platform.record_case_payment_v1(
  pg_temp.p188_id(1), pg_temp.p188_id(912), pg_temp.p188_id(6), :'p188_tranche_id'::UUID,
  200000, 'USD', '2026-09-19'::DATE, NULL
) AS p188_payment_replay \gset
SELECT pg_temp.p188_assert(
  :'p188_payment_replay'::JSONB = :'p188_payment_result'::JSONB,
  'replay did not return the identical stored result');
-- Amount/currency edit rejected once paid; label/due edit still allowed.
DO $$
BEGIN
  PERFORM platform.save_case_tranche_v1(
    pg_temp.p188_id(1), pg_temp.p188_id(913), pg_temp.p188_id(6), current_setting('p188.tranche_id')::UUID,
    600000, 'USD', NULL, NULL, FALSE
  );
  RAISE EXCEPTION 'amount edit on a paid tranche was unexpectedly accepted';
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> '22023' THEN RAISE; END IF;
END
$$;
SELECT platform.save_case_tranche_v1(
  pg_temp.p188_id(1), pg_temp.p188_id(914), pg_temp.p188_id(6), :'p188_tranche_id'::UUID,
  NULL, NULL, NULL, 'Транш 1 (уточнено)', FALSE
) AS p188_label_edit \gset
-- Archive rejected once paid.
DO $$
BEGIN
  PERFORM platform.save_case_tranche_v1(
    pg_temp.p188_id(1), pg_temp.p188_id(915), pg_temp.p188_id(6), current_setting('p188.tranche_id')::UUID,
    NULL, NULL, NULL, NULL, TRUE
  );
  RAISE EXCEPTION 'archiving a paid tranche was unexpectedly accepted';
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> '22023' THEN RAISE; END IF;
END
$$;

RESET ROLE;
RESET request.jwt.claims;

-- Direct-table persistence checks run as superuser: payment_obligations /
-- payment_events RLS hides rows from an ungranted Sales actor, so these
-- assertions live OUTSIDE the actor session (same placement rule as
-- platform_cabinet_invites.sql / platform_pipeline_board.sql).
SELECT pg_temp.p188_assert(
  EXISTS(SELECT 1 FROM platform.payment_obligations
    WHERE id = :'p188_tranche_id'::UUID AND organization_id = pg_temp.p188_id(1)
      AND student_case_id = pg_temp.p188_id(6) AND amount_minor = 500000
      AND currency = 'USD' AND category = 'evo_service_fee' AND archived_at IS NULL),
  'tranche was not persisted as expected');

SELECT pg_temp.p188_assert(
  (SELECT total_paid_minor FROM platform.payment_obligations WHERE id = :'p188_tranche_id'::UUID) = 200000,
  'payment did not update the obligation aggregate (checked after replay: still 200000)');

SELECT pg_temp.p188_assert(
  (SELECT total_paid_minor FROM platform.payment_obligations WHERE id = :'p188_tranche_id'::UUID) = 200000,
  'replaying the same request_id double-counted the payment');
SELECT pg_temp.p188_assert(
  (SELECT count(*) FROM platform.payment_events WHERE payment_obligation_id = :'p188_tranche_id'::UUID) = 1,
  'replay inserted a second payment_events row');

SELECT pg_temp.p188_assert(
  (SELECT label FROM platform.payment_obligations WHERE id = :'p188_tranche_id'::UUID) = 'Транш 1 (уточнено)',
  'label-only edit on a paid tranche was unexpectedly rejected');

-- ---------------------------------------------------------------------------
-- Sales B, still not responsible for this case, still ungranted: 42501 on
-- BOTH remaining doors too — record_case_payment_v1 (against Sales A's now-
-- real tranche) and the read RPC. Completes the "42501 on all three" proof
-- FIX 2 asks for (tranche-create was already proven above).
-- ---------------------------------------------------------------------------
SET request.jwt.claims TO :'p188_sales_b_claims';
SET ROLE authenticated;
DO $$
BEGIN
  PERFORM platform.record_case_payment_v1(
    pg_temp.p188_id(1), pg_temp.p188_id(903), pg_temp.p188_id(6), current_setting('p188.tranche_id')::UUID,
    10000, 'USD', '2026-09-19'::DATE, NULL
  );
  RAISE EXCEPTION 'Sales B was unexpectedly allowed to record a payment';
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> '42501' THEN RAISE; END IF;
END
$$;
DO $$
BEGIN
  PERFORM platform.staff_case_agreement_v1(pg_temp.p188_id(6));
  RAISE EXCEPTION 'Sales B was unexpectedly allowed to read the block';
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> '42501' THEN RAISE; END IF;
END
$$;
RESET ROLE;
RESET request.jwt.claims;

-- Sales A reads their own pending case: succeeds (visibility OR clause) and
-- can_write is true (write-side OR clause) — FIX 2's read/write symmetry.
SET request.jwt.claims TO :'p188_sales_a_claims';
SET ROLE authenticated;
SELECT platform.staff_case_agreement_v1(pg_temp.p188_id(6)) AS p188_sales_a_read \gset
SELECT pg_temp.p188_assert(
  (:'p188_sales_a_read'::JSONB ->> 'can_write')::BOOLEAN,
  'Sales A (responsible, pending) did not get can_write=true from the read RPC');
SELECT pg_temp.p188_assert(
  jsonb_array_length(:'p188_sales_a_read'::JSONB -> 'tranches') = 1,
  'Sales A''s read did not see their own tranche');

-- ---------------------------------------------------------------------------
-- FIX 3: a second, unpaid, OVERDUE tranche — proves
-- platform.staff_finance_control_queue excludes an archived tranche from its
-- per-case counts. Still Sales A / still pending (same resource-scope door).
-- ---------------------------------------------------------------------------
SELECT platform.save_case_tranche_v1(
  pg_temp.p188_id(1), pg_temp.p188_id(916), pg_temp.p188_id(6), NULL,
  50000, 'USD', (CURRENT_DATE - 1)::DATE, 'Транш 2 (просрочен)', FALSE
) AS p188_second_tranche \gset
SELECT (:'p188_second_tranche'::JSONB ->> 'payment_obligation_id')::UUID
  AS p188_second_tranche_id \gset
RESET ROLE;
RESET request.jwt.claims;

SET request.jwt.claims TO :'p188_admin_claims';
SET ROLE authenticated;
SELECT overdue_obligation_count, outstanding_obligation_count
FROM platform.staff_finance_control_queue(10, ARRAY[pg_temp.p188_id(6)]::UUID[])
\gset p188_queue_before_
SELECT pg_temp.p188_assert(
  :'p188_queue_before_overdue_obligation_count'::BIGINT = 1
    AND :'p188_queue_before_outstanding_obligation_count'::BIGINT = 2,
  'finance control queue counts before archiving did not include the overdue/unpaid second tranche');
RESET ROLE;
RESET request.jwt.claims;

SET request.jwt.claims TO :'p188_sales_a_claims';
SET ROLE authenticated;
SELECT platform.save_case_tranche_v1(
  pg_temp.p188_id(1), pg_temp.p188_id(917), pg_temp.p188_id(6), :'p188_second_tranche_id'::UUID,
  NULL, NULL, NULL, NULL, TRUE
) AS p188_second_tranche_archived \gset
RESET ROLE;
RESET request.jwt.claims;
-- Superuser check: RLS hides the row from the ungranted Sales session.
SELECT pg_temp.p188_assert(
  (SELECT archived_at FROM platform.payment_obligations WHERE id = :'p188_second_tranche_id'::UUID) IS NOT NULL,
  'second tranche was not archived as expected');

SET request.jwt.claims TO :'p188_admin_claims';
SET ROLE authenticated;
SELECT overdue_obligation_count, outstanding_obligation_count
FROM platform.staff_finance_control_queue(10, ARRAY[pg_temp.p188_id(6)]::UUID[])
\gset p188_queue_after_
SELECT pg_temp.p188_assert(
  :'p188_queue_after_overdue_obligation_count'::BIGINT = 0
    AND :'p188_queue_after_outstanding_obligation_count'::BIGINT = 1,
  'finance control queue counts did not drop after archiving the overdue/unpaid second tranche');
RESET ROLE;
RESET request.jwt.claims;

-- ---------------------------------------------------------------------------
-- Handoff: the case moves to 'active'. Sales A's resource-scoped door
-- resolves only while state='pending' — direct UPDATE under
-- session_replication_role=replica (skips 042's transition-guard trigger;
-- table CHECKs still apply regardless, so curator+handoff_at must be set
-- together with state per 180's student_cases_state_shape_check: active ⇒
-- curator NOT NULL + handoff_at NOT NULL + closed_at NULL).
-- ---------------------------------------------------------------------------
SET LOCAL session_replication_role = replica;
UPDATE platform.student_cases
SET state = 'active',
  current_curator_membership_id = pg_temp.p188_id(304),
  handoff_at = statement_timestamp()
WHERE id = pg_temp.p188_id(6);
SET LOCAL session_replication_role = origin;

-- Sales A, now on the active case: resource-scoped door no longer matches
-- (state <> 'pending'), no role grant either — 42501, the mirror image of
-- the Sales B/Student checks above, proving the scope genuinely moved.
SET request.jwt.claims TO :'p188_sales_a_claims';
SET ROLE authenticated;
DO $$
BEGIN
  PERFORM platform.save_case_tranche_v1(
    pg_temp.p188_id(1), pg_temp.p188_id(918), pg_temp.p188_id(6), NULL,
    100000, 'USD', NULL, 'Транш 3', FALSE
  );
  RAISE EXCEPTION 'Sales A was unexpectedly still allowed to write on the now-active case';
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> '42501' THEN RAISE; END IF;
END
$$;
RESET ROLE;
RESET request.jwt.claims;

-- ---------------------------------------------------------------------------
-- Curator: granted case.update.append ('own' scope) via the ordinary
-- staff_role_command/staff_role_publish/staff_role_assignments_save sequence
-- (185's platform_cabinet_invites.sql:165-243 shape). Claims are rebuilt
-- afterwards because the grant bumps the membership's access version.
-- ---------------------------------------------------------------------------
SET request.jwt.claims TO :'p188_admin_claims';
SET ROLE authenticated;

SELECT platform.staff_role_command(
  pg_temp.p188_id(1), pg_temp.p188_id(401), 0, 'create',
  jsonb_build_object('label', 'P188 case-agreement writers',
    'description', 'Migration 189 synthetic role',
    'permissionKeys', jsonb_build_array('case.update.append')),
  'P188 create role', pg_temp.p188_id(411)
) AS p188_role_created \gset
SELECT pg_temp.p188_assert(
  :'p188_role_created'::JSONB = jsonb_build_object('status','applied','roleId',pg_temp.p188_id(401),'version',1),
  'role creation did not apply as expected');

SELECT platform.staff_role_impact(pg_temp.p188_id(1), pg_temp.p188_id(401), 1) ->> 'impactFingerprint'
  AS p188_role_impact_fingerprint \gset
SELECT platform.staff_role_publish(
  pg_temp.p188_id(1), pg_temp.p188_id(401), 1, :'p188_role_impact_fingerprint',
  'P188 publish role', pg_temp.p188_id(412)
) AS p188_role_published \gset
SELECT (:'p188_role_published'::JSONB ->> 'bundleId') AS p188_role_bundle_id \gset

SELECT platform.staff_role_assignments_save(
  pg_temp.p188_id(1), pg_temp.p188_id(304), 1,
  jsonb_build_array(jsonb_build_object('roleId', pg_temp.p188_id(401),
    'scope', jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL))),
  jsonb_build_array(jsonb_build_object('roleId', pg_temp.p188_id(401), 'roleVersion', 2,
    'bundleId', :'p188_role_bundle_id'::UUID, 'bundleVersion', 1)),
  'P188 grant Curator', pg_temp.p188_id(413)
) AS p188_curator_grant \gset

RESET ROLE;
RESET request.jwt.claims;

SELECT pg_temp.p188_assert(
  (:'p188_curator_grant'::JSONB ->> 'status') = 'applied', 'Curator grant did not apply');

-- REBUILD: the grant above bumped the Curator membership's access_version;
-- the claims fetched at the top of this suite are now stale.
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p188_id(104), 'claims', jsonb_build_object('sub', pg_temp.p188_id(104), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p188_curator_claims \gset

-- Curator, now granted, on the active case: create then archive a third,
-- unpaid tranche — the write door's OTHER genuine ownership window
-- (staff_resource_context resolves 'own' to the Curator once active).
SET request.jwt.claims TO :'p188_curator_claims';
SET ROLE authenticated;
SELECT platform.save_case_tranche_v1(
  pg_temp.p188_id(1), pg_temp.p188_id(919), pg_temp.p188_id(6), NULL,
  100000, 'USD', NULL, 'Транш 3', FALSE
) AS p188_third_tranche \gset
SELECT (:'p188_third_tranche'::JSONB ->> 'payment_obligation_id')::UUID AS p188_third_tranche_id \gset
SELECT platform.save_case_tranche_v1(
  pg_temp.p188_id(1), pg_temp.p188_id(920), pg_temp.p188_id(6), :'p188_third_tranche_id'::UUID,
  NULL, NULL, NULL, NULL, TRUE
) AS p188_third_tranche_archived \gset
RESET ROLE;
RESET request.jwt.claims;
-- Superuser check: payment_obligations RLS is finance-scoped, not case-scoped.
SELECT pg_temp.p188_assert(
  (SELECT archived_at FROM platform.payment_obligations WHERE id = :'p188_third_tranche_id'::UUID) IS NOT NULL,
  'third tranche (Curator, post-handoff) was not archived as expected');

-- ---------------------------------------------------------------------------
-- Final read (Admin): only tranche 1 (paid 200000 of 500000) remains
-- unarchived; tranches 2 and 3 were both archived. FIX 4: the payments array
-- now carries event_type for the existing payment row (the honest cheap
-- path — no refund is actually recorded here; granting the admin-only
-- finance.event.confirm permission through another synthetic role just to
-- exercise 043's refund RPC would be disproportionate to this slice. The
-- refund-labeling UI itself is proven at the TS parser/source level in
-- tests/v3-case-agreement.test.mjs with a refund fixture row).
-- ---------------------------------------------------------------------------
SET request.jwt.claims TO :'p188_admin_claims';
SET ROLE authenticated;
SELECT platform.staff_case_agreement_v1(pg_temp.p188_id(6)) AS p188_agreement \gset
SELECT pg_temp.p188_assert(
  (:'p188_agreement'::JSONB ->> 'tranche_sum_minor') = '500000',
  'archived tranches were not excluded from tranche_sum_minor');
SELECT pg_temp.p188_assert(
  (:'p188_agreement'::JSONB ->> 'paid_minor') = '200000',
  'paid_minor did not reflect the recorded payment');
SELECT pg_temp.p188_assert(
  jsonb_array_length(:'p188_agreement'::JSONB -> 'tranches') = 1,
  'archived tranches were not excluded from the tranche list');
SELECT pg_temp.p188_assert(
  (:'p188_agreement'::JSONB ->> 'cost_minor') = '500000'
    AND (:'p188_agreement'::JSONB ->> 'remaining_minor') = '300000',
  'cost/remaining did not resolve from the linked lead sale conditions');
SELECT pg_temp.p188_assert(
  jsonb_array_length(:'p188_agreement'::JSONB -> 'payments') = 1
    AND (:'p188_agreement'::JSONB -> 'payments' -> 0 ->> 'event_type') = 'payment',
  'FIX 4: the read RPC did not emit event_type for the existing payment row');

RESET ROLE;
RESET request.jwt.claims;

-- ---------------------------------------------------------------------------
-- Contract/receipt metadata RPCs: service_role only.
-- ---------------------------------------------------------------------------
SET request.jwt.claims TO :'p188_sales_a_claims';
SET ROLE authenticated;
DO $$
BEGIN
  PERFORM platform.record_case_contract_file_metadata(
    pg_temp.p188_id(1), pg_temp.p188_id(6), pg_temp.p188_id(302),
    'contract.pdf', 'application/pdf', 1024,
    '0000000000000000000000000000000000000000000000000000000000000000'::TEXT,
    'case-contracts/p188/synthetic', pg_temp.p188_id(921)
  );
  RAISE EXCEPTION 'contract metadata RPC was unexpectedly accepted for a non-service-role caller';
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> '42501' THEN RAISE; END IF;
END
$$;
RESET ROLE;
RESET request.jwt.claims;

SELECT 'P188_CASE_AGREEMENT_SUITE_END' AS p188_suite_marker;

ROLLBACK;
