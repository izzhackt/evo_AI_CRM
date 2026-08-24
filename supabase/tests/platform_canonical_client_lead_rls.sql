\set ON_ERROR_STOP on

-- Real PostgreSQL U2 identity, duplicate, resolution and role-scope proof.
-- All rows are synthetic, transaction-local and use reserved example.invalid
-- identities. No provider or managed environment is contacted.
BEGIN;

\set u2_org_a '84000000-0000-4000-8000-000000000001'
\set u2_org_b '84000000-0000-4000-8000-000000000002'
\set u2_org_scope_a '84000000-0000-4000-8000-000000000003'
\set u2_org_scope_b '84000000-0000-4000-8000-000000000004'
\set u2_case_id '84000000-0000-4000-8000-000000000005'
\set u2_case_scope '84000000-0000-4000-8000-000000000006'

\set u2_admin_user '84000000-0000-4000-8000-000000000101'
\set u2_sales_user '84000000-0000-4000-8000-000000000102'
\set u2_sales_two_user '84000000-0000-4000-8000-000000000103'
\set u2_curator_user '84000000-0000-4000-8000-000000000104'
\set u2_student_user '84000000-0000-4000-8000-000000000105'
\set u2_blocked_user '84000000-0000-4000-8000-000000000106'
\set u2_inactive_user '84000000-0000-4000-8000-000000000107'
\set u2_suspended_user '84000000-0000-4000-8000-000000000108'
\set u2_admin_b_user '84000000-0000-4000-8000-000000000109'
\set u2_no_membership_user '84000000-0000-4000-8000-000000000110'

\set u2_admin_profile '84000000-0000-4000-8000-000000000201'
\set u2_sales_profile '84000000-0000-4000-8000-000000000202'
\set u2_sales_two_profile '84000000-0000-4000-8000-000000000203'
\set u2_curator_profile '84000000-0000-4000-8000-000000000204'
\set u2_student_profile '84000000-0000-4000-8000-000000000205'
\set u2_blocked_profile '84000000-0000-4000-8000-000000000206'
\set u2_inactive_profile '84000000-0000-4000-8000-000000000207'
\set u2_suspended_profile '84000000-0000-4000-8000-000000000208'
\set u2_admin_b_profile '84000000-0000-4000-8000-000000000209'

\set u2_admin_membership '84000000-0000-4000-8000-000000000301'
\set u2_sales_membership '84000000-0000-4000-8000-000000000302'
\set u2_sales_two_membership '84000000-0000-4000-8000-000000000303'
\set u2_curator_membership '84000000-0000-4000-8000-000000000304'
\set u2_student_membership '84000000-0000-4000-8000-000000000305'
\set u2_blocked_membership '84000000-0000-4000-8000-000000000306'
\set u2_inactive_membership '84000000-0000-4000-8000-000000000307'
\set u2_suspended_membership '84000000-0000-4000-8000-000000000308'
\set u2_admin_b_membership '84000000-0000-4000-8000-000000000309'

INSERT INTO platform.organizations (id, name)
VALUES
  (:'u2_org_a', 'U2 Organization A'),
  (:'u2_org_b', 'U2 Organization B');

INSERT INTO platform.record_scopes (
  id, organization_id, scope_kind, scope_key, scope_version
) VALUES
  (:'u2_org_scope_a', :'u2_org_a', 'organization', :'u2_org_a', 1),
  (:'u2_org_scope_b', :'u2_org_b', 'organization', :'u2_org_b', 1),
  (:'u2_case_scope', :'u2_org_a', 'student_case', :'u2_case_id', 1);

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  (:'u2_admin_user', 'u2-admin@example.invalid', '{}'),
  (:'u2_sales_user', 'u2-sales@example.invalid', '{}'),
  (:'u2_sales_two_user', 'u2-sales-two@example.invalid', '{}'),
  (:'u2_curator_user', 'u2-curator@example.invalid', '{}'),
  (:'u2_student_user', 'u2-student@example.invalid', '{}'),
  (:'u2_blocked_user', 'u2-blocked@example.invalid', '{}'),
  (:'u2_inactive_user', 'u2-inactive@example.invalid', '{}'),
  (:'u2_suspended_user', 'u2-suspended@example.invalid', '{}'),
  (:'u2_admin_b_user', 'u2-admin-b@example.invalid', '{}'),
  (:'u2_no_membership_user', 'u2-no-membership@example.invalid', '{}');

