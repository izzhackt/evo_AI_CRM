\set ON_ERROR_STOP on

-- Current-boundary acceptance for migration 185 (S8 «выдача приглашения для
-- кабинетных дел»). Runs at the 185 checkpoint, against the FULL current
-- schema (155's scoped-staff-roles model, 173's shared business roles, 180's
-- pending-portal relaxation, 184's lead-cabinet cases are all already live) --
-- unlike platform_student_portal_provisioning.sql (126), which runs against
-- the migration-126-era schema and therefore cannot see case_shape
-- 'cabinet_pending' at all. Provider calls are outside this suite: every Auth
-- row and delivery result is synthetic SQL evidence, same convention as 126.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

-- Same lightweight Auth bootstrap 126 uses: managed Supabase Auth owns these
-- columns for real; add them transaction-locally so invite/finalize evidence
-- can be exercised, then let ROLLBACK discard the DDL along with every row.
ALTER TABLE auth.users
  ADD COLUMN confirmation_sent_at TIMESTAMPTZ,
  ADD COLUMN email_confirmed_at TIMESTAMPTZ,
  ADD COLUMN confirmed_at TIMESTAMPTZ;

CREATE FUNCTION pg_temp.p185_id(n INTEGER) RETURNS UUID
LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('18500000-0000-4000-8000-'||lpad(n::TEXT, 12, '0'))::UUID
$$;

CREATE FUNCTION pg_temp.p185_assert(p_condition BOOLEAN, p_message TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Migration 185 assertion failed: %', p_message;
  END IF;
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.p185_id(INTEGER), pg_temp.p185_assert(BOOLEAN, TEXT)
  TO authenticated, service_role;

-- Generic negative-assertion helpers, in the family's RAISE-based idiom
-- (mirrors p126_expect_*), parameterized instead of inlined into a DO block
-- so a psql-captured value (a dynamically created case/receipt id) can be
-- passed in as a bound argument rather than textually substituted inside a
-- dollar-quoted body -- this codebase's suites never do the latter.
CREATE FUNCTION pg_temp.p185_expect_prepare_denied(
  p_organization_id UUID, p_case_id UUID, p_email TEXT, p_name TEXT,
  p_shape TEXT, p_curator UUID, p_reason TEXT, p_request_id UUID,
  p_sqlstate TEXT, p_message TEXT
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM platform.prepare_student_portal_provisioning(
    p_organization_id, p_case_id, p_email, p_name, p_shape, p_curator,
    p_reason, p_request_id
  );
  RAISE EXCEPTION 'prepare_student_portal_provisioning was unexpectedly accepted (expected % / %)',
    p_sqlstate, p_message;
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> p_sqlstate OR SQLERRM <> p_message THEN RAISE; END IF;
END
$$;

CREATE FUNCTION pg_temp.p185_expect_reissue_denied(
  p_receipt_id UUID, p_expected_receipt_version BIGINT,
  p_expected_invite_generation BIGINT, p_reissue_request_id UUID,
  p_reason TEXT, p_sqlstate TEXT, p_message TEXT
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM platform.authorize_student_portal_invite_reissue(
    p_receipt_id, p_expected_receipt_version, p_expected_invite_generation,
    p_reissue_request_id, p_reason
  );
  RAISE EXCEPTION 'authorize_student_portal_invite_reissue was unexpectedly accepted (expected % / %)',
    p_sqlstate, p_message;
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> p_sqlstate OR SQLERRM <> p_message THEN RAISE; END IF;
END
$$;

GRANT EXECUTE ON FUNCTION
  pg_temp.p185_expect_prepare_denied(UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, UUID, TEXT, TEXT),
  pg_temp.p185_expect_reissue_denied(UUID, BIGINT, BIGINT, UUID, TEXT, TEXT, TEXT)
  TO authenticated, service_role;

SELECT 'P185_CABINET_INVITES_SUITE_START' AS p185_suite_marker;

-- ---------------------------------------------------------------------------
-- Seed: organization; admin membership; TWO sales memberships (A and B); one
-- curator membership (needed only for the legacy_pending/normal_u6 negative
-- fixtures below).
-- ---------------------------------------------------------------------------
INSERT INTO platform.organizations (id, name)
VALUES (pg_temp.p185_id(1), 'Migration 185 synthetic organization');

-- The canonical organization scope row -- required by
-- assign_organization_scope_authorized_e1 (finalize's shared bind branch
-- assigns it to the newly provisioned Student membership), independent of
-- any staff membership's OWN scope assignment.
INSERT INTO platform.record_scopes (id, organization_id, scope_kind, scope_key, scope_version)
VALUES (pg_temp.p185_id(2), pg_temp.p185_id(1), 'organization', pg_temp.p185_id(1), 1);

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  (pg_temp.p185_id(101), 'p185-admin@example.invalid', '{}'::JSONB),
  (pg_temp.p185_id(102), 'p185-sales-a@example.invalid', '{}'::JSONB),
  (pg_temp.p185_id(103), 'p185-sales-b@example.invalid', '{}'::JSONB),
  (pg_temp.p185_id(104), 'p185-curator@example.invalid', '{}'::JSONB);

INSERT INTO platform.profiles (id, auth_user_id, display_name, status, access_version)
VALUES
  (pg_temp.p185_id(201), pg_temp.p185_id(101), 'P185 Admin', 'active', 1),
  (pg_temp.p185_id(202), pg_temp.p185_id(102), 'P185 Sales A', 'active', 1),
  (pg_temp.p185_id(203), pg_temp.p185_id(103), 'P185 Sales B', 'active', 1),
  (pg_temp.p185_id(204), pg_temp.p185_id(104), 'P185 Curator', 'active', 1);

INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status, "current_role", current_bundle_id,
  is_system_admin
) VALUES
  (
    pg_temp.p185_id(301), pg_temp.p185_id(1), pg_temp.p185_id(201), 'active',
    'admin',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'admin' AND status = 'published' ORDER BY version DESC LIMIT 1),
    TRUE
  ),
  (
    pg_temp.p185_id(302), pg_temp.p185_id(1), pg_temp.p185_id(202), 'active',
    'sales',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'sales' AND status = 'published' ORDER BY version DESC LIMIT 1),
    FALSE
  ),
  (
    pg_temp.p185_id(303), pg_temp.p185_id(1), pg_temp.p185_id(203), 'active',
    'sales',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'sales' AND status = 'published' ORDER BY version DESC LIMIT 1),
    FALSE
  ),
  (
    pg_temp.p185_id(304), pg_temp.p185_id(1), pg_temp.p185_id(204), 'active',
    'curator',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'curator' AND status = 'published' ORDER BY version DESC LIMIT 1),
    FALSE
  );

