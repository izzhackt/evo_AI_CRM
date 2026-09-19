\set ON_ERROR_STOP on

-- Current-boundary acceptance for migration 193 (PORT-1b «приглашённый
-- проходит ту же анкету и одобрение»). Runs at the 193 checkpoint against the
-- FULL current schema (185's cabinet_pending invites, 192's access tiers and
-- 180's unified intake are all live), wired exactly like 192's own hook.
-- Provider calls are outside this suite: every Auth row and delivery result
-- is synthetic SQL evidence, same convention as 126/185.
--
-- Covered (task PORT-1b, D):
--   (i)   anketa_v1 invite: dispatch stamps the marker, finalize binds but
--         does NOT activate (no direct portal entry), submit links the
--         анкета to the invite's case/lead without a second client/lead;
--   (ii)  approve REUSES the invited case: count(student_cases) does not
--         grow, portal_activated_at is set, the profile carries анкета data,
--         the invite receipt completes, the portal opens;
--   (iii) a legacy (pre-193) receipt keeps today's behaviour: finalize
--         activates, bind без анкеты;
--   (iv)  an ordinary (non-invited) анкета keeps 180's behaviour: approval
--         creates a NEW case;
--   (v)   decide replay is durable (receipt), a NEW decide request on the
--         decided анкета is PT409; re-inviting a bound case fails closed
--         with no duplicate receipt;
--   (vi)  a foreign auth user cannot be approved into someone else's invite
--         case (42501).
BEGIN;

SET LOCAL TIME ZONE 'UTC';

-- Same lightweight Auth bootstrap 126/185 use: managed Supabase Auth owns
-- these columns/functions for real; add them transaction-locally so the
-- invite/finalize/анкета evidence can be exercised, then let ROLLBACK discard
-- the DDL along with every row. banned_until/is_anonymous and auth.role()
-- are additionally required by 177's student_application_account_email().
ALTER TABLE auth.users
  ADD COLUMN confirmation_sent_at TIMESTAMPTZ,
  ADD COLUMN email_confirmed_at TIMESTAMPTZ,
  ADD COLUMN confirmed_at TIMESTAMPTZ,
  ADD COLUMN banned_until TIMESTAMPTZ,
  ADD COLUMN is_anonymous BOOLEAN NOT NULL DEFAULT FALSE;

CREATE FUNCTION auth.role() RETURNS TEXT
LANGUAGE SQL STABLE SET search_path=''
AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', TRUE), '')::JSONB ->> 'role'
$$;

CREATE FUNCTION pg_temp.p193_id(n INTEGER) RETURNS UUID
LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('19300000-0000-4000-8000-'||lpad(n::TEXT, 12, '0'))::UUID
$$;

CREATE FUNCTION pg_temp.p193_assert(p_condition BOOLEAN, p_message TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Migration 193 assertion failed: %', p_message;
  END IF;
END
$$;

-- A full, contract-valid 177 questionnaire (the CHECK in
-- platform_private.student_applications re-validates it on INSERT).
CREATE FUNCTION pg_temp.p193_questionnaire(p_request UUID, p_first TEXT, p_last TEXT, p_phone TEXT)
RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'schemaVersion', 1,
    'requestId', p_request::TEXT,
    'firstName', p_first,
    'lastName', p_last,
    'phone', p_phone,
    'destinationCountries', jsonb_build_array('CN'),
    'intakeSeason', 'autumn',
    'intakeYear', 2027,
    'educationLevel', 'high_school',
    'averageGrade', 4.5,
    'gradeScale', '5',
    'studyFields', jsonb_build_array('Инженерия'),
    'studyLevels', jsonb_build_array('bachelor'),
    'nationality', 'KG',
    'english', jsonb_build_object('mode', 'self', 'level', 'beginner'),
    'tuitionBudget', 'under_5000',
    'fundingSource', 'family',
    'consent', TRUE,
    'consentVersion', '2026-09-18')
$$;

CREATE FUNCTION pg_temp.p193_expect_prepare_denied(
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

CREATE FUNCTION pg_temp.p193_expect_decide_denied(
  p_application_id UUID, p_expected_revision BIGINT, p_decision TEXT,
  p_reason TEXT, p_request_id UUID, p_sqlstate TEXT, p_message TEXT
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM platform.decide_student_application_v1(
    p_application_id, p_expected_revision, p_decision, p_reason, p_request_id
  );
  RAISE EXCEPTION 'decide_student_application_v1 was unexpectedly accepted (expected % / %)',
    p_sqlstate, p_message;
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> p_sqlstate OR SQLERRM <> p_message THEN RAISE; END IF;
END
$$;

GRANT EXECUTE ON FUNCTION
  pg_temp.p193_id(INTEGER),
  pg_temp.p193_assert(BOOLEAN, TEXT),
  pg_temp.p193_questionnaire(UUID, TEXT, TEXT, TEXT),
  pg_temp.p193_expect_prepare_denied(UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, UUID, TEXT, TEXT),
  pg_temp.p193_expect_decide_denied(UUID, BIGINT, TEXT, TEXT, UUID, TEXT, TEXT)
  TO authenticated, service_role;

SELECT 'P193_INVITED_INTAKE_SUITE_START' AS p193_suite_marker;

-- ---------------------------------------------------------------------------
-- Seed: organization + canonical organization scope; admin; one Sales
-- membership (the 185 fixture, minus the second Sales/curator negatives that
-- suite already proves).
-- ---------------------------------------------------------------------------
INSERT INTO platform.organizations (id, name)
VALUES (pg_temp.p193_id(1), 'Migration 193 synthetic organization');

INSERT INTO platform.record_scopes (id, organization_id, scope_kind, scope_key, scope_version)
VALUES (pg_temp.p193_id(2), pg_temp.p193_id(1), 'organization', pg_temp.p193_id(1), 1);

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  (pg_temp.p193_id(101), 'p193-admin@example.invalid', '{}'::JSONB),
  (pg_temp.p193_id(102), 'p193-sales@example.invalid', '{}'::JSONB);

INSERT INTO platform.profiles (id, auth_user_id, display_name, status, access_version)
VALUES
  (pg_temp.p193_id(201), pg_temp.p193_id(101), 'P193 Admin', 'active', 1),
  (pg_temp.p193_id(202), pg_temp.p193_id(102), 'P193 Sales', 'active', 1);

INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status, "current_role", current_bundle_id,
  is_system_admin
) VALUES
  (
    pg_temp.p193_id(301), pg_temp.p193_id(1), pg_temp.p193_id(201), 'active',
    'admin',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'admin' AND status = 'published' ORDER BY version DESC LIMIT 1),
    TRUE
  ),
  (
    pg_temp.p193_id(302), pg_temp.p193_id(1), pg_temp.p193_id(202), 'active',
    'sales',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'sales' AND status = 'published' ORDER BY version DESC LIMIT 1),
    FALSE
  );