INSERT INTO platform.profiles (
  id, auth_user_id, display_name, status, access_version
) VALUES
  (:'u2_admin_profile', :'u2_admin_user', 'U2 Admin', 'active', 1),
  (:'u2_sales_profile', :'u2_sales_user', 'U2 Sales', 'active', 1),
  (
    :'u2_sales_two_profile', :'u2_sales_two_user',
    'U2 Sales Two', 'active', 1
  ),
  (
    :'u2_curator_profile', :'u2_curator_user',
    'U2 Curator', 'active', 1
  ),
  (
    :'u2_student_profile', :'u2_student_user',
    'U2 Student', 'active', 1
  ),
  (
    :'u2_blocked_profile', :'u2_blocked_user',
    'U2 Blocked', 'blocked', 1
  ),
  (
    :'u2_inactive_profile', :'u2_inactive_user',
    'U2 Inactive', 'active', 1
  ),
  (
    :'u2_suspended_profile', :'u2_suspended_user',
    'U2 Suspended', 'active', 1
  ),
  (
    :'u2_admin_b_profile', :'u2_admin_b_user',
    'U2 Admin B', 'active', 1
  );

INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status, "current_role", current_bundle_id
) VALUES
  (
    :'u2_admin_membership', :'u2_org_a', :'u2_admin_profile',
    'active', 'admin', '00000000-0000-4000-8000-000000001101'
  ),
  (
    :'u2_sales_membership', :'u2_org_a', :'u2_sales_profile',
    'active', 'sales', '00000000-0000-4000-8000-000000001102'
  ),
  (
    :'u2_sales_two_membership', :'u2_org_a', :'u2_sales_two_profile',
    'active', 'sales', '00000000-0000-4000-8000-000000001102'
  ),
  (
    :'u2_curator_membership', :'u2_org_a', :'u2_curator_profile',
    'active', 'curator', '00000000-0000-4000-8000-000000001103'
  ),
  (
    :'u2_student_membership', :'u2_org_a', :'u2_student_profile',
    'active', 'student', '00000000-0000-4000-8000-000000001105'
  ),
  (
    :'u2_blocked_membership', :'u2_org_a', :'u2_blocked_profile',
    'active', 'sales', '00000000-0000-4000-8000-000000001102'
  ),
  (
    :'u2_inactive_membership', :'u2_org_a', :'u2_inactive_profile',
    'inactive', 'sales', '00000000-0000-4000-8000-000000001102'
  ),
  (
    :'u2_suspended_membership', :'u2_org_a', :'u2_suspended_profile',
    'suspended', 'sales', '00000000-0000-4000-8000-000000001102'
  ),
  (
    :'u2_admin_b_membership', :'u2_org_b', :'u2_admin_b_profile',
    'active', 'admin', '00000000-0000-4000-8000-000000001101'
  );

INSERT INTO platform.membership_scope_assignments (
  id,
  organization_id,
  membership_id,
  scope_id,
  scope_version,
  assignment_version,
  granted,
  actor_kind,
  actor_profile_id,
  reason,
  request_id
)
SELECT
  fixture.event_id,
  fixture.organization_id,
  fixture.membership_id,
  fixture.scope_id,
  1,
  1,
  TRUE,
  'system',
  NULL,
  'U2 authorization fixture',
  fixture.request_id
FROM (VALUES
  (
    '84000000-0000-4000-8000-000000000401'::UUID,
    :'u2_org_a'::UUID, :'u2_admin_membership'::UUID,
    :'u2_org_scope_a'::UUID,
    '84000000-0000-4000-8000-000000000501'::UUID
  ),
  (
    '84000000-0000-4000-8000-000000000402'::UUID,
    :'u2_org_a'::UUID, :'u2_sales_membership'::UUID,
    :'u2_org_scope_a'::UUID,
    '84000000-0000-4000-8000-000000000502'::UUID
  ),
  (
    '84000000-0000-4000-8000-000000000403'::UUID,
    :'u2_org_a'::UUID, :'u2_sales_two_membership'::UUID,
    :'u2_org_scope_a'::UUID,
    '84000000-0000-4000-8000-000000000503'::UUID
  ),
  (
    '84000000-0000-4000-8000-000000000404'::UUID,
    :'u2_org_a'::UUID, :'u2_curator_membership'::UUID,
    :'u2_org_scope_a'::UUID,
    '84000000-0000-4000-8000-000000000504'::UUID
  ),
  (
    '84000000-0000-4000-8000-000000000405'::UUID,
    :'u2_org_a'::UUID, :'u2_student_membership'::UUID,
    :'u2_org_scope_a'::UUID,
    '84000000-0000-4000-8000-000000000505'::UUID
  ),
  (
    '84000000-0000-4000-8000-000000000406'::UUID,
    :'u2_org_b'::UUID, :'u2_admin_b_membership'::UUID,
    :'u2_org_scope_b'::UUID,
    '84000000-0000-4000-8000-000000000506'::UUID
  ),
  (
    '84000000-0000-4000-8000-000000000407'::UUID,
    :'u2_org_a'::UUID, :'u2_curator_membership'::UUID,
    :'u2_case_scope'::UUID,
    '84000000-0000-4000-8000-000000000507'::UUID
  )
) AS fixture(
  event_id, organization_id, membership_id, scope_id, request_id
);