-- Live JWT claims via the CURRENT production hook -- never hand-built, so a
-- future claims-shape change fails this suite instead of silently drifting.
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p185_id(101),
  'claims', jsonb_build_object('sub', pg_temp.p185_id(101), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p185_admin_claims
\gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p185_id(102),
  'claims', jsonb_build_object('sub', pg_temp.p185_id(102), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p185_sales_a_claims
\gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p185_id(103),
  'claims', jsonb_build_object('sub', pg_temp.p185_id(103), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p185_sales_b_claims
\gset

-- ---------------------------------------------------------------------------
-- Grant the Sales role bundle: ONE staff_role_definitions/role_bundle_versions
-- pair publishing 'lead.sales.workflow.manage', assigned to BOTH Sales
-- memberships with scope_kind='own' -- the ordinary, resource-scoped shape
-- 173's shared bundles use (155's staff_role_command/publish/assignments_save
-- RPC surface, exercised exactly as platform_current_actor_authority.sql and
-- platform_document_export_artifacts.sql do it). 'own' means "the lead I
-- own", not "any lead in the org" -- this is what makes the Sales-B negative
-- boundary below a genuine resource-scope proof, not just a missing-grant one.
SET request.jwt.claims TO :'p185_admin_claims';
SET ROLE authenticated;

SELECT platform.staff_role_command(
  pg_temp.p185_id(1), pg_temp.p185_id(401), 0, 'create',
  jsonb_build_object(
    'label', 'P185 Sales lead workflow',
    'description', 'Migration 185 synthetic Sales lead-workflow role',
    'permissionKeys', jsonb_build_array('lead.sales.workflow.manage')
  ),
  'P185 create Sales lead-workflow role', pg_temp.p185_id(411)
) AS p185_role_created
\gset
SELECT pg_temp.p185_assert(
  :'p185_role_created'::JSONB = jsonb_build_object(
    'status', 'applied', 'roleId', pg_temp.p185_id(401), 'version', 1
  ),
  'staff role creation did not apply as expected'
);

SELECT platform.staff_role_impact(pg_temp.p185_id(1), pg_temp.p185_id(401), 1)
  ->> 'impactFingerprint' AS p185_role_impact_fingerprint
\gset

SELECT platform.staff_role_publish(
  pg_temp.p185_id(1), pg_temp.p185_id(401), 1,
  :'p185_role_impact_fingerprint', 'P185 publish Sales lead-workflow role',
  pg_temp.p185_id(412)
) AS p185_role_published
\gset
SELECT (:'p185_role_published'::JSONB ->> 'bundleId') AS p185_role_bundle_id
\gset
SELECT pg_temp.p185_assert(
  :'p185_role_published'::JSONB - 'bundleId' = jsonb_build_object(
    'status', 'applied', 'roleId', pg_temp.p185_id(401), 'version', 2,
    'bundleVersion', 1, 'affectedMembershipIds', '[]'::JSONB
  ) AND (:'p185_role_bundle_id')::UUID IS NOT NULL,
  'staff role publish did not apply as expected'
);

SELECT platform.staff_role_assignments_save(
  pg_temp.p185_id(1), pg_temp.p185_id(302), 1,
  jsonb_build_array(jsonb_build_object(
    'roleId', pg_temp.p185_id(401),
    'scope', jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)
  )),
  jsonb_build_array(jsonb_build_object(
    'roleId', pg_temp.p185_id(401), 'roleVersion', 2,
    'bundleId', :'p185_role_bundle_id'::UUID, 'bundleVersion', 1
  )),
  'P185 grant Sales A lead workflow access', pg_temp.p185_id(413)
) = jsonb_build_object(
  'status', 'applied', 'membershipId', pg_temp.p185_id(302), 'accessVersion', 2
) AS p185_sales_a_granted
\gset
SELECT platform.staff_role_assignments_save(
  pg_temp.p185_id(1), pg_temp.p185_id(303), 1,
  jsonb_build_array(jsonb_build_object(
    'roleId', pg_temp.p185_id(401),
    'scope', jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)
  )),
  jsonb_build_array(jsonb_build_object(
    'roleId', pg_temp.p185_id(401), 'roleVersion', 2,
    'bundleId', :'p185_role_bundle_id'::UUID, 'bundleVersion', 1
  )),
  'P185 grant Sales B lead workflow access', pg_temp.p185_id(414)
) = jsonb_build_object(
  'status', 'applied', 'membershipId', pg_temp.p185_id(303), 'accessVersion', 2
) AS p185_sales_b_granted
\gset
RESET ROLE;

