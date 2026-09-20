\set ON_ERROR_STOP on

-- Current-boundary acceptance for migration 194 (PT409 for the invite
-- family's re-invite conflicts). Runs at the 194 checkpoint against the FULL
-- current schema, wired exactly like 192/193's own hooks. Provider calls are
-- outside this suite: every Auth row and delivery result is synthetic SQL
-- evidence, same convention as 126/185/193.
--
-- Covered:
--   (i)   a repeat invite for a case that already holds a receipt now
--         surfaces SQLSTATE PT409 (NOT the retryable 40001) with the
--         UNCHANGED message portal_case_already_reserved, and the case
--         still has exactly ONE receipt (no duplicate);
--   (ii)  a replayed prepare request with a drifted fingerprint is PT409 /
--         request_replay_conflict, while the byte-identical replay stays a
--         durable replayed=true snapshot (behaviour intact);
--   (iii) the authenticated reissue authorization surfaces its fencing
--         conflict as PT409 / stale_receipt_version;
--   (iv)  finalize_student_portal_authority surfaces PT409 for
--         stale_invite_generation and stale_receipt_version, and the refused
--         finalizes leave the receipt and the case untouched.
-- The expect-helpers match SQLSTATE and SQLERRM exactly, so a regression
-- back to 40001 (or a message drift) fails this suite loudly.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

-- Same lightweight Auth bootstrap 126/185/193 use: managed Supabase Auth
-- owns these columns for real; add them transaction-locally so the invite
-- dispatch evidence can be exercised, then let ROLLBACK discard the DDL
-- along with every row.
ALTER TABLE auth.users
  ADD COLUMN confirmation_sent_at TIMESTAMPTZ,
  ADD COLUMN email_confirmed_at TIMESTAMPTZ,
  ADD COLUMN confirmed_at TIMESTAMPTZ;

CREATE FUNCTION pg_temp.p194_id(n INTEGER) RETURNS UUID
LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('19400000-0000-4000-8000-'||lpad(n::TEXT, 12, '0'))::UUID
$$;

CREATE FUNCTION pg_temp.p194_assert(p_condition BOOLEAN, p_message TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Migration 194 assertion failed: %', p_message;
  END IF;
END
$$;

CREATE FUNCTION pg_temp.p194_expect_prepare_denied(
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

CREATE FUNCTION pg_temp.p194_expect_reissue_denied(
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

CREATE FUNCTION pg_temp.p194_expect_finalize_denied(
  p_receipt_id UUID, p_expected_receipt_version BIGINT,
  p_expected_invite_generation BIGINT, p_sqlstate TEXT, p_message TEXT
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM platform.finalize_student_portal_authority(
    p_receipt_id, p_expected_receipt_version, p_expected_invite_generation
  );
  RAISE EXCEPTION 'finalize_student_portal_authority was unexpectedly accepted (expected % / %)',
    p_sqlstate, p_message;
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> p_sqlstate OR SQLERRM <> p_message THEN RAISE; END IF;
END
$$;

GRANT EXECUTE ON FUNCTION
  pg_temp.p194_id(INTEGER),
  pg_temp.p194_assert(BOOLEAN, TEXT),
  pg_temp.p194_expect_prepare_denied(UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, UUID, TEXT, TEXT),
  pg_temp.p194_expect_reissue_denied(UUID, BIGINT, BIGINT, UUID, TEXT, TEXT, TEXT),
  pg_temp.p194_expect_finalize_denied(UUID, BIGINT, BIGINT, TEXT, TEXT)
  TO authenticated, service_role;

SELECT 'P194_INVITE_CONFLICT_CODES_SUITE_START' AS p194_suite_marker;

-- ---------------------------------------------------------------------------
-- Seed: organization + canonical organization scope; admin; one Sales
-- membership with the own-scoped lead.sales.workflow.manage grant (the exact
-- 193 fixture, trimmed to one client/lead).
-- ---------------------------------------------------------------------------
INSERT INTO platform.organizations (id, name)
VALUES (pg_temp.p194_id(1), 'Migration 194 synthetic organization');

INSERT INTO platform.record_scopes (id, organization_id, scope_kind, scope_key, scope_version)
VALUES (pg_temp.p194_id(2), pg_temp.p194_id(1), 'organization', pg_temp.p194_id(1), 1);

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  (pg_temp.p194_id(101), 'p194-admin@example.invalid', '{}'::JSONB),
  (pg_temp.p194_id(102), 'p194-sales@example.invalid', '{}'::JSONB);

INSERT INTO platform.profiles (id, auth_user_id, display_name, status, access_version)
VALUES
  (pg_temp.p194_id(201), pg_temp.p194_id(101), 'P194 Admin', 'active', 1),
  (pg_temp.p194_id(202), pg_temp.p194_id(102), 'P194 Sales', 'active', 1);

INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status, "current_role", current_bundle_id,
  is_system_admin
) VALUES
  (
    pg_temp.p194_id(301), pg_temp.p194_id(1), pg_temp.p194_id(201), 'active',
    'admin',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'admin' AND status = 'published' ORDER BY version DESC LIMIT 1),
    TRUE
  ),
  (
    pg_temp.p194_id(302), pg_temp.p194_id(1), pg_temp.p194_id(202), 'active',
    'sales',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'sales' AND status = 'published' ORDER BY version DESC LIMIT 1),
    FALSE
  );

-- Live JWT claims via the CURRENT production hook -- never hand-built.
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p194_id(101),
  'claims', jsonb_build_object('sub', pg_temp.p194_id(101), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p194_admin_claims
\gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.p194_id(102),
  'claims', jsonb_build_object('sub', pg_temp.p194_id(102), 'role', 'authenticated')
)) -> 'claims')::TEXT AS p194_sales_claims
\gset