SELECT platform_private.create_or_link_client(
  :'u2_org_a',
  '  Amina   Test  ',
  ' AMINA@EXAMPLE.INVALID ',
  '+996 (700) 111-222',
  'evo', 'client', 'u2-client-primary', 'manual_entry',
  '2026-08-24T08:00:00Z', '2026-08-24T08:01:00Z',
  'safe:u2-primary'
) AS u2_primary_client_id
\gset

SELECT platform_private.create_or_link_client(
  :'u2_org_a',
  'Amina Test',
  'amina@example.invalid',
  '+996700111222',
  'legacy', 'contact', 'u2-contact-primary', 'legacy_observation',
  '2026-08-24T08:02:00Z', '2026-08-24T08:03:00Z',
  'safe:u2-strong-retry'
) AS u2_strong_retry_client_id
\gset

SELECT platform_private.create_or_link_client(
  :'u2_org_a',
  'Amina Test',
  NULL,
  NULL,
  'evo', 'client', 'u2-client-ambiguous', 'manual_entry',
  '2026-08-24T08:04:00Z', NULL, 'safe:u2-ambiguous'
) AS u2_ambiguous_client_id
\gset

SELECT platform_private.create_or_link_client(
  :'u2_org_a',
  'Different Person',
  'different@example.invalid',
  '+996700333444',
  'evo', 'client', 'u2-client-different', 'manual_entry',
  '2026-08-24T08:05:00Z', NULL, 'safe:u2-different'
) AS u2_different_client_id
\gset

SELECT platform_private.create_or_link_lead(
  :'u2_org_a', :'u2_primary_client_id', :'u2_sales_membership',
  'new', 'manual',
  'evo', 'lead', 'u2-lead-primary', 'manual_entry',
  '2026-08-24T08:10:00Z', NULL, 'safe:u2-lead-primary'
) AS u2_primary_lead_id
\gset

SELECT platform_private.create_or_link_lead(
  :'u2_org_a', :'u2_primary_client_id', :'u2_sales_two_membership',
  'consultation', 'referral',
  'legacy', 'lead', 'u2-lead-second', 'legacy_observation',
  '2026-08-24T08:11:00Z', NULL, 'safe:u2-lead-second'
) AS u2_second_lead_id
\gset

SELECT platform_private.create_or_link_lead(
  :'u2_org_a', :'u2_ambiguous_client_id', :'u2_sales_membership',
  'new', 'manual',
  'evo', 'lead', 'u2-lead-ambiguous', 'manual_entry',
  '2026-08-24T08:12:00Z', NULL, 'safe:u2-lead-ambiguous'
) AS u2_ambiguous_lead_id
\gset

SELECT platform_private.create_or_link_lead(
  :'u2_org_a', :'u2_different_client_id', :'u2_sales_two_membership',
  'new', 'manual',
  'evo', 'lead', 'u2-lead-different', 'manual_entry',
  '2026-08-24T08:13:00Z', NULL, 'safe:u2-lead-different'
) AS u2_different_lead_id
\gset

SELECT platform_private.create_or_link_client(
  :'u2_org_b',
  'Other Organization Client',
  'other-org@example.invalid',
  '+996700999888',
  'evo', 'client', 'u2-other-org-client', 'manual_entry',
  '2026-08-24T08:20:00Z', NULL, 'safe:u2-other-org'
) AS u2_other_org_client_id
\gset