SELECT pg_temp.p185_assert(
  :'p185_sales_a_granted'::BOOLEAN AND :'p185_sales_b_granted'::BOOLEAN,
  'Sales A/B did not both receive the own-scoped lead.sales.workflow.manage grant'
);

-- ---------------------------------------------------------------------------
-- Canonical client+lead owned by Sales A (TWO pairs: one for the primary
-- finalize/S1 flow, one for the reissue-authorize positive flow -- 184's
-- one-card-per-client rule is client-scoped, so a second cabinet needs a
-- second client). One more pair owned by Sales B is unnecessary: the negative
-- boundary below targets Sales A's OWN case, proving resource-scoping rather
-- than a bare missing-grant.
-- ---------------------------------------------------------------------------
INSERT INTO platform.clients (id, organization_id, display_name, normalized_name)
VALUES
  (
    pg_temp.p185_id(501), pg_temp.p185_id(1), 'P185 Cabinet Client A1',
    platform_private.normalize_person_name('P185 Cabinet Client A1')
  ),
  (
    pg_temp.p185_id(503), pg_temp.p185_id(1), 'P185 Cabinet Client A2',
    platform_private.normalize_person_name('P185 Cabinet Client A2')
  );
INSERT INTO platform.leads (
  id, organization_id, client_id, current_owner_membership_id, stage_key, source_key
) VALUES
  (pg_temp.p185_id(502), pg_temp.p185_id(1), pg_temp.p185_id(501), pg_temp.p185_id(302), 'new', 'website'),
  (pg_temp.p185_id(504), pg_temp.p185_id(1), pg_temp.p185_id(503), pg_temp.p185_id(302), 'new', 'website');

-- ---------------------------------------------------------------------------
-- A normal_u6-shaped ACTIVE case (curator + handoff) -- exists ONLY so an
-- Admin can prepare an ordinary receipt on it, which Sales A then attempts to
-- reissue-authorize (negative). A docs-intake-shaped PENDING case -- ordinary
-- Sales-owned intake, NOT a lead-cabinet origin -- proves the origin check,
-- not just an actor check, gates cabinet_pending.
-- ---------------------------------------------------------------------------
INSERT INTO platform.record_scopes (id, organization_id, scope_kind, scope_key, scope_version)
VALUES
  (pg_temp.p185_id(602), pg_temp.p185_id(1), 'student_case', pg_temp.p185_id(601), 1),
  (pg_temp.p185_id(702), pg_temp.p185_id(1), 'student_case', pg_temp.p185_id(701), 1);