-- Own-scoped lead.sales.workflow.manage grant for the Sales membership (the
-- same 155 RPC surface the 185/193 suites exercise).
SET request.jwt.claims TO :'p194_admin_claims';
SET ROLE authenticated;
SELECT platform.staff_role_command(
  pg_temp.p194_id(1), pg_temp.p194_id(401), 0, 'create',
  jsonb_build_object(
    'label', 'P194 Sales lead workflow',
    'description', 'Migration 194 synthetic Sales lead-workflow role',
    'permissionKeys', jsonb_build_array('lead.sales.workflow.manage')
  ),
  'P194 create Sales lead-workflow role', pg_temp.p194_id(411)
) AS p194_role_created
\gset
SELECT platform.staff_role_impact(pg_temp.p194_id(1), pg_temp.p194_id(401), 1)
  ->> 'impactFingerprint' AS p194_role_impact_fingerprint
\gset
SELECT platform.staff_role_publish(
  pg_temp.p194_id(1), pg_temp.p194_id(401), 1,
  :'p194_role_impact_fingerprint', 'P194 publish Sales lead-workflow role',
  pg_temp.p194_id(412)
) AS p194_role_published
\gset
SELECT (:'p194_role_published'::JSONB ->> 'bundleId') AS p194_role_bundle_id
\gset
SELECT platform.staff_role_assignments_save(
  pg_temp.p194_id(1), pg_temp.p194_id(302), 1,
  jsonb_build_array(jsonb_build_object(
    'roleId', pg_temp.p194_id(401),
    'scope', jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)
  )),
  jsonb_build_array(jsonb_build_object(
    'roleId', pg_temp.p194_id(401), 'roleVersion', 2,
    'bundleId', :'p194_role_bundle_id'::UUID, 'bundleVersion', 1
  )),
  'P194 grant Sales lead workflow access', pg_temp.p194_id(413)
) = jsonb_build_object(
  'status', 'applied', 'membershipId', pg_temp.p194_id(302), 'accessVersion', 2
) AS p194_sales_granted
\gset
RESET ROLE;
SELECT pg_temp.p194_assert(
  :'p194_sales_granted'::BOOLEAN,
  'Sales did not receive the own-scoped lead.sales.workflow.manage grant'
);

-- One canonical client+lead pair owned by Sales.
INSERT INTO platform.clients (id, organization_id, display_name, normalized_name)
VALUES (pg_temp.p194_id(501), pg_temp.p194_id(1), 'P194 Invited Client', platform_private.normalize_person_name('P194 Invited Client'));
INSERT INTO platform.leads (
  id, organization_id, client_id, current_owner_membership_id, stage_key, source_key
) VALUES (pg_temp.p194_id(502), pg_temp.p194_id(1), pg_temp.p194_id(501), pg_temp.p194_id(302), 'new', 'website');

-- ===========================================================================
-- (i)+(ii) authenticated prepare: the repeat invite and the replay drift now
--          surface PT409 with unchanged messages; the byte-identical replay
--          and the single-receipt guarantee are intact.
-- ===========================================================================
SET request.jwt.claims TO :'p194_sales_claims';
SET ROLE authenticated;
SELECT platform.prepare_lead_cabinet_v1(
  pg_temp.p194_id(1), pg_temp.p194_id(801), pg_temp.p194_id(502)
)::TEXT AS p194_cabinet_prepared
\gset
SELECT (:'p194_cabinet_prepared'::JSONB ->> 'student_case_id')::UUID AS p194_case
\gset
SELECT platform.prepare_student_portal_provisioning(
  pg_temp.p194_id(1), :'p194_case', 'p194-invited@example.invalid',
  'P194 Invited Student', 'cabinet_pending', NULL,
  'P194 initial cabinet invite', pg_temp.p194_id(802)
)::TEXT AS p194_prepared
\gset
SELECT (:'p194_prepared'::JSONB ->> 'receipt_id')::UUID AS p194_receipt
\gset
SELECT pg_temp.p194_assert(
  :'p194_prepared'::JSONB ->> 'provisioning_state' = 'prepared'
  AND :'p194_prepared'::JSONB ->> 'replayed' = 'false',
  'the initial invite did not prepare a fresh receipt'
);