SELECT platform_private.create_or_link_lead(
  :'u2_org_b', :'u2_other_org_client_id', NULL,
  'new', 'manual',
  'evo', 'lead', 'u2-other-org-lead', 'manual_entry',
  '2026-08-24T08:21:00Z', NULL, 'safe:u2-other-org-lead'
) AS u2_other_org_lead_id
\gset

-- psql deliberately does not interpolate variables inside dollar-quoted
-- PL/pgSQL bodies. Carry fixture identifiers through transaction-local
-- settings so exception-path assertions exercise real server-side code.
SELECT set_config('u2_test.org_a', :'u2_org_a', true);
SELECT set_config(
  'u2_test.primary_client_id', :'u2_primary_client_id', true
);
SELECT set_config(
  'u2_test.strong_retry_client_id', :'u2_strong_retry_client_id', true
);
SELECT set_config(
  'u2_test.ambiguous_client_id', :'u2_ambiguous_client_id', true
);
SELECT set_config('u2_test.case_id', :'u2_case_id', true);
SELECT set_config(
  'u2_test.different_lead_id', :'u2_different_lead_id', true
);

DO $integrity$
DECLARE
  test_org_id UUID := current_setting('u2_test.org_a')::UUID;
  primary_client_id UUID :=
    current_setting('u2_test.primary_client_id')::UUID;
  strong_retry_client_id UUID :=
    current_setting('u2_test.strong_retry_client_id')::UUID;
  ambiguous_client_id UUID :=
    current_setting('u2_test.ambiguous_client_id')::UUID;
BEGIN
  IF primary_client_id <> strong_retry_client_id THEN
    RAISE EXCEPTION 'Exact strong retry created two canonical clients';
  END IF;

  IF (
    SELECT count(*)
    FROM platform.clients AS client
    WHERE client.organization_id = test_org_id
      AND client.normalized_email = 'amina@example.invalid'
      AND client.normalized_phone = '+996700111222'
      AND client.lifecycle_state = 'active'
  ) <> 1 THEN
    RAISE EXCEPTION 'Strong identity uniqueness did not retain one row';
  END IF;

  IF (
    SELECT count(*)
    FROM platform.leads AS lead
    WHERE lead.client_id = primary_client_id
  ) <> 2 THEN
    RAISE EXCEPTION 'One client did not retain valid multiple leads';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM platform_private.client_duplicate_candidates AS candidate
    WHERE candidate.organization_id = test_org_id
      AND candidate.status = 'open'
      AND primary_client_id IN (
        candidate.left_client_id,
        candidate.right_client_id
      )
      AND ambiguous_client_id IN (
        candidate.left_client_id,
        candidate.right_client_id
      )
  ) THEN
    RAISE EXCEPTION 'Ambiguous name-only identity did not create candidate';
  END IF;

  BEGIN
    PERFORM platform_private.create_or_link_client(
      test_org_id, 'Malformed', 'not-an-email', '12',
      'evo', 'client', 'u2-malformed', 'manual_entry',
      statement_timestamp(), NULL, 'safe:malformed'
    );
    RAISE EXCEPTION 'Malformed client was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  BEGIN
    PERFORM platform_private.create_or_link_client(
      test_org_id, 'Conflict', 'conflict@example.invalid',
      '+996700555666',
      'evo', 'client', 'u2-client-primary', 'manual_entry',
      statement_timestamp(), NULL, 'safe:conflict'
    );
    RAISE EXCEPTION 'Conflicting external client identity was accepted';
  EXCEPTION WHEN SQLSTATE '23505' THEN NULL;
  END;

  BEGIN
    UPDATE platform.external_identifiers
    SET source_ref = 'safe:mutated'
    WHERE external_identifier = 'u2-client-primary';
    RAISE EXCEPTION 'External identity evidence was mutable';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;

  BEGIN
    UPDATE platform.subject_provenance
    SET source_ref = 'safe:mutated'
    WHERE source_ref = 'safe:u2-primary';
    RAISE EXCEPTION 'Subject provenance was mutable';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;

END
$integrity$;