-- 042's student_cases_transition_guard trigger requires a NEW case to start
-- pending/curator-less on scope version 1. This fixture needs to already be
-- active with a curator+handoff -- the same insert-time bypass the 126 suite
-- itself uses (every table constraint still applies; only that one BEFORE
-- INSERT/UPDATE trigger is skipped).
SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases (
  id, organization_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, program_direction,
  state, handoff_at, current_scope_id, current_scope_version
) VALUES (
  pg_temp.p185_id(601), pg_temp.p185_id(1), pg_temp.p185_id(302), pg_temp.p185_id(304),
  'synthetic:p185:legacy-active', 'P185 Legacy Active Student', 'United Kingdom', 'Bachelor',
  'Business', 'active', statement_timestamp(), pg_temp.p185_id(602), 1
);
SET LOCAL session_replication_role = origin;
INSERT INTO platform.student_cases (
  id, organization_id, responsible_sales_membership_id,
  source_key, student_display_name, target_country, target_degree, program_direction,
  state, current_scope_id, current_scope_version
) VALUES (
  pg_temp.p185_id(701), pg_temp.p185_id(1), pg_temp.p185_id(302),
  'docs-intake:' || pg_temp.p185_id(701)::TEXT, 'P185 Docs Intake Student', 'Canada', 'Master',
  'Engineering', 'pending', pg_temp.p185_id(702), 1
);

-- ===========================================================================
-- NEGATIVE: admin-only preserved -- a Sales actor cannot prepare normal_u6 or
-- legacy_pending for ANY case, cabinet-shaped or not. Both checks fail inside
-- prepare's PRE-LOCK preflight, before the target case is even read, so the
-- target case id need not exist or match either shape.
-- ===========================================================================
SET request.jwt.claims TO :'p185_sales_a_claims';
SET ROLE authenticated;

DO $p185_sales_normal_u6_denied$
BEGIN
  PERFORM platform.prepare_student_portal_provisioning(
    pg_temp.p185_id(1), pg_temp.p185_id(601),
    'p185-denied-normal@example.invalid', 'P185 Denied Normal Student',
    'normal_u6', NULL,
    'P185 Sales normal_u6 denial', pg_temp.p185_id(801)
  );
  RAISE EXCEPTION 'Sales normal_u6 preparation was accepted';
EXCEPTION WHEN SQLSTATE '42501' THEN
  IF SQLERRM <> 'System Admin is required' THEN RAISE; END IF;
END
$p185_sales_normal_u6_denied$;

DO $p185_sales_legacy_pending_denied$
BEGIN
  PERFORM platform.prepare_student_portal_provisioning(
    pg_temp.p185_id(1), pg_temp.p185_id(601),
    'p185-denied-legacy@example.invalid', 'P185 Denied Legacy Student',
    'legacy_pending', pg_temp.p185_id(302),
    'P185 Sales legacy_pending denial', pg_temp.p185_id(802)
  );
  RAISE EXCEPTION 'Sales legacy_pending preparation was accepted';
EXCEPTION WHEN SQLSTATE '42501' THEN
  IF SQLERRM <> 'System Admin is required' THEN RAISE; END IF;
END
$p185_sales_legacy_pending_denied$;

RESET ROLE;

-- ===========================================================================
-- NEGATIVE: origin-check refusal -- an Admin (full authority otherwise)
-- cannot prepare cabinet_pending against a PENDING case that is not a genuine
-- 184 lead-cabinet origin (no 'lead-cabinet:%' source_key / canonical_lead_id).
-- resolve_student_portal_cabinet_lead_e1 resolves NULL for this case, so the
-- live-actor preflight fails closed on p_lead_id IS NULL before any actor
-- check runs -- proving the origin gate, not merely an authority gate.
-- ===========================================================================
SET request.jwt.claims TO :'p185_admin_claims';
SET ROLE authenticated;

DO $p185_admin_noncabinet_origin_denied$
BEGIN
  PERFORM platform.prepare_student_portal_provisioning(
    pg_temp.p185_id(1), pg_temp.p185_id(701),
    'p185-denied-origin@example.invalid', 'P185 Denied Origin Student',
    'cabinet_pending', NULL,
    'P185 Admin non-cabinet origin denial', pg_temp.p185_id(803)
  );
  RAISE EXCEPTION 'Admin cabinet_pending preparation against a non-cabinet case was accepted';
EXCEPTION WHEN SQLSTATE '40001' THEN
  IF SQLERRM <> 'portal_case_invalid_shape' THEN RAISE; END IF;
END
$p185_admin_noncabinet_origin_denied$;