-- 177's configuration singleton: the disposable database has no production
-- department, so the review-department binding is seeded here (the config
-- row is what submit_student_application_v1 resolves the organization from).
INSERT INTO platform.staff_departments (id, organization_id, name)
VALUES (pg_temp.p193_id(930), pg_temp.p193_id(1), 'Отдел сопровождения');
INSERT INTO platform_private.student_application_configuration (singleton, organization_id, review_department_id, enabled)
VALUES (TRUE, pg_temp.p193_id(1), pg_temp.p193_id(930), TRUE);

-- Live JWT claims via the CURRENT production hook -- never hand-built.
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p193_id(101),
  'claims', jsonb_build_object('sub', pg_temp.p193_id(101), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p193_admin_claims
\gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p193_id(102),
  'claims', jsonb_build_object('sub', pg_temp.p193_id(102), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p193_sales_claims
\gset

-- Own-scoped lead.sales.workflow.manage grant for the Sales membership (the
-- same 155 RPC surface the 185 suite exercises).
SET request.jwt.claims TO :'p193_admin_claims';
SET ROLE authenticated;

SELECT platform.staff_role_command(
  pg_temp.p193_id(1), pg_temp.p193_id(401), 0, 'create',
  jsonb_build_object(
    'label', 'P193 Sales lead workflow',
    'description', 'Migration 193 synthetic Sales lead-workflow role',
    'permissionKeys', jsonb_build_array('lead.sales.workflow.manage')
  ),
  'P193 create Sales lead-workflow role', pg_temp.p193_id(411)
) AS p193_role_created
\gset
SELECT platform.staff_role_impact(pg_temp.p193_id(1), pg_temp.p193_id(401), 1)
  ->> 'impactFingerprint' AS p193_role_impact_fingerprint
\gset
SELECT platform.staff_role_publish(
  pg_temp.p193_id(1), pg_temp.p193_id(401), 1,
  :'p193_role_impact_fingerprint', 'P193 publish Sales lead-workflow role',
  pg_temp.p193_id(412)
) AS p193_role_published
\gset
SELECT (:'p193_role_published'::JSONB ->> 'bundleId') AS p193_role_bundle_id
\gset
SELECT platform.staff_role_assignments_save(
  pg_temp.p193_id(1), pg_temp.p193_id(302), 1,
  jsonb_build_array(jsonb_build_object(
    'roleId', pg_temp.p193_id(401),
    'scope', jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)
  )),
  jsonb_build_array(jsonb_build_object(
    'roleId', pg_temp.p193_id(401), 'roleVersion', 2,
    'bundleId', :'p193_role_bundle_id'::UUID, 'bundleVersion', 1
  )),
  'P193 grant Sales lead workflow access', pg_temp.p193_id(413)
) = jsonb_build_object(
  'status', 'applied', 'membershipId', pg_temp.p193_id(302), 'accessVersion', 2
) AS p193_sales_granted
\gset
RESET ROLE;
SELECT pg_temp.p193_assert(
  :'p193_sales_granted'::BOOLEAN,
  'Sales did not receive the own-scoped lead.sales.workflow.manage grant'
);

-- Three canonical client+lead pairs owned by Sales (184's one-card rule is
-- client-scoped, so each cabinet needs its own client): the anketa_v1 flow
-- (A), the legacy-receipt flow (B) and the foreign-auth negative (C).
INSERT INTO platform.clients (id, organization_id, display_name, normalized_name)
VALUES
  (pg_temp.p193_id(501), pg_temp.p193_id(1), 'P193 Invited Client', platform_private.normalize_person_name('P193 Invited Client')),
  (pg_temp.p193_id(503), pg_temp.p193_id(1), 'P193 Legacy Client', platform_private.normalize_person_name('P193 Legacy Client')),
  (pg_temp.p193_id(505), pg_temp.p193_id(1), 'P193 Foreign Client', platform_private.normalize_person_name('P193 Foreign Client'));
INSERT INTO platform.leads (
  id, organization_id, client_id, current_owner_membership_id, stage_key, source_key
) VALUES
  (pg_temp.p193_id(502), pg_temp.p193_id(1), pg_temp.p193_id(501), pg_temp.p193_id(302), 'new', 'website'),
  (pg_temp.p193_id(504), pg_temp.p193_id(1), pg_temp.p193_id(503), pg_temp.p193_id(302), 'new', 'website'),
  (pg_temp.p193_id(506), pg_temp.p193_id(1), pg_temp.p193_id(505), pg_temp.p193_id(302), 'new', 'website');

-- ===========================================================================
-- (i) anketa_v1 invite: dispatch stamps the marker; finalize binds WITHOUT
--     activating; the accepted user has no portal authority and their анкета
--     links to the invite's own case/lead.
-- ===========================================================================
-- Delta baselines: earlier migrations may seed their own canonical rows, so
-- «no second client/lead» is asserted against the pre-submit totals.
SELECT count(*) AS p193_leads_before_submit FROM platform.leads
\gset
SELECT count(*) AS p193_clients_before_submit FROM platform.clients
\gset
SET request.jwt.claims TO :'p193_sales_claims';
SET ROLE authenticated;
SELECT platform.prepare_lead_cabinet_v1(
  pg_temp.p193_id(1), pg_temp.p193_id(808), pg_temp.p193_id(502)
)::TEXT AS p193_cabinet_one_prepared
\gset
SELECT (:'p193_cabinet_one_prepared'::JSONB ->> 'student_case_id')::UUID AS p193_case_one
\gset
SELECT platform.prepare_student_portal_provisioning(
  pg_temp.p193_id(1), :'p193_case_one', 'p193-invited@example.invalid',
  'P193 Invited Student', 'cabinet_pending', NULL,
  'P193 anketa_v1 cabinet invite', pg_temp.p193_id(804)
)::TEXT AS p193_case_one_prepared
\gset
SELECT (:'p193_case_one_prepared'::JSONB ->> 'receipt_id')::UUID AS p193_receipt_one
\gset
RESET ROLE;

SELECT pg_temp.p193_assert(
  (
    SELECT receipt.intake_flow = 'anketa_v1'
      AND receipt.case_shape = 'cabinet_pending'
      AND receipt.legacy_curator_membership_id IS NULL
    FROM platform_private.student_portal_provisioning_receipts AS receipt
    WHERE receipt.id = :'p193_receipt_one'
  ),
  'prepare did not stamp intake_flow=anketa_v1 on the new cabinet receipt'
);

SET ROLE service_role;
SELECT platform.claim_student_portal_invite(
  :'p193_receipt_one', pg_temp.p193_id(851), 1, 0
)::TEXT AS p193_case_one_claimed
\gset
RESET ROLE;
INSERT INTO auth.users (id, email, raw_user_meta_data, confirmation_sent_at)
VALUES (pg_temp.p193_id(910), 'p193-invited@example.invalid', '{}'::JSONB, statement_timestamp());
SET ROLE service_role;
SELECT platform.record_student_portal_invite_success(
  :'p193_receipt_one', pg_temp.p193_id(851), 2, 1, pg_temp.p193_id(910), 3600
)::TEXT AS p193_case_one_succeeded
\gset

-- THE new behaviour: finalize binds the membership but does NOT activate.
SELECT platform.finalize_student_portal_authority(
  :'p193_receipt_one', 3, 1
)::TEXT AS p193_case_one_finalized
\gset
SELECT pg_temp.p193_assert(
  :'p193_case_one_finalized'::JSONB ->> 'authority_activated' = 'false'
  AND :'p193_case_one_finalized'::JSONB ->> 'provisioning_state' = 'invite_succeeded'
  AND (:'p193_case_one_finalized'::JSONB ->> 'student_membership_id') IS NOT NULL,
  'anketa_v1 finalize did not stay account-pending after the bind'
);
-- A replayed finalize is a durable pending outcome, not an error.
SELECT platform.finalize_student_portal_authority(
  :'p193_receipt_one', 3, 1
)::TEXT AS p193_case_one_finalize_replay
\gset
SELECT pg_temp.p193_assert(
  :'p193_case_one_finalize_replay'::JSONB ->> 'authority_activated' = 'false'
  AND :'p193_case_one_finalize_replay'::JSONB ->> 'student_membership_id'
    = :'p193_case_one_finalized'::JSONB ->> 'student_membership_id',
  'anketa_v1 finalize replay was not a durable pending outcome'
);
RESET ROLE;

SELECT (:'p193_case_one_finalized'::JSONB ->> 'student_membership_id')::UUID
  AS p193_case_one_membership
\gset
SELECT pg_temp.p193_assert(
  (
    SELECT student_case.state = 'pending'
      AND student_case.current_curator_membership_id IS NULL
      AND student_case.handoff_at IS NULL
      AND student_case.portal_activated_at IS NULL
      AND student_case.student_membership_id = :'p193_case_one_membership'
    FROM platform.student_cases AS student_case
    WHERE student_case.id = :'p193_case_one'
  ),
  'anketa_v1 finalize bound the case but must leave portal_activated_at NULL'
);

-- Acceptance: the invited human confirms; the identity resolver reports the
-- new marker and the caller''s own display name for /apply prefill.
UPDATE auth.users
SET email_confirmed_at = statement_timestamp(), confirmed_at = statement_timestamp()
WHERE id = pg_temp.p193_id(910);
SET ROLE service_role;
SELECT platform.resolve_student_portal_invite_identity(
  pg_temp.p193_id(910), 'p193-invited@example.invalid', TRUE
)::TEXT AS p193_case_one_resolved
\gset
RESET ROLE;
SELECT pg_temp.p193_assert(
  :'p193_case_one_resolved'::JSONB ->> 'account_pending' = 'true'
  AND :'p193_case_one_resolved'::JSONB ->> 'intake_flow' = 'anketa_v1'
  AND :'p193_case_one_resolved'::JSONB ->> 'student_display_name' = 'P193 Invited Student'
  AND :'p193_case_one_resolved'::JSONB ->> 'invite_delivery_status' = 'accepted',
  'resolve_student_portal_invite_identity did not expose the anketa_v1 marker'
);

-- No direct portal entry: the accepted-but-unapproved student resolves ZERO
-- portal cases (the 180/192 authority chain requires portal_activated_at).
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p193_id(910),
  'claims', jsonb_build_object('sub', pg_temp.p193_id(910), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p193_invited_claims
\gset
SET request.jwt.claims TO :'p193_invited_claims';
SET ROLE authenticated;
SELECT pg_temp.p193_assert(
  (SELECT count(*) = 0 FROM platform.student_portal_cases()),
  'an accepted anketa_v1 invite must NOT open the portal before approval'
);

-- The invited user submits the SAME public анкета; the row links to the
-- invite''s case and lead (no second client/lead is ever created).
SELECT platform.submit_student_application_v1(
  pg_temp.p193_id(861),
  pg_temp.p193_questionnaire(pg_temp.p193_id(861), 'Айбек', 'Приглашённый', '+996700112233'),
  0
)::TEXT AS p193_app_one_submitted
\gset
SELECT (:'p193_app_one_submitted'::JSONB ->> 'id')::UUID AS p193_app_one
\gset
SELECT pg_temp.p193_assert(
  :'p193_app_one_submitted'::JSONB ->> 'status' = 'pending'
  AND :'p193_app_one_submitted'::JSONB ->> 'revision' = '1',
  'invited анкета submit did not create a pending revision-1 application'
);
-- Idempotent replay of the same submit request.
SELECT platform.submit_student_application_v1(
  pg_temp.p193_id(861),
  pg_temp.p193_questionnaire(pg_temp.p193_id(861), 'Айбек', 'Приглашённый', '+996700112233'),
  0
)::TEXT AS p193_app_one_replay
\gset
SELECT pg_temp.p193_assert(
  :'p193_app_one_replay'::JSONB ->> 'revision' = '1'
  AND (:'p193_app_one_replay'::JSONB ->> 'id')::UUID = :'p193_app_one',
  'invited анкета submit replay was not idempotent'
);
RESET ROLE;

SELECT pg_temp.p193_assert(
  (
    SELECT app.invited_case_id = :'p193_case_one'
      AND app.canonical_lead_id = pg_temp.p193_id(502)
      AND app.student_case_id IS NULL
    FROM platform_private.student_applications AS app
    WHERE app.id = :'p193_app_one'
  ),
  'invited анкета did not link to the invite case and its canonical lead'
);
SELECT pg_temp.p193_assert(
  (SELECT count(*) = :'p193_leads_before_submit'::BIGINT FROM platform.leads)
  AND (SELECT count(*) = :'p193_clients_before_submit'::BIGINT FROM platform.clients),
  'invited анкета submit must not create a second client or lead'
);

-- ===========================================================================
-- (ii) approve reuses the invited case; (v) replay/decided conflicts;
--      re-invite of the bound case stays closed with a single receipt.
-- ===========================================================================
SELECT count(*) AS p193_cases_before_invited_approve FROM platform.student_cases
\gset
SET request.jwt.claims TO :'p193_admin_claims';
SET ROLE authenticated;
SELECT platform.decide_student_application_v1(
  :'p193_app_one', 1, 'approve', 'Одобрение приглашённой анкеты', pg_temp.p193_id(862)
)::TEXT AS p193_app_one_approved
\gset
SELECT pg_temp.p193_assert(
  :'p193_app_one_approved'::JSONB ->> 'status' = 'approved'
  AND (:'p193_app_one_approved'::JSONB ->> 'student_case_id')::UUID = :'p193_case_one',
  'invited approve did not bind the анкета to the invite case'
);
-- (v) same-request replay is durable.
SELECT platform.decide_student_application_v1(
  :'p193_app_one', 1, 'approve', 'Одобрение приглашённой анкеты', pg_temp.p193_id(862)
)::TEXT AS p193_app_one_approve_replay
\gset
SELECT pg_temp.p193_assert(
  :'p193_app_one_approve_replay'::JSONB ->> 'status' = 'approved'
  AND :'p193_app_one_approve_replay'::JSONB ->> 'revision' = '2',
  'invited approve replay was not the durable receipt outcome'
);
-- (v) a NEW request against the decided анкета is a PT409 business conflict.
SELECT pg_temp.p193_expect_decide_denied(
  :'p193_app_one', 2, 'approve', 'Повторное одобрение', pg_temp.p193_id(863),
  'PT409', 'student_application_conflict'
);
RESET ROLE;

SELECT pg_temp.p193_assert(
  (SELECT count(*) = :'p193_cases_before_invited_approve'::BIGINT FROM platform.student_cases),
  'invited approve must reuse the existing case, not insert a new one'
);
SELECT pg_temp.p193_assert(
  (
    SELECT student_case.state = 'pending'
      AND student_case.current_curator_membership_id IS NULL
      AND student_case.handoff_at IS NULL
      AND student_case.portal_activated_at IS NOT NULL
      AND student_case.student_membership_id = :'p193_case_one_membership'
    FROM platform.student_cases AS student_case
    WHERE student_case.id = :'p193_case_one'
  ),
  'invited approve did not activate the invite case in place'
);
SELECT pg_temp.p193_assert(
  (
    SELECT profile.citizenship_country = 'KG'
      AND profile.budget_band = 'До 5 000 USD в год'
      AND profile.current_education_summary = 'Окончил(а) школу'
    FROM platform.student_profiles AS profile
    WHERE profile.organization_id = pg_temp.p193_id(1)
      AND profile.student_case_id = :'p193_case_one'
  ),
  'invited approve did not persist the fresh анкета data into student_profiles'
);
SELECT pg_temp.p193_assert(
  (
    SELECT receipt.provisioning_state = 'authority_activated'
      AND receipt.authority_activated_at IS NOT NULL
    FROM platform_private.student_portal_provisioning_receipts AS receipt
    WHERE receipt.id = :'p193_receipt_one'
  ),
  'invited approve did not complete the invite receipt'
);

-- The portal now opens for the approved invited student. Approval bumps the
-- profile access_version (both the invite bind and the approve call), so the
-- claims are re-minted through the live hook — exactly what the production
-- flow does via refreshSession before re-reading authority.
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p193_id(910),
  'claims', jsonb_build_object('sub', pg_temp.p193_id(910), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p193_invited_claims_after_approve
\gset
SET request.jwt.claims TO :'p193_invited_claims_after_approve';
SET ROLE authenticated;
SELECT pg_temp.p193_assert(
  EXISTS (
    SELECT 1 FROM platform.student_portal_cases() AS portal
    WHERE portal.case_id = :'p193_case_one'
      AND portal.case_state = 'pending'
      AND portal.portal_activated_at IS NOT NULL
  ),
  'approved invited student did not gain portal authority on the invite case'
);
RESET ROLE;

-- Re-inviting the bound case fails closed; the case still has ONE receipt.
SET request.jwt.claims TO :'p193_sales_claims';
SET ROLE authenticated;
SELECT pg_temp.p193_expect_prepare_denied(
  pg_temp.p193_id(1), :'p193_case_one', 'p193-reinvite@example.invalid',
  'P193 Reinvite Student', 'cabinet_pending', NULL,
  'P193 re-invite after submitted анкета', pg_temp.p193_id(812),
  '40001', 'portal_case_already_bound'
);
RESET ROLE;
SELECT pg_temp.p193_assert(
  (
    SELECT count(*) = 1
    FROM platform_private.student_portal_provisioning_receipts AS receipt
    WHERE receipt.student_case_id = :'p193_case_one'
  ),
  're-invite attempt must not create a duplicate receipt'
);

-- ===========================================================================
-- (iii) a legacy (pre-193) receipt keeps today''s behaviour: finalize
--       activates the portal, bind без анкеты. The receipt is prepared by
--       the CURRENT prepare and then flipped to ''legacy'' as superuser --
--       exactly what the column DEFAULT does for every pre-existing row.
-- ===========================================================================
SET request.jwt.claims TO :'p193_sales_claims';
SET ROLE authenticated;
SELECT platform.prepare_lead_cabinet_v1(
  pg_temp.p193_id(1), pg_temp.p193_id(809), pg_temp.p193_id(504)
)::TEXT AS p193_cabinet_two_prepared
\gset
SELECT (:'p193_cabinet_two_prepared'::JSONB ->> 'student_case_id')::UUID AS p193_case_two
\gset
SELECT platform.prepare_student_portal_provisioning(
  pg_temp.p193_id(1), :'p193_case_two', 'p193-legacy@example.invalid',
  'P193 Legacy Student', 'cabinet_pending', NULL,
  'P193 legacy-flow cabinet invite', pg_temp.p193_id(810)
)::TEXT AS p193_case_two_prepared
\gset
SELECT (:'p193_case_two_prepared'::JSONB ->> 'receipt_id')::UUID AS p193_receipt_two
\gset
RESET ROLE;
UPDATE platform_private.student_portal_provisioning_receipts
SET intake_flow = 'legacy'
WHERE id = :'p193_receipt_two';

SET ROLE service_role;
SELECT platform.claim_student_portal_invite(
  :'p193_receipt_two', pg_temp.p193_id(852), 1, 0
)::TEXT AS p193_case_two_claimed
\gset
RESET ROLE;
INSERT INTO auth.users (id, email, raw_user_meta_data, confirmation_sent_at)
VALUES (pg_temp.p193_id(920), 'p193-legacy@example.invalid', '{}'::JSONB, statement_timestamp());
SET ROLE service_role;
SELECT platform.record_student_portal_invite_success(
  :'p193_receipt_two', pg_temp.p193_id(852), 2, 1, pg_temp.p193_id(920), 3600
)::TEXT AS p193_case_two_succeeded
\gset
SELECT platform.finalize_student_portal_authority(
  :'p193_receipt_two', 3, 1
)::TEXT AS p193_case_two_finalized
\gset
RESET ROLE;
SELECT pg_temp.p193_assert(
  :'p193_case_two_finalized'::JSONB ->> 'authority_activated' = 'true'
  AND :'p193_case_two_finalized'::JSONB ->> 'provisioning_state' = 'authority_activated',
  'legacy receipt finalize must keep activating the portal (bind без анкеты)'
);
SELECT pg_temp.p193_assert(
  (
    SELECT student_case.portal_activated_at IS NOT NULL
      AND student_case.state = 'pending'
      AND student_case.current_curator_membership_id IS NULL
    FROM platform.student_cases AS student_case
    WHERE student_case.id = :'p193_case_two'
  ),
  'legacy receipt finalize did not activate the cabinet case in place'
);

UPDATE auth.users
SET email_confirmed_at = statement_timestamp(), confirmed_at = statement_timestamp()
WHERE id = pg_temp.p193_id(920);
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p193_id(920),
  'claims', jsonb_build_object('sub', pg_temp.p193_id(920), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p193_legacy_claims
\gset
SET request.jwt.claims TO :'p193_legacy_claims';
SET ROLE authenticated;
SELECT pg_temp.p193_assert(
  EXISTS (
    SELECT 1 FROM platform.student_portal_cases() AS portal
    WHERE portal.case_id = :'p193_case_two'
      AND portal.portal_activated_at IS NOT NULL
  ),
  'legacy invited student must keep direct portal access (no анкета required)'
);
RESET ROLE;

-- ===========================================================================
-- (iv) an ordinary (non-invited) анкета keeps 180''s behaviour: approval
--      provisions a NEW case.
-- ===========================================================================
INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at, confirmed_at)
VALUES (
  pg_temp.p193_id(930), 'p193-public@example.invalid', '{}'::JSONB,
  statement_timestamp(), statement_timestamp()
);
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p193_id(930),
  'claims', jsonb_build_object('sub', pg_temp.p193_id(930), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p193_public_claims
\gset
SET request.jwt.claims TO :'p193_public_claims';
SET ROLE authenticated;
SELECT platform.submit_student_application_v1(
  pg_temp.p193_id(864),
  pg_temp.p193_questionnaire(pg_temp.p193_id(864), 'Салтанат', 'Самостоятельная', '+996700445566'),
  0
)::TEXT AS p193_app_two_submitted
\gset
SELECT (:'p193_app_two_submitted'::JSONB ->> 'id')::UUID AS p193_app_two
\gset
RESET ROLE;
SELECT pg_temp.p193_assert(
  (
    SELECT app.invited_case_id IS NULL
    FROM platform_private.student_applications AS app
    WHERE app.id = :'p193_app_two'
  ),
  'an ordinary анкета must not carry an invited_case_id'
);

SELECT count(*) AS p193_cases_before_public_approve FROM platform.student_cases
\gset
SET request.jwt.claims TO :'p193_admin_claims';
SET ROLE authenticated;
SELECT platform.decide_student_application_v1(
  :'p193_app_two', 1, 'approve', 'Одобрение самостоятельной анкеты', pg_temp.p193_id(865)
)::TEXT AS p193_app_two_approved
\gset
RESET ROLE;
SELECT (:'p193_app_two_approved'::JSONB ->> 'student_case_id')::UUID AS p193_public_case
\gset
SELECT pg_temp.p193_assert(
  :'p193_app_two_approved'::JSONB ->> 'status' = 'approved'
  AND :'p193_public_case' NOT IN (:'p193_case_one', :'p193_case_two')
  AND (SELECT count(*) = :'p193_cases_before_public_approve'::BIGINT + 1 FROM platform.student_cases),
  'ordinary анкета approval must still provision a NEW case (180 behaviour)'
);
SELECT pg_temp.p193_assert(
  (
    SELECT student_case.state = 'pending'
      AND student_case.portal_activated_at IS NOT NULL
      AND student_case.public_application_id = :'p193_app_two'
    FROM platform.student_cases AS student_case
    WHERE student_case.id = :'p193_public_case'
  ),
  'ordinary анкета approval did not open the 180-shaped pending cabinet'
);

-- ===========================================================================
-- (vi) a foreign auth user cannot be approved into someone else''s invite
--      case: decide re-derives the receipt binding and refuses 42501.
-- ===========================================================================
SET request.jwt.claims TO :'p193_sales_claims';
SET ROLE authenticated;
SELECT platform.prepare_lead_cabinet_v1(
  pg_temp.p193_id(1), pg_temp.p193_id(813), pg_temp.p193_id(506)
)::TEXT AS p193_cabinet_three_prepared
\gset
SELECT (:'p193_cabinet_three_prepared'::JSONB ->> 'student_case_id')::UUID AS p193_case_three
\gset
SELECT platform.prepare_student_portal_provisioning(
  pg_temp.p193_id(1), :'p193_case_three', 'p193-foreign@example.invalid',
  'P193 Foreign Student', 'cabinet_pending', NULL,
  'P193 foreign-auth negative invite', pg_temp.p193_id(814)
)::TEXT AS p193_case_three_prepared
\gset
SELECT (:'p193_case_three_prepared'::JSONB ->> 'receipt_id')::UUID AS p193_receipt_three
\gset
RESET ROLE;
SET ROLE service_role;
SELECT platform.claim_student_portal_invite(
  :'p193_receipt_three', pg_temp.p193_id(853), 1, 0
)::TEXT AS p193_case_three_claimed
\gset
RESET ROLE;
INSERT INTO auth.users (id, email, raw_user_meta_data, confirmation_sent_at)
VALUES (pg_temp.p193_id(940), 'p193-foreign@example.invalid', '{}'::JSONB, statement_timestamp());
SET ROLE service_role;
SELECT platform.record_student_portal_invite_success(
  :'p193_receipt_three', pg_temp.p193_id(853), 2, 1, pg_temp.p193_id(940), 3600
)::TEXT AS p193_case_three_succeeded
\gset
SELECT platform.finalize_student_portal_authority(
  :'p193_receipt_three', 3, 1
)::TEXT AS p193_case_three_finalized
\gset
RESET ROLE;
UPDATE auth.users
SET email_confirmed_at = statement_timestamp(), confirmed_at = statement_timestamp()
WHERE id = pg_temp.p193_id(940);
SET ROLE service_role;
SELECT platform.resolve_student_portal_invite_identity(
  pg_temp.p193_id(940), 'p193-foreign@example.invalid', TRUE
)::TEXT AS p193_case_three_resolved
\gset
RESET ROLE;

-- An unrelated public applicant whose row is forged (superuser) to point at
-- the foreign invite case: the receipt''s bound auth user does not match.
INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at, confirmed_at)
VALUES (
  pg_temp.p193_id(950), 'p193-intruder@example.invalid', '{}'::JSONB,
  statement_timestamp(), statement_timestamp()
);
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p193_id(950),
  'claims', jsonb_build_object('sub', pg_temp.p193_id(950), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p193_intruder_claims
\gset
SET request.jwt.claims TO :'p193_intruder_claims';
SET ROLE authenticated;
SELECT platform.submit_student_application_v1(
  pg_temp.p193_id(866),
  pg_temp.p193_questionnaire(pg_temp.p193_id(866), 'Чужой', 'Пользователь', '+996700778899'),
  0
)::TEXT AS p193_app_three_submitted
\gset
SELECT (:'p193_app_three_submitted'::JSONB ->> 'id')::UUID AS p193_app_three
\gset
RESET ROLE;
UPDATE platform_private.student_applications
SET invited_case_id = :'p193_case_three'
WHERE id = :'p193_app_three';

SET request.jwt.claims TO :'p193_admin_claims';
SET ROLE authenticated;
SELECT pg_temp.p193_expect_decide_denied(
  :'p193_app_three', 1, 'approve', 'Чужой инвайт-кейс', pg_temp.p193_id(867),
  '42501', 'student_application_forbidden'
);
RESET ROLE;
SELECT pg_temp.p193_assert(
  (
    SELECT app.status = 'pending' AND app.student_case_id IS NULL
    FROM platform_private.student_applications AS app
    WHERE app.id = :'p193_app_three'
  ),
  'the refused foreign approve must leave the анкета untouched'
);
SELECT pg_temp.p193_assert(
  (
    SELECT student_case.portal_activated_at IS NULL
    FROM platform.student_cases AS student_case
    WHERE student_case.id = :'p193_case_three'
  ),
  'the refused foreign approve must not activate the foreign invite case'
);

SELECT 'P193_INVITED_INTAKE_SUITE_PASSED' AS p193_suite_marker;

ROLLBACK;