-- Insert one assigned active Student Case as a fixture. Existing historical
-- Student Case transition behavior has its own real suites; replica mode here
-- only avoids replaying that unrelated lifecycle while all FK/check/RLS
-- constraints and the U2 read path remain real PostgreSQL behavior.
SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases (
  id,
  organization_id,
  student_membership_id,
  responsible_sales_membership_id,
  current_curator_membership_id,
  source_key,
  contract_confirmation_ref,
  contract_confirmed_at,
  student_display_name,
  target_country,
  target_degree,
  route_approval_status,
  operational_stage,
  state,
  handoff_at,
  portal_activated_at,
  current_scope_id,
  current_scope_version,
  canonical_client_id,
  canonical_lead_id
) VALUES (
  :'u2_case_id',
  :'u2_org_a',
  :'u2_student_membership',
  :'u2_sales_membership',
  :'u2_curator_membership',
  'synthetic:u2:case',
  'synthetic:u2:contract',
  '2026-08-24T08:30:00Z',
  'Amina Test',
  'United Kingdom',
  'Bachelor',
  'approved',
  'admissions',
  'active',
  '2026-08-24T08:31:00Z',
  '2026-08-24T08:32:00Z',
  :'u2_case_scope',
  1,
  :'u2_primary_client_id',
  :'u2_primary_lead_id'
);
SET LOCAL session_replication_role = origin;

DO $binding_guard$
DECLARE
  test_case_id UUID := current_setting('u2_test.case_id')::UUID;
  different_lead_id UUID :=
    current_setting('u2_test.different_lead_id')::UUID;
BEGIN
  BEGIN
    UPDATE platform.student_cases
    SET canonical_lead_id = different_lead_id
    WHERE id = test_case_id;
    RAISE EXCEPTION 'Mismatched canonical case binding was accepted';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;
END
$binding_guard$;

SELECT candidate.id AS u2_candidate_id
FROM platform_private.client_duplicate_candidates AS candidate
WHERE candidate.organization_id = :'u2_org_a'
  AND candidate.status = 'open'
  AND :'u2_primary_client_id'::UUID IN (
    candidate.left_client_id,
    candidate.right_client_id
  )
  AND :'u2_ambiguous_client_id'::UUID IN (
    candidate.left_client_id,
    candidate.right_client_id
  )
\gset

SELECT jsonb_build_object(
  'sub', :'u2_admin_user',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', 1,
  'platform_organization_id', :'u2_org_a',
  'platform_membership_id', :'u2_admin_membership',
  'platform_bundle_id', '00000000-0000-4000-8000-000000001101',
  'platform_bundle_version', 12
)::TEXT AS u2_admin_claims,
jsonb_build_object(
  'sub', :'u2_sales_user',
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', 1,
  'platform_organization_id', :'u2_org_a',
  'platform_membership_id', :'u2_sales_membership',
  'platform_bundle_id', '00000000-0000-4000-8000-000000001102',
  'platform_bundle_version', 12
)::TEXT AS u2_sales_claims,
jsonb_build_object(
  'sub', :'u2_sales_two_user',
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', 1,
  'platform_organization_id', :'u2_org_a',
  'platform_membership_id', :'u2_sales_two_membership',
  'platform_bundle_id', '00000000-0000-4000-8000-000000001102',
  'platform_bundle_version', 12
)::TEXT AS u2_sales_two_claims,
jsonb_build_object(
  'sub', :'u2_curator_user',
  'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', 1,
  'platform_organization_id', :'u2_org_a',
  'platform_membership_id', :'u2_curator_membership',
  'platform_bundle_id', '00000000-0000-4000-8000-000000001103',
  'platform_bundle_version', 12
)::TEXT AS u2_curator_claims,
jsonb_build_object(
  'sub', :'u2_student_user',
  'role', 'authenticated',
  'platform_role', 'student',
  'platform_access_version', 1,
  'platform_organization_id', :'u2_org_a',
  'platform_membership_id', :'u2_student_membership',
  'platform_bundle_id', '00000000-0000-4000-8000-000000001105',
  'platform_bundle_version', 12
)::TEXT AS u2_student_claims,
jsonb_build_object(
  'sub', :'u2_admin_b_user',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', 1,
  'platform_organization_id', :'u2_org_b',
  'platform_membership_id', :'u2_admin_b_membership',
  'platform_bundle_id', '00000000-0000-4000-8000-000000001101',
  'platform_bundle_version', 12
)::TEXT AS u2_admin_b_claims
\gset