-- The byte-identical replay stays a durable replayed outcome (no error).
SELECT platform.prepare_student_portal_provisioning(
  pg_temp.p194_id(1), :'p194_case', 'p194-invited@example.invalid',
  'P194 Invited Student', 'cabinet_pending', NULL,
  'P194 initial cabinet invite', pg_temp.p194_id(802)
)::TEXT AS p194_prepared_replay
\gset
SELECT pg_temp.p194_assert(
  :'p194_prepared_replay'::JSONB ->> 'replayed' = 'true'
  AND (:'p194_prepared_replay'::JSONB ->> 'receipt_id')::UUID = :'p194_receipt',
  'the byte-identical prepare replay must return the SAME receipt'
);

-- The same request id with a drifted fingerprint: PT409, message unchanged.
SELECT pg_temp.p194_expect_prepare_denied(
  pg_temp.p194_id(1), :'p194_case', 'p194-drifted@example.invalid',
  'P194 Invited Student', 'cabinet_pending', NULL,
  'P194 initial cabinet invite', pg_temp.p194_id(802),
  'PT409', 'request_replay_conflict'
);

-- THE review scenario: a repeat invite (new request id) for a case that
-- already holds a receipt is a final PT409 conflict, not a retryable 40001.
SELECT pg_temp.p194_expect_prepare_denied(
  pg_temp.p194_id(1), :'p194_case', 'p194-reinvite@example.invalid',
  'P194 Reinvite Student', 'cabinet_pending', NULL,
  'P194 repeat invite for the reserved case', pg_temp.p194_id(803),
  'PT409', 'portal_case_already_reserved'
);
RESET ROLE;

SELECT pg_temp.p194_assert(
  (
    SELECT count(*) = 1
    FROM platform_private.student_portal_provisioning_receipts AS receipt
    WHERE receipt.student_case_id = :'p194_case'
  ),
  'the refused repeat invite must not create a duplicate receipt'
);
SELECT pg_temp.p194_assert(
  (
    SELECT receipt.provisioning_state = 'prepared'
    FROM platform_private.student_portal_provisioning_receipts AS receipt
    WHERE receipt.id = :'p194_receipt'
  ),
  'the refused repeat invite must leave the original receipt untouched'
);

-- ===========================================================================
-- (iii) authenticated reissue authorization: the fencing conflict is PT409.
-- ===========================================================================
SET request.jwt.claims TO :'p194_sales_claims';
SET ROLE authenticated;
SELECT pg_temp.p194_expect_reissue_denied(
  :'p194_receipt', 999, 0, pg_temp.p194_id(804),
  'P194 stale reissue authorization', 'PT409', 'stale_receipt_version'
);
RESET ROLE;

-- ===========================================================================
-- (iv) finalize: dispatch the invite exactly like the 193 suite (claim +
--      synthetic Auth row + record_success), then prove both fencing
--      conflicts are PT409 and that the refused finalizes wrote nothing.
-- ===========================================================================
SET ROLE service_role;
SELECT platform.claim_student_portal_invite(
  :'p194_receipt', pg_temp.p194_id(851), 1, 0
)::TEXT AS p194_claimed
\gset
RESET ROLE;
INSERT INTO auth.users (id, email, raw_user_meta_data, confirmation_sent_at)
VALUES (pg_temp.p194_id(910), 'p194-invited@example.invalid', '{}'::JSONB, statement_timestamp());
SET ROLE service_role;
SELECT platform.record_student_portal_invite_success(
  :'p194_receipt', pg_temp.p194_id(851), 2, 1, pg_temp.p194_id(910), 3600
)::TEXT AS p194_succeeded
\gset

SELECT pg_temp.p194_expect_finalize_denied(
  :'p194_receipt', 3, 999, 'PT409', 'stale_invite_generation'
);
SELECT pg_temp.p194_expect_finalize_denied(
  :'p194_receipt', 999, 1, 'PT409', 'stale_receipt_version'
);
RESET ROLE;

SELECT pg_temp.p194_assert(
  (
    SELECT receipt.provisioning_state = 'invite_succeeded'
      AND receipt.student_membership_id IS NULL
    FROM platform_private.student_portal_provisioning_receipts AS receipt
    WHERE receipt.id = :'p194_receipt'
  ),
  'the refused finalizes must leave the receipt awaiting a correct finalize'
);
SELECT pg_temp.p194_assert(
  (
    SELECT student_case.student_membership_id IS NULL
      AND student_case.portal_activated_at IS NULL
    FROM platform.student_cases AS student_case
    WHERE student_case.id = :'p194_case'
  ),
  'the refused finalizes must not bind or activate the case'
);
SELECT pg_temp.p194_assert(
  (
    SELECT count(*) = 1
    FROM platform_private.student_portal_provisioning_receipts AS receipt
    WHERE receipt.student_case_id = :'p194_case'
  ),
  'the dispatch flow must still hold exactly one receipt for the case'
);

SELECT 'P194_INVITE_CONFLICT_CODES_SUITE_PASSED' AS p194_suite_marker;

ROLLBACK;