RESET ROLE;

-- ===========================================================================
-- POSITIVE (a): Sales A prepares a genuine lead cabinet for her own lead --
-- pending, curator-less, portal-inactive (184's own shape).
-- ===========================================================================
SET request.jwt.claims TO :'p185_sales_a_claims';
SET ROLE authenticated;

SELECT platform.prepare_lead_cabinet_v1(
  pg_temp.p185_id(1), pg_temp.p185_id(808), pg_temp.p185_id(502)
)::TEXT AS p185_cabinet_one_prepared
\gset
SELECT (:'p185_cabinet_one_prepared'::JSONB ->> 'student_case_id')::UUID
  AS p185_case_one
\gset

RESET ROLE;

SELECT pg_temp.p185_assert(
  (
    SELECT student_case.state = 'pending'
      AND student_case.current_curator_membership_id IS NULL
      AND student_case.handoff_at IS NULL
      AND student_case.portal_activated_at IS NULL
      AND student_case.closed_at IS NULL
      AND student_case.student_membership_id IS NULL
      AND student_case.source_key = 'lead-cabinet:' || pg_temp.p185_id(502)::TEXT
      AND student_case.canonical_lead_id = pg_temp.p185_id(502)
      AND student_case.canonical_client_id = pg_temp.p185_id(501)
    FROM platform.student_cases AS student_case
    WHERE student_case.id = :'p185_case_one'
  ),
  'prepare_lead_cabinet_v1 did not create the expected curator-less pending cabinet case'
);

-- ===========================================================================
-- POSITIVE (b): Sales A prepares a cabinet_pending receipt for that case.
-- required_permission_keys is ARRAY['lead.sales.workflow.manage'] ONLY --
-- never membership.provision/scope.manage, which Sales can never hold
-- (staff_system_only). legacy_curator_membership_id stays NULL.
-- ===========================================================================
SET request.jwt.claims TO :'p185_sales_a_claims';
SET ROLE authenticated;

SELECT platform.prepare_student_portal_provisioning(
  pg_temp.p185_id(1), :'p185_case_one', 'p185-cabinet-a1@example.invalid',
  'P185 Cabinet Student A1', 'cabinet_pending', NULL,
  'P185 Sales A cabinet_pending preparation', pg_temp.p185_id(804)
)::TEXT AS p185_case_one_prepared
\gset
SELECT (:'p185_case_one_prepared'::JSONB ->> 'receipt_id')::UUID
  AS p185_case_one_receipt
\gset

SELECT pg_temp.p185_assert(
  :'p185_case_one_prepared'::JSONB ->> 'case_shape' = 'cabinet_pending'
  AND :'p185_case_one_prepared'::JSONB ->> 'provisioning_state' = 'prepared'
  AND :'p185_case_one_prepared'::JSONB ->> 'receipt_version' = '1'
  AND :'p185_case_one_prepared'::JSONB ->> 'invite_generation' = '0'
  AND :'p185_case_one_prepared'::JSONB ->> 'replayed' = 'false'
  AND NOT (:'p185_case_one_prepared'::JSONB ? 'normalized_email'),
  'Sales A cabinet_pending preparation did not create the expected receipt'
);
-- Same-request replay stays idempotent, same as every other case_shape.
SELECT platform.prepare_student_portal_provisioning(
  pg_temp.p185_id(1), :'p185_case_one', 'p185-cabinet-a1@example.invalid',
  'P185 Cabinet Student A1', 'cabinet_pending', NULL,
  'P185 Sales A cabinet_pending preparation', pg_temp.p185_id(804)
)::TEXT AS p185_case_one_prepare_replay
\gset
SELECT pg_temp.p185_assert(
  :'p185_case_one_prepare_replay'::JSONB ->> 'replayed' = 'true'
  AND :'p185_case_one_prepare_replay'::JSONB ->> 'receipt_id' = :'p185_case_one_receipt'::TEXT,
  'same-request cabinet_pending prepare did not replay the durable result'
);

RESET ROLE;

-- platform_private has no direct grant to authenticated/service_role (only
-- SECURITY DEFINER functions may read it) -- this row-level receipt check
-- runs as the default (table-owning) connection, same as every such check
-- throughout this suite and in 126's own.
SELECT pg_temp.p185_assert(
  (
    SELECT receipt.legacy_curator_membership_id IS NULL
      AND receipt.required_permission_keys = ARRAY['lead.sales.workflow.manage']::TEXT[]
      AND receipt.case_shape = 'cabinet_pending'
      AND receipt.authorizing_membership_id = pg_temp.p185_id(302)
    FROM platform_private.student_portal_provisioning_receipts AS receipt
    WHERE receipt.id = :'p185_case_one_receipt'
  ),
  'cabinet_pending receipt row did not carry legacy_curator NULL / the cabinet permission array'
);

-- ===========================================================================
-- NEGATIVE: Sales B (no access to Sales A's lead) cannot prepare cabinet_pending
-- for case one. Sales B holds the SAME own-scoped lead.sales.workflow.manage
-- grant as Sales A -- proving the boundary is resource-scoped ownership of
-- THIS lead, not a bare missing permission.
-- ===========================================================================
SET request.jwt.claims TO :'p185_sales_b_claims';
SET ROLE authenticated;

SELECT pg_temp.p185_expect_prepare_denied(
  pg_temp.p185_id(1), :'p185_case_one', 'p185-denied-sales-b@example.invalid',
  'P185 Denied Sales B Student', 'cabinet_pending', NULL,
  'P185 Sales B no-access denial', pg_temp.p185_id(805),
  '42501', 'portal_admin_authority_changed'
);

RESET ROLE;

-- ===========================================================================
-- Admin prepares an ordinary normal_u6 receipt on the legacy active case, so
-- Sales A can be shown refused reissue-authorize access to it below.
-- ===========================================================================
SET request.jwt.claims TO :'p185_admin_claims';
SET ROLE authenticated;

SELECT platform.prepare_student_portal_provisioning(
  pg_temp.p185_id(1), pg_temp.p185_id(601), 'p185-legacy-active@example.invalid',
  'P185 Legacy Active Student', 'normal_u6', NULL,
  'P185 Admin normal_u6 preparation', pg_temp.p185_id(806)
)::TEXT AS p185_legacy_prepared
\gset
SELECT (:'p185_legacy_prepared'::JSONB ->> 'receipt_id')::UUID
  AS p185_legacy_receipt
\gset
SELECT pg_temp.p185_assert(
  :'p185_legacy_prepared'::JSONB ->> 'case_shape' = 'normal_u6'
  AND :'p185_legacy_prepared'::JSONB ->> 'provisioning_state' = 'prepared',
  'Admin normal_u6 preparation on the legacy active case did not succeed'
);

RESET ROLE;

-- ===========================================================================
-- NEGATIVE: Sales A cannot reissue-authorize a LEGACY (non-cabinet) receipt --
-- authorize_student_portal_invite_reissue's non-cabinet branch is still
-- require_admin_actor, admin-only regardless of which key is checked.
-- ===========================================================================
SET request.jwt.claims TO :'p185_sales_a_claims';
SET ROLE authenticated;

SELECT pg_temp.p185_expect_reissue_denied(
  :'p185_legacy_receipt', 1, 0, pg_temp.p185_id(807),
  'P185 Sales A legacy reissue denial',
  '42501', 'System Admin is required'
);

RESET ROLE;

-- ===========================================================================
-- POSITIVE: Sales A reissue-authorizes her OWN expired cabinet invite. A
-- second cabinet case (case two, a distinct client/lead so 184's one-card
-- rule does not collide with case one) is prepared, claimed and marked
-- invite-succeeded with an already-expired TTL (confirmation_sent_at three
-- hours ago, a one-hour TTL), so the expiry gate is met by real elapsed time
-- rather than a backdating UPDATE.
-- ===========================================================================
SET request.jwt.claims TO :'p185_sales_a_claims';
SET ROLE authenticated;

SELECT platform.prepare_lead_cabinet_v1(
  pg_temp.p185_id(1), pg_temp.p185_id(809), pg_temp.p185_id(504)
)::TEXT AS p185_cabinet_two_prepared
\gset
SELECT (:'p185_cabinet_two_prepared'::JSONB ->> 'student_case_id')::UUID
  AS p185_case_two
\gset

SELECT platform.prepare_student_portal_provisioning(
  pg_temp.p185_id(1), :'p185_case_two', 'p185-cabinet-a2@example.invalid',
  'P185 Cabinet Student A2', 'cabinet_pending', NULL,
  'P185 Sales A cabinet_pending preparation (reissue case)', pg_temp.p185_id(810)
)::TEXT AS p185_case_two_prepared
\gset
SELECT (:'p185_case_two_prepared'::JSONB ->> 'receipt_id')::UUID
  AS p185_case_two_receipt
\gset

RESET ROLE;
SET ROLE service_role;

SELECT platform.claim_student_portal_invite(
  :'p185_case_two_receipt', pg_temp.p185_id(852), 1, 0
)::TEXT AS p185_case_two_claimed
\gset
SELECT pg_temp.p185_assert(
  :'p185_case_two_claimed'::JSONB ->> 'provisioning_state' = 'dispatching'
  AND :'p185_case_two_claimed'::JSONB ->> 'receipt_version' = '2'
  AND :'p185_case_two_claimed'::JSONB ->> 'invite_generation' = '1',
  'case two invite claim did not return its fenced dispatch envelope'
);

RESET ROLE;
INSERT INTO auth.users (id, email, raw_user_meta_data, confirmation_sent_at)
VALUES (
  pg_temp.p185_id(920), 'p185-cabinet-a2@example.invalid', '{}'::JSONB,
  statement_timestamp() - INTERVAL '3 hours'
);
SET ROLE service_role;

SELECT platform.record_student_portal_invite_success(
  :'p185_case_two_receipt', pg_temp.p185_id(852), 2, 1, pg_temp.p185_id(920), 3600
)::TEXT AS p185_case_two_succeeded
\gset
SELECT pg_temp.p185_assert(
  :'p185_case_two_succeeded'::JSONB ->> 'provisioning_state' = 'invite_succeeded'
  AND :'p185_case_two_succeeded'::JSONB ->> 'invite_delivery_status' = 'issued'
  AND :'p185_case_two_succeeded'::JSONB ->> 'receipt_version' = '3',
  'case two invite success did not advance the fenced receipt as expected'
);

RESET ROLE;

-- platform_private has no direct grant to authenticated/service_role.
SELECT pg_temp.p185_assert(
  (
    SELECT receipt.invite_expires_at < statement_timestamp()
    FROM platform_private.student_portal_provisioning_receipts AS receipt
    WHERE receipt.id = :'p185_case_two_receipt'
  ),
  'case two invite success did not leave an already-expired issued invite'
);

SET request.jwt.claims TO :'p185_sales_a_claims';
SET ROLE authenticated;

SELECT platform.authorize_student_portal_invite_reissue(
  :'p185_case_two_receipt', 3, 1, pg_temp.p185_id(811),
  'P185 Sales A cabinet reissue authorization'
)::TEXT AS p185_case_two_reissue_authorized
\gset
SELECT pg_temp.p185_assert(
  :'p185_case_two_reissue_authorized'::JSONB ->> 'case_shape' = 'cabinet_pending'
  AND :'p185_case_two_reissue_authorized'::JSONB ->> 'invite_delivery_status' = 'expired'
  AND :'p185_case_two_reissue_authorized'::JSONB ->> 'reissue_request_id' = pg_temp.p185_id(811)::TEXT
  AND :'p185_case_two_reissue_authorized'::JSONB ->> 'receipt_version' = '4',
  'Sales A reissue-authorize on her own cabinet receipt did not succeed as expected'
);

RESET ROLE;

-- platform_private has no direct grant to authenticated/service_role.
SELECT pg_temp.p185_assert(
  (
    SELECT receipt.reissue_authorized_by_membership_id = pg_temp.p185_id(302)
    FROM platform_private.student_portal_provisioning_receipts AS receipt
    WHERE receipt.id = :'p185_case_two_receipt'
  ),
  'Sales A cabinet reissue-authorize did not record her own membership as the authorizer'
);

-- ===========================================================================
-- FINALIZE (d): simulate the invited auth user accepting -- claim, insert the
-- invited Auth row, record invite success, then the service-role finalize
-- call, mirroring the 126 suite's own baseline (non-reissue) acceptance flow.
-- ===========================================================================
SET request.jwt.claims TO :'p185_sales_a_claims';
SET ROLE authenticated;
-- (case one's receipt is already prepared -- :'p185_case_one_receipt')
RESET ROLE;

SET ROLE service_role;
SELECT platform.claim_student_portal_invite(
  :'p185_case_one_receipt', pg_temp.p185_id(851), 1, 0
)::TEXT AS p185_case_one_claimed
\gset
SELECT pg_temp.p185_assert(
  :'p185_case_one_claimed'::JSONB ->> 'provisioning_state' = 'dispatching'
  AND :'p185_case_one_claimed'::JSONB ->> 'receipt_version' = '2'
  AND :'p185_case_one_claimed'::JSONB ->> 'invite_generation' = '1',
  'case one invite claim did not return its fenced dispatch envelope'
);
RESET ROLE;

INSERT INTO auth.users (id, email, raw_user_meta_data, confirmation_sent_at)
VALUES (
  pg_temp.p185_id(910), 'p185-cabinet-a1@example.invalid', '{}'::JSONB,
  statement_timestamp()
);

SET ROLE service_role;
SELECT platform.record_student_portal_invite_success(
  :'p185_case_one_receipt', pg_temp.p185_id(851), 2, 1, pg_temp.p185_id(910), 3600
)::TEXT AS p185_case_one_succeeded
\gset
SELECT pg_temp.p185_assert(
  :'p185_case_one_succeeded'::JSONB ->> 'provisioning_state' = 'invite_succeeded'
  AND :'p185_case_one_succeeded'::JSONB ->> 'receipt_version' = '3',
  'case one invite success did not advance the fenced receipt'
);

SELECT platform.finalize_student_portal_authority(
  :'p185_case_one_receipt', 3, 1
)::TEXT AS p185_case_one_finalized
\gset
SELECT (:'p185_case_one_finalized'::JSONB ->> 'student_membership_id')::UUID
  AS p185_case_one_student_membership
\gset
RESET ROLE;

SELECT pg_temp.p185_assert(
  :'p185_case_one_finalized'::JSONB ->> 'provisioning_state' = 'authority_activated'
  AND :'p185_case_one_finalized'::JSONB ->> 'authority_activated' = 'true'
  AND :'p185_case_one_finalized'::JSONB ->> 'case_shape' = 'cabinet_pending'
  AND :'p185_case_one_finalized'::JSONB ->> 'replayed' = 'false',
  'finalize did not activate cabinet_pending Student authority'
);

-- AFTER: state unchanged (still pending), no curator, no handoff -- ONLY
-- portal_activated_at and student_membership_id move (plan §4: approving
-- access never creates a handoff or assigns a curator).
SELECT pg_temp.p185_assert(
  (
    SELECT student_case.state = 'pending'
      AND student_case.current_curator_membership_id IS NULL
      AND student_case.handoff_at IS NULL
      AND student_case.closed_at IS NULL
      AND student_case.portal_activated_at IS NOT NULL
      AND student_case.student_membership_id = :'p185_case_one_student_membership'
    FROM platform.student_cases AS student_case
    WHERE student_case.id = :'p185_case_one'
  ),
  'finalize left the cabinet case state/curator/handoff shape changed, or did not bind/activate it'
);
SELECT pg_temp.p185_assert(
  (
    SELECT pg_catalog.count(*) = 1
    FROM platform.audit_events
    WHERE action = 'student.portal.authority.activate'
      AND resource_id = :'p185_case_one'
  ),
  'finalize did not emit exactly one activation audit event for the cabinet case'
);

-- S1: platform.student_portal_cases() resolves the now-bound PENDING case for
-- the student -- 180's pending-portal relaxation exercised end to end.
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p185_id(910),
  'claims', jsonb_build_object('sub', pg_temp.p185_id(910), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p185_case_one_student_claims
\gset

SET request.jwt.claims TO :'p185_case_one_student_claims';
SET ROLE authenticated;
SELECT pg_temp.p185_assert(
  EXISTS (
    SELECT 1 FROM platform.student_portal_cases() AS portal
    WHERE portal.case_id = :'p185_case_one'
      AND portal.case_state = 'pending'
      AND portal.portal_activated_at IS NOT NULL
  ),
  'student_portal_cases() did not resolve the bound pending cabinet case (S1 pending predicate)'
);
RESET ROLE;

-- ===========================================================================
-- RE-ENTRY / IDEMPOTENCY (e): a replayed finalize stays a durable replay; a
-- second prepare for the now-bound case fails closed.
-- ===========================================================================
SET ROLE service_role;
SELECT platform.finalize_student_portal_authority(
  :'p185_case_one_receipt', 3, 1
)::TEXT AS p185_case_one_finalize_replay
\gset
RESET ROLE;
SELECT pg_temp.p185_assert(
  :'p185_case_one_finalize_replay'::JSONB ->> 'replayed' = 'true'
  AND :'p185_case_one_finalize_replay'::JSONB ->> 'student_membership_id'
    = :'p185_case_one_finalized'::JSONB ->> 'student_membership_id',
  'same receipt/generation finalize replay was not durable'
);

SET request.jwt.claims TO :'p185_sales_a_claims';
SET ROLE authenticated;
SELECT pg_temp.p185_expect_prepare_denied(
  pg_temp.p185_id(1), :'p185_case_one', 'p185-reentry@example.invalid',
  'P185 Reentry Student', 'cabinet_pending', NULL,
  'P185 second prepare on an already-bound cabinet case', pg_temp.p185_id(812),
  '40001', 'portal_case_already_bound'
);
RESET ROLE;

SELECT 'P185_CABINET_INVITES_SUITE_PASSED' AS p185_suite_marker;

ROLLBACK;