SELECT (
  :'u2_admin_claims'::JSONB
  || jsonb_build_object('platform_access_version', 999)
)::TEXT AS u2_stale_claims,
jsonb_build_object(
  'sub', :'u2_no_membership_user',
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', 1,
  'platform_organization_id', :'u2_org_a',
  'platform_membership_id', gen_random_uuid(),
  'platform_bundle_id', '00000000-0000-4000-8000-000000001102',
  'platform_bundle_version', 12
)::TEXT AS u2_no_membership_claims,
jsonb_build_object(
  'sub', :'u2_blocked_user',
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', 1,
  'platform_organization_id', :'u2_org_a',
  'platform_membership_id', :'u2_blocked_membership',
  'platform_bundle_id', '00000000-0000-4000-8000-000000001102',
  'platform_bundle_version', 12
)::TEXT AS u2_blocked_claims,
jsonb_build_object(
  'sub', :'u2_inactive_user',
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', 1,
  'platform_organization_id', :'u2_org_a',
  'platform_membership_id', :'u2_inactive_membership',
  'platform_bundle_id', '00000000-0000-4000-8000-000000001102',
  'platform_bundle_version', 12
)::TEXT AS u2_inactive_claims,
jsonb_build_object(
  'sub', :'u2_suspended_user',
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', 1,
  'platform_organization_id', :'u2_org_a',
  'platform_membership_id', :'u2_suspended_membership',
  'platform_bundle_id', '00000000-0000-4000-8000-000000001102',
  'platform_bundle_version', 12
)::TEXT AS u2_suspended_claims
\gset

SET LOCAL request.jwt.claims TO :'u2_sales_claims';
SET LOCAL ROLE authenticated;

SELECT
  (SELECT count(*) FROM platform.staff_canonical_lead_page(101))
    AS u2_sales_leads,
  (SELECT count(*) FROM platform.staff_canonical_client_page(101))
    AS u2_sales_clients,
  (SELECT count(*) FROM platform.staff_canonical_lead_detail(
    :'u2_second_lead_id'
  )) AS u2_sales_forbidden_detail,
  (SELECT count(*) FROM platform.clients
    WHERE organization_id = :'u2_org_b') AS u2_sales_cross_org
\gset

\set ON_ERROR_STOP off
SAVEPOINT u2_normalized_column_denial;
SELECT normalized_email FROM platform.clients LIMIT 1;
\set u2_normalized_column_state :SQLSTATE
ROLLBACK TO SAVEPOINT u2_normalized_column_denial;
RELEASE SAVEPOINT u2_normalized_column_denial;

SAVEPOINT u2_private_table_denial;
SELECT * FROM platform_private.client_duplicate_candidates LIMIT 1;
\set u2_private_table_state :SQLSTATE
ROLLBACK TO SAVEPOINT u2_private_table_denial;
RELEASE SAVEPOINT u2_private_table_denial;

SAVEPOINT u2_direct_write_denial;
INSERT INTO platform.clients (
  organization_id, display_name, normalized_name
) VALUES (:'u2_org_a', 'Direct write', 'direct write');
\set u2_direct_write_state :SQLSTATE
ROLLBACK TO SAVEPOINT u2_direct_write_denial;
RELEASE SAVEPOINT u2_direct_write_denial;

SAVEPOINT u2_sales_resolution_denial;
SELECT platform.resolve_client_duplicate(
  :'u2_candidate_id',
  :'u2_primary_client_id',
  :'u2_ambiguous_client_id',
  'Sales must not resolve',
  '84000000-0000-4000-8000-000000000601'
);
\set u2_sales_resolution_state :SQLSTATE
ROLLBACK TO SAVEPOINT u2_sales_resolution_denial;
RELEASE SAVEPOINT u2_sales_resolution_denial;
\set ON_ERROR_STOP on

RESET ROLE;

SELECT
  :'u2_sales_leads' = '2'
  AND :'u2_sales_clients' = '2'
  AND :'u2_sales_forbidden_detail' = '0'
  AND :'u2_sales_cross_org' = '0'
  AND :'u2_normalized_column_state' = '42501'
  AND :'u2_private_table_state' = '42501'
  AND :'u2_direct_write_state' = '42501'
  AND :'u2_sales_resolution_state' = '42501'
  AS u2_sales_scope_ok
\gset
\if :u2_sales_scope_ok
\else
  \echo 'FAIL: U2 Sales scope or direct-denial contract failed'
  SELECT 1 / 0;
\endif

SET LOCAL request.jwt.claims TO :'u2_sales_two_claims';
SET LOCAL ROLE authenticated;
SELECT
  (SELECT count(*) FROM platform.staff_canonical_lead_page(101)) = 2
  AND (SELECT count(*) FROM platform.staff_canonical_client_page(101)) = 2
  AS u2_sales_two_scope_ok
\gset
RESET ROLE;

SET LOCAL request.jwt.claims TO :'u2_curator_claims';
SET LOCAL ROLE authenticated;
SELECT
  (SELECT count(*) FROM platform.staff_canonical_lead_page(101)) = 1
  AND (SELECT count(*) FROM platform.staff_canonical_client_page(101)) = 1
  AND (SELECT count(*) FROM platform.staff_canonical_client_detail(
    :'u2_primary_client_id'
  )) = 1
  AND (SELECT count(*) FROM platform.staff_canonical_client_detail(
    :'u2_different_client_id'
  )) = 0
  AS u2_curator_scope_ok
\gset
RESET ROLE;

\if :u2_curator_scope_ok
\else
  \echo 'FAIL: U2 Curator assigned-case scope failed'
  SELECT 1 / 0;
\endif

SET LOCAL request.jwt.claims TO :'u2_admin_b_claims';
SET LOCAL ROLE authenticated;
SELECT
  (SELECT count(*) FROM platform.staff_canonical_client_detail(
    :'u2_primary_client_id'
  )) = 0
  AND (SELECT count(*) FROM platform.staff_canonical_lead_detail(
    :'u2_primary_lead_id'
  )) = 0
  AS u2_cross_org_absent
\gset
RESET ROLE;

\if :u2_cross_org_absent
\else
  \echo 'FAIL: U2 cross-organization detail was visible'
  SELECT 1 / 0;
\endif

-- Every invalid live-authority shape must produce an empty authorized result.
SET LOCAL request.jwt.claims TO :'u2_no_membership_claims';
SET LOCAL ROLE authenticated;
SELECT
  (SELECT count(*) FROM platform.staff_canonical_lead_page(10)) = 0
  AND (SELECT count(*) FROM platform.staff_canonical_client_page(10)) = 0
  AS u2_no_membership_empty
\gset
RESET ROLE;

SET LOCAL request.jwt.claims TO :'u2_blocked_claims';
SET LOCAL ROLE authenticated;
SELECT
  (SELECT count(*) FROM platform.staff_canonical_lead_page(10)) = 0
  AND (SELECT count(*) FROM platform.staff_canonical_client_page(10)) = 0
  AS u2_blocked_empty
\gset
RESET ROLE;

SET LOCAL request.jwt.claims TO :'u2_inactive_claims';
SET LOCAL ROLE authenticated;
SELECT
  (SELECT count(*) FROM platform.staff_canonical_lead_page(10)) = 0
  AND (SELECT count(*) FROM platform.staff_canonical_client_page(10)) = 0
  AS u2_inactive_empty
\gset
RESET ROLE;

SET LOCAL request.jwt.claims TO :'u2_suspended_claims';
SET LOCAL ROLE authenticated;
SELECT
  (SELECT count(*) FROM platform.staff_canonical_lead_page(10)) = 0
  AND (SELECT count(*) FROM platform.staff_canonical_client_page(10)) = 0
  AS u2_suspended_empty
\gset
RESET ROLE;

SET LOCAL request.jwt.claims TO :'u2_stale_claims';
SET LOCAL ROLE authenticated;
SELECT
  (SELECT count(*) FROM platform.staff_canonical_lead_page(10)) = 0
  AND (SELECT count(*) FROM platform.staff_canonical_client_page(10)) = 0
  AS u2_stale_empty
\gset
RESET ROLE;

SET LOCAL request.jwt.claims TO :'u2_student_claims';
SET LOCAL ROLE authenticated;
SELECT
  (SELECT count(*) FROM platform.staff_canonical_lead_page(10)) = 0
  AND (SELECT count(*) FROM platform.staff_canonical_client_page(10)) = 0
  AS u2_student_empty
\gset
RESET ROLE;

SELECT
  :'u2_no_membership_empty' = 't'
  AND :'u2_blocked_empty' = 't'
  AND :'u2_inactive_empty' = 't'
  AND :'u2_suspended_empty' = 't'
  AND :'u2_stale_empty' = 't'
  AND :'u2_student_empty' = 't'
  AS u2_invalid_authorities_empty
\gset
\if :u2_invalid_authorities_empty
\else
  \echo 'FAIL: U2 invalid authority returned canonical records'
  SELECT 1 / 0;
\endif

SET LOCAL request.jwt.claims = '{"role":"anon"}';
SET LOCAL ROLE anon;
\set ON_ERROR_STOP off
SAVEPOINT u2_anon_rpc_denial;
SELECT * FROM platform.staff_canonical_client_page(10);
\set u2_anon_rpc_state :SQLSTATE
ROLLBACK TO SAVEPOINT u2_anon_rpc_denial;
RELEASE SAVEPOINT u2_anon_rpc_denial;

SAVEPOINT u2_anon_table_denial;
SELECT * FROM platform.clients;
\set u2_anon_table_state :SQLSTATE
ROLLBACK TO SAVEPOINT u2_anon_table_denial;
RELEASE SAVEPOINT u2_anon_table_denial;
\set ON_ERROR_STOP on
RESET ROLE;

SELECT
  :'u2_anon_rpc_state' = '42501'
  AND :'u2_anon_table_state' = '42501'
  AS u2_anon_denial_ok
\gset
\if :u2_anon_denial_ok
\else
  \echo 'FAIL: U2 anonymous table/RPC denial failed'
  SELECT 1 / 0;
\endif

SET LOCAL request.jwt.claims TO :'u2_admin_claims';
SET LOCAL ROLE authenticated;

SELECT platform.resolve_client_duplicate(
  :'u2_candidate_id',
  :'u2_primary_client_id',
  :'u2_ambiguous_client_id',
  'Reviewed synthetic duplicate evidence',
  '84000000-0000-4000-8000-000000000602'
) AS u2_resolution
\gset

SELECT platform.resolve_client_duplicate(
  :'u2_candidate_id',
  :'u2_primary_client_id',
  :'u2_ambiguous_client_id',
  'Reviewed synthetic duplicate evidence',
  '84000000-0000-4000-8000-000000000602'
) AS u2_resolution_replay
\gset

\set ON_ERROR_STOP off
SAVEPOINT u2_stale_resolution_denial;
SELECT platform.resolve_client_duplicate(
  :'u2_candidate_id',
  :'u2_primary_client_id',
  :'u2_ambiguous_client_id',
  'A stale second resolution',
  '84000000-0000-4000-8000-000000000603'
);
\set u2_stale_resolution_state :SQLSTATE
ROLLBACK TO SAVEPOINT u2_stale_resolution_denial;
RELEASE SAVEPOINT u2_stale_resolution_denial;
\set ON_ERROR_STOP on

-- Resolution is invoked through the authenticated Admin seam above. Inspect
-- its deliberately private, append-only history as the privileged test
-- harness; browser roles have no direct access to these relations.
RESET ROLE;

SELECT
  (:'u2_resolution'::JSONB ->> 'resolution_id') =
    (:'u2_resolution_replay'::JSONB ->> 'resolution_id')
  AND :'u2_stale_resolution_state' = '55000'
  AND EXISTS (
    SELECT 1
    FROM platform.clients AS client
    WHERE client.id = :'u2_ambiguous_client_id'
      AND client.lifecycle_state = 'merged'
  )
  AND EXISTS (
    SELECT 1
    FROM platform_private.client_aliases AS alias
    WHERE alias.superseded_client_id = :'u2_ambiguous_client_id'
      AND alias.canonical_client_id = :'u2_primary_client_id'
  )
  AND EXISTS (
    SELECT 1
    FROM platform.leads AS lead
    WHERE lead.id = :'u2_ambiguous_lead_id'
      AND lead.client_id = :'u2_primary_client_id'
  )
  AND EXISTS (
    SELECT 1
    FROM platform.external_identifiers AS external
    WHERE external.client_id = :'u2_ambiguous_client_id'
      AND external.external_identifier = 'u2-client-ambiguous'
  )
  AND EXISTS (
    SELECT 1
    FROM platform.subject_provenance AS evidence
    WHERE evidence.client_id = :'u2_ambiguous_client_id'
      AND evidence.source_ref = 'safe:u2-ambiguous'
  )
  AND (
    SELECT jsonb_array_length(detail.external_identifiers)
    FROM platform.staff_canonical_client_detail(
      :'u2_ambiguous_client_id'
    ) AS detail
  ) >= 3
  AND (
    SELECT jsonb_array_length(detail.provenance)
    FROM platform.staff_canonical_client_detail(
      :'u2_primary_client_id'
    ) AS detail
  ) >= 3
  AS u2_resolution_preserved_history
\gset

\if :u2_resolution_preserved_history
\else
  \echo 'FAIL: U2 Admin resolution did not preserve/redirect history'
  SELECT 1 / 0;
\endif

ROLLBACK;

SELECT 'platform migration 084 canonical RLS and integrity passed' AS result;
