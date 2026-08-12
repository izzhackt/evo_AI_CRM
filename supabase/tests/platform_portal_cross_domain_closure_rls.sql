\set ON_ERROR_STOP on

-- P6D reuses only synthetic two-organization fixtures from the earlier
-- authorization suites. All added visa/payment events roll back.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'P6D assertion failed: %', p_message;
  END IF;
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.assert_true(BOOLEAN, TEXT)
  TO authenticated;

SELECT pg_temp.assert_true(
  has_function_privilege(
    'authenticated',
    'platform.staff_case_visa(uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'platform.staff_case_finance(uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'platform.settle_payment_obligation(uuid,uuid,uuid,text,text,text,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'platform.staff_case_visa(uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'platform.staff_case_finance(uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'platform.settle_payment_obligation(uuid,uuid,uuid,text,text,text,uuid)',
    'EXECUTE'
  ),
  'P6D RPC grants must remain authenticated-only'
);

SELECT pg_temp.assert_true(
  position(
    'FROM platform.student_cases AS student_case' IN
    pg_get_functiondef(
      'platform.settle_payment_obligation(uuid,uuid,uuid,text,text,text,uuid)'::REGPROCEDURE
    )
  ) > 0
  AND position(
    'FROM platform.student_cases AS student_case' IN
    pg_get_functiondef(
      'platform.settle_payment_obligation(uuid,uuid,uuid,text,text,text,uuid)'::REGPROCEDURE
    )
  ) < position(
    'FROM platform.payment_obligations AS obligation' IN
    pg_get_functiondef(
      'platform.settle_payment_obligation(uuid,uuid,uuid,text,text,text,uuid)'::REGPROCEDURE
    )
  ),
  'settlement must preserve the accepted case-before-obligation lock order'
);

SELECT
  student_case.organization_id AS org_a_id,
  student_case.id AS case_a_id,
  student_case.current_curator_membership_id AS curator_a_membership_id
FROM platform.student_cases AS student_case
WHERE student_case.source_key = 'synthetic:amocrm:lead:a'
\gset

SELECT
  student_case.id AS case_b_id,
  student_case.current_curator_membership_id AS curator_b_membership_id
FROM platform.student_cases AS student_case
WHERE student_case.organization_id = :'org_a_id'
  AND student_case.source_key = 'synthetic:amocrm:lead:b'
\gset

SELECT
  student_case.organization_id AS org_b_id,
  student_case.id AS org_b_case_id
FROM platform.student_cases AS student_case
WHERE student_case.source_key = 'synthetic:amocrm:lead:org-b'
\gset

SELECT obligation.id AS obligation_a_id
FROM platform.payment_obligations AS obligation
WHERE obligation.organization_id = :'org_a_id'
  AND obligation.student_case_id = :'case_a_id'
  AND obligation.label = 'EVO synthetic service fee'
\gset

SELECT obligation.id AS obligation_b_id
FROM platform.payment_obligations AS obligation
WHERE obligation.organization_id = :'org_a_id'
  AND obligation.student_case_id = :'case_b_id'
  AND obligation.label = 'Synthetic third-party study cost'
\gset

SELECT
  membership.id AS admin_a_membership_id,
  profile.auth_user_id AS admin_a_user_id,
  profile.access_version AS admin_a_access_version,
  (
    SELECT (audit.before_state ->> 'access_version')::BIGINT
    FROM platform.audit_events AS audit
    WHERE audit.action = 'rbac.bundle.upgrade'
      AND audit.resource_id = membership.id
      AND audit.actor_principal =
        'migration:043_platform_documents_finance_notifications'
  ) AS admin_a_stale_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE membership.organization_id = :'org_a_id'
  AND membership.status = 'active'
  AND membership."current_role" = 'admin'
ORDER BY membership.id
LIMIT 1
\gset

SELECT
  profile.auth_user_id AS admin_b_user_id,
  profile.access_version AS admin_b_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE membership.organization_id = :'org_b_id'
  AND membership.status = 'active'
  AND membership."current_role" = 'admin'
ORDER BY membership.id
LIMIT 1
\gset

SELECT
  profile.auth_user_id AS curator_a_user_id,
  profile.access_version AS curator_a_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE membership.organization_id = :'org_a_id'
  AND membership.id = :'curator_a_membership_id'
\gset

SELECT
  profile.auth_user_id AS curator_b_user_id,
  profile.access_version AS curator_b_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE membership.organization_id = :'org_a_id'
  AND membership.id = :'curator_b_membership_id'
\gset

SELECT
  profile.auth_user_id AS previous_curator_user_id,
  profile.access_version AS previous_curator_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE membership.organization_id = :'org_a_id'
  AND profile.auth_user_id = '10000000-0000-4000-8000-000000000003'
\gset

SELECT
  profile.auth_user_id AS sales_a_user_id,
  profile.access_version AS sales_a_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE membership.organization_id = :'org_a_id'
  AND profile.auth_user_id = '42000000-0000-4000-8000-000000000002'
\gset

SELECT
  membership.id AS finance_a_membership_id,
  profile.auth_user_id AS finance_a_user_id,
  profile.access_version AS finance_a_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE membership.organization_id = :'org_a_id'
  AND membership.status = 'active'
  AND membership."current_role" = 'finance'
ORDER BY membership.id
LIMIT 1
\gset

SELECT
  profile.auth_user_id AS student_a_user_id,
  profile.access_version AS student_a_access_version
FROM platform.student_cases AS student_case
JOIN platform.organization_memberships AS membership
  ON membership.organization_id = student_case.organization_id
  AND membership.id = student_case.student_membership_id
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE student_case.id = :'case_a_id'
\gset

SELECT jsonb_build_object(
  'sub', :'admin_a_user_id', 'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'admin_a_access_version'::BIGINT
)::TEXT AS admin_a_claims,
jsonb_build_object(
  'sub', :'admin_a_user_id', 'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'admin_a_stale_access_version'::BIGINT
)::TEXT AS admin_a_stale_claims,
jsonb_build_object(
  'sub', :'admin_b_user_id', 'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'admin_b_access_version'::BIGINT
)::TEXT AS admin_b_claims,
jsonb_build_object(
  'sub', :'curator_a_user_id', 'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', :'curator_a_access_version'::BIGINT
)::TEXT AS curator_a_claims,
jsonb_build_object(
  'sub', :'curator_b_user_id', 'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', :'curator_b_access_version'::BIGINT
)::TEXT AS curator_b_claims,
jsonb_build_object(
  'sub', :'previous_curator_user_id', 'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', :'previous_curator_access_version'::BIGINT
)::TEXT AS previous_curator_claims,
jsonb_build_object(
  'sub', :'sales_a_user_id', 'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', :'sales_a_access_version'::BIGINT
)::TEXT AS sales_a_claims,
jsonb_build_object(
  'sub', :'finance_a_user_id', 'role', 'authenticated',
  'platform_role', 'finance',
  'platform_access_version', :'finance_a_access_version'::BIGINT
)::TEXT AS finance_a_claims,
jsonb_build_object(
  'sub', :'student_a_user_id', 'role', 'authenticated',
  'platform_role', 'student',
  'platform_access_version', :'student_a_access_version'::BIGINT
)::TEXT AS student_a_claims
\gset

-- The assigned Curator reads only the exact visa and safe finance row for
-- Student A. The fixed DTO keys exclude private evidence and all provider/amo
-- identifiers.
SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (
    SELECT count(*) = 1
      AND bool_and(case_id = :'case_a_id')
      AND bool_and(visa_status = 'approved')
      AND bool_and(note = 'External decision evidence recorded')
    FROM platform.staff_case_visa(:'case_a_id')
  )
  AND NOT EXISTS (SELECT 1 FROM platform.staff_case_visa(:'case_b_id'))
  AND (
    SELECT count(*) = 1
      AND bool_and(case_id = :'case_a_id')
      AND bool_and(payment_obligation_id = :'obligation_a_id')
      AND bool_and(outstanding_minor = 6000)
    FROM platform.staff_case_finance(:'case_a_id')
  )
  AND NOT EXISTS (SELECT 1 FROM platform.staff_case_finance(:'case_b_id')),
  'assigned Curator A read or same-organization object isolation failed'
);
SELECT pg_temp.assert_true(
  (
    SELECT array_agg(key ORDER BY key) = ARRAY[
      'case_id', 'note', 'updated_at', 'visa_case_id', 'visa_status'
    ]::TEXT[]
    FROM platform.staff_case_visa(:'case_a_id') AS row_value
    CROSS JOIN LATERAL
      jsonb_object_keys(to_jsonb(row_value)) AS object_key(key)
  )
  AND (
    SELECT array_agg(key ORDER BY key) = ARRAY[
      'amount_minor', 'case_id', 'category', 'currency', 'derived_status',
      'due_at', 'next_action', 'obligation_label', 'outstanding_minor',
      'overdue', 'payment_obligation_id'
    ]::TEXT[]
    FROM platform.staff_case_finance(:'case_a_id') AS row_value
    CROSS JOIN LATERAL
      jsonb_object_keys(to_jsonb(row_value)) AS object_key(key)
  ),
  'P6D staff DTO exposed an unexpected evidence/provider key'
);
RESET ROLE;

SET request.jwt.claims TO :'previous_curator_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  NOT EXISTS (SELECT 1 FROM platform.staff_case_visa(:'case_a_id'))
  AND NOT EXISTS (SELECT 1 FROM platform.staff_case_finance(:'case_a_id')),
  'previous/unassigned Curator retained P6D object access'
);
RESET ROLE;

SET request.jwt.claims TO :'sales_a_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  NOT EXISTS (SELECT 1 FROM platform.staff_case_visa(:'case_a_id'))
  AND NOT EXISTS (SELECT 1 FROM platform.staff_case_finance(:'case_a_id')),
  'post-handoff Sales retained P6D object access'
);
RESET ROLE;

SET request.jwt.claims TO :'admin_a_stale_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  NOT EXISTS (SELECT 1 FROM platform.staff_case_visa(:'case_a_id'))
  AND NOT EXISTS (SELECT 1 FROM platform.staff_case_finance(:'case_a_id')),
  'stale access-version claim retained P6D read authority'
);
SAVEPOINT expect_stale_settlement_denied;
\set ON_ERROR_STOP off
SELECT platform.settle_payment_obligation(
  :'org_a_id', :'case_a_id', :'obligation_a_id',
  'synthetic:p6d:stale', 'synthetic:p6d:evidence:stale',
  'Synthetic P6D stale-claim denial',
  '47000000-0000-4000-8000-000000000013'
);
\set settle_stale_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_stale_settlement_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_stale_settlement_denied;
SELECT pg_temp.assert_true(
  :'settle_stale_state' = '42501',
  'stale access-version claim retained P6D mutation authority'
);
RESET ROLE;

SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  NOT EXISTS (SELECT 1 FROM platform.staff_case_visa(NULL))
  AND NOT EXISTS (SELECT 1 FROM platform.staff_case_finance(NULL)),
  'malformed null case returned P6D data'
);
SAVEPOINT expect_null_case_settlement_denied;
\set ON_ERROR_STOP off
SELECT platform.settle_payment_obligation(
  :'org_a_id', NULL, :'obligation_a_id',
  'synthetic:p6d:null-case', 'synthetic:p6d:evidence:null-case',
  'Synthetic P6D malformed-object denial',
  '47000000-0000-4000-8000-000000000014'
);
\set settle_null_case_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_null_case_settlement_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_null_case_settlement_denied;
SELECT pg_temp.assert_true(
  :'settle_null_case_state' = '22023',
  'malformed null case reached the P6D ledger'
);
RESET ROLE;

-- Preserve immutable history while proving that an already-authorized direct
-- writer cannot make the browser projection emit oversized/control text.
SELECT visa.id AS visa_a_id
FROM platform.visa_cases AS visa
WHERE visa.organization_id = :'org_a_id'
  AND visa.student_case_id = :'case_a_id'
\gset
INSERT INTO platform.visa_case_events (
  organization_id, visa_case_id, student_case_id, previous_status, new_status,
  evidence_reference, note, actor_membership_id, request_id
) VALUES (
  :'org_a_id', :'visa_a_id', :'case_a_id', 'approved', 'docs',
  'synthetic:p6d:unsafe-note-evidence', repeat('x', 4001),
  :'curator_a_membership_id', '47000000-0000-4000-8000-000000000010'
);
SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (SELECT note IS NULL FROM platform.staff_case_visa(:'case_a_id') LIMIT 1),
  'P6D visa projection emitted an oversized private note'
);
RESET ROLE;

INSERT INTO platform.visa_case_events (
  organization_id, visa_case_id, student_case_id, previous_status, new_status,
  evidence_reference, note, actor_membership_id, request_id
) VALUES (
  :'org_a_id', :'visa_a_id', :'case_a_id', 'docs', 'approved',
  'synthetic:p6d:unsafe-control-evidence', E'unsafe\ncontrol',
  :'curator_a_membership_id', '47000000-0000-4000-8000-000000000012'
);
SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (SELECT note IS NULL FROM platform.staff_case_visa(:'case_a_id') LIMIT 1),
  'P6D visa projection emitted a control-bearing private note'
);
RESET ROLE;

-- The obligation identity is correctly immutable, so exercise the reader with
-- a separate transaction-local synthetic row instead of weakening or
-- disabling that production guard.
SAVEPOINT unsafe_finance_projection_fixture;
SELECT gen_random_uuid()::TEXT AS unsafe_obligation_id
\gset
INSERT INTO platform.payment_obligations (
  id, organization_id, student_case_id, label, category,
  amount_minor, currency, due_at, next_action, created_by_membership_id
) VALUES (
  :'unsafe_obligation_id', :'org_a_id', :'case_a_id', E'unsafe\nlabel',
  'evo_service_fee', 100, 'KGS', transaction_timestamp() + INTERVAL '1 day',
  repeat('n', 1001),
  (
    SELECT membership.id
    FROM platform.organization_memberships AS membership
    WHERE membership.organization_id = :'org_a_id'
      AND membership.status = 'active'
      AND membership."current_role" = 'finance'
    ORDER BY membership.id
    LIMIT 1
  )
);
SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (
    SELECT obligation_label = 'Payment obligation'
      AND next_action = 'Contact Finance'
    FROM platform.staff_case_finance(:'case_a_id')
    WHERE payment_obligation_id = :'unsafe_obligation_id'
  ),
  'P6D finance projection emitted unbounded/control-bearing text'
);
RESET ROLE;
ROLLBACK TO SAVEPOINT unsafe_finance_projection_fixture;
RELEASE SAVEPOINT unsafe_finance_projection_fixture;

-- The second assigned Curator can create and read only Student B's visa.
SET request.jwt.claims TO :'curator_b_claims';
SET ROLE authenticated;
SELECT (
  platform.create_visa_case(
    :'org_a_id',
    :'case_b_id',
    'docs',
    'synthetic:p6d:visa-b-evidence',
    'Synthetic P6D Student B visa documents',
    '47000000-0000-4000-8000-000000000001'
  ) ->> 'visa_case_id'
)::TEXT AS visa_b_id
\gset
SELECT pg_temp.assert_true(
  (
    SELECT count(*) = 1
      AND bool_and(visa_case_id = :'visa_b_id')
      AND bool_and(case_id = :'case_b_id')
      AND bool_and(visa_status = 'docs')
    FROM platform.staff_case_visa(:'case_b_id')
  )
  AND NOT EXISTS (SELECT 1 FROM platform.staff_case_visa(:'case_a_id'))
  AND (
    SELECT count(*) = 1
      AND bool_and(payment_obligation_id = :'obligation_b_id')
      AND bool_and(outstanding_minor = 500)
    FROM platform.staff_case_finance(:'case_b_id')
  )
  AND NOT EXISTS (SELECT 1 FROM platform.staff_case_finance(:'case_a_id')),
  'assigned Curator B mutation/read or same-organization isolation failed'
);
RESET ROLE;

-- Admin A sees both exact cases; organization-B Admin, Student and Finance
-- cannot turn a case identifier into visa access.
SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM platform.staff_case_visa(:'case_a_id')) = 1
  AND (SELECT count(*) FROM platform.staff_case_visa(:'case_b_id')) = 1
  AND (SELECT count(*) FROM platform.staff_case_finance(:'case_a_id')) = 1
  AND (SELECT count(*) FROM platform.staff_case_finance(:'case_b_id')) = 1,
  'organization-A Admin did not receive both exact-case projections'
);
RESET ROLE;

SET request.jwt.claims TO :'admin_b_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  NOT EXISTS (SELECT 1 FROM platform.staff_case_visa(:'case_a_id'))
  AND NOT EXISTS (SELECT 1 FROM platform.staff_case_finance(:'case_a_id')),
  'organization-B Admin crossed the P6D tenant boundary'
);
RESET ROLE;

SET request.jwt.claims TO :'student_a_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  NOT EXISTS (SELECT 1 FROM platform.staff_case_visa(:'case_a_id'))
  AND NOT EXISTS (SELECT 1 FROM platform.staff_case_finance(:'case_a_id')),
  'Student received a P6D staff projection'
);
RESET ROLE;

SET request.jwt.claims TO :'finance_a_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  NOT EXISTS (SELECT 1 FROM platform.staff_case_visa(:'case_a_id'))
  AND (SELECT count(*) FROM platform.staff_case_finance(:'case_a_id')) = 1
  AND (SELECT count(*) FROM platform.staff_case_finance(:'case_b_id')) = 1,
  'Finance visa denial or organization-scoped finance read failed'
);

-- Wrong same-organization case binding and unrelated organization fail before
-- any ledger side effect. Client-supplied amount/currency/time do not exist in
-- this contract.
SAVEPOINT expect_wrong_case_settlement_denied;
\set ON_ERROR_STOP off
SELECT platform.settle_payment_obligation(
  :'org_a_id', :'case_b_id', :'obligation_a_id',
  'synthetic:p6d:wrong-case', 'synthetic:p6d:evidence:wrong-case',
  'Synthetic P6D wrong-case denial',
  '47000000-0000-4000-8000-000000000002'
);
\set settle_wrong_case_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_wrong_case_settlement_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_wrong_case_settlement_denied;

SAVEPOINT expect_cross_org_settlement_denied;
\set ON_ERROR_STOP off
SELECT platform.settle_payment_obligation(
  :'org_b_id', :'org_b_case_id', :'obligation_a_id',
  'synthetic:p6d:cross-org', 'synthetic:p6d:evidence:cross-org',
  'Synthetic P6D cross-organization denial',
  '47000000-0000-4000-8000-000000000003'
);
\set settle_cross_org_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_cross_org_settlement_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_cross_org_settlement_denied;

SAVEPOINT expect_missing_evidence_settlement_denied;
\set ON_ERROR_STOP off
SELECT platform.settle_payment_obligation(
  :'org_a_id', :'case_a_id', :'obligation_a_id',
  'synthetic:p6d:missing-evidence', '',
  'Synthetic P6D missing-evidence denial',
  '47000000-0000-4000-8000-000000000004'
);
\set settle_missing_evidence_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_missing_evidence_settlement_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_missing_evidence_settlement_denied;

SAVEPOINT expect_control_settlement_denied;
\set ON_ERROR_STOP off
SELECT platform.settle_payment_obligation(
  :'org_a_id', :'case_a_id', :'obligation_a_id',
  E'synthetic:p6d:unsafe\nsource', 'synthetic:p6d:evidence:unsafe',
  'Synthetic P6D control denial',
  '47000000-0000-4000-8000-000000000011'
);
\set settle_control_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_control_settlement_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_control_settlement_denied;

SAVEPOINT expect_oversized_settlement_denied;
\set ON_ERROR_STOP off
SELECT platform.settle_payment_obligation(
  :'org_a_id', :'case_a_id', :'obligation_a_id',
  repeat('s', 513), 'synthetic:p6d:evidence:oversized',
  'Synthetic P6D oversized-source denial',
  '47000000-0000-4000-8000-000000000015'
);
\set settle_oversized_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_oversized_settlement_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_oversized_settlement_denied;

SELECT platform.settle_payment_obligation(
  :'org_a_id', :'case_a_id', :'obligation_a_id',
  'synthetic:p6d:settlement:a', 'synthetic:p6d:evidence:settlement:a',
  'Synthetic P6D full settlement',
  '47000000-0000-4000-8000-000000000005'
)::TEXT AS settlement_a_first
\gset
SELECT platform.settle_payment_obligation(
  :'org_a_id', :'case_a_id', :'obligation_a_id',
  'synthetic:p6d:settlement:a', 'synthetic:p6d:evidence:settlement:a',
  'Synthetic P6D full settlement',
  '47000000-0000-4000-8000-000000000005'
)::TEXT AS settlement_a_replay
\gset

SELECT pg_temp.assert_true(
  :'settle_wrong_case_state' = '42501'
  AND :'settle_cross_org_state' = '42501'
  AND :'settle_missing_evidence_state' = '22023'
  AND :'settle_control_state' = '22023'
  AND :'settle_oversized_state' = '22023'
  AND :'settlement_a_first' = :'settlement_a_replay'
  AND (:'settlement_a_first'::JSONB ->> 'student_case_id')::UUID = :'case_a_id'
  AND (:'settlement_a_first'::JSONB ->> 'amount_minor')::BIGINT = 6000
  AND (:'settlement_a_first'::JSONB ->> 'currency') = 'KGS'
  AND (
    SELECT array_agg(key ORDER BY key) = ARRAY[
      'amount_minor', 'currency', 'event_type', 'organization_id',
      'payment_event_id', 'payment_obligation_id', 'student_case_id',
      'total_paid_minor', 'total_refunded_minor'
    ]::TEXT[]
    FROM jsonb_object_keys(:'settlement_a_first'::JSONB) AS object_key(key)
  )
  AND (
    SELECT total_paid_minor = 12000 AND total_refunded_minor = 2000
    FROM platform.payment_obligations
    WHERE organization_id = :'org_a_id'
      AND student_case_id = :'case_a_id'
      AND id = :'obligation_a_id'
  )
  AND (
    SELECT count(*) = 1
    FROM platform.payment_evidence
    WHERE organization_id = :'org_a_id'
      AND student_case_id = :'case_a_id'
      AND payment_obligation_id = :'obligation_a_id'
      AND evidence_ref = 'synthetic:p6d:evidence:settlement:a'
  ),
  'database-derived settlement, replay, safe receipt or evidence failed'
);

-- A refund reopens the balance. Replaying the old settlement must not consume
-- it; a fresh request settles only the exact newly outstanding amount.
SELECT (
  platform.record_payment_event(
    :'org_a_id', :'obligation_a_id', 'refund',
    (:'settlement_a_first'::JSONB ->> 'payment_event_id')::UUID,
    1000, 'KGS', transaction_timestamp(),
    'synthetic:p6d:refund:a', 'synthetic:p6d:evidence:refund:a',
    'Synthetic P6D reopened balance',
    '47000000-0000-4000-8000-000000000006'
  ) ->> 'payment_event_id'
)::TEXT AS settlement_refund_id
\gset

SELECT platform.settle_payment_obligation(
  :'org_a_id', :'case_a_id', :'obligation_a_id',
  'synthetic:p6d:settlement:a', 'synthetic:p6d:evidence:settlement:a',
  'Synthetic P6D full settlement',
  '47000000-0000-4000-8000-000000000005'
)::TEXT AS settlement_a_after_refund_replay
\gset

SELECT pg_temp.assert_true(
  :'settlement_a_after_refund_replay' = :'settlement_a_first'
  AND (
    SELECT amount_minor - (total_paid_minor - total_refunded_minor) = 1000
    FROM platform.payment_obligations
    WHERE organization_id = :'org_a_id'
      AND student_case_id = :'case_a_id'
      AND id = :'obligation_a_id'
  ),
  'old request settled a later reopened balance'
);

SELECT platform.settle_payment_obligation(
  :'org_a_id', :'case_a_id', :'obligation_a_id',
  'synthetic:p6d:settlement:a:reopened',
  'synthetic:p6d:evidence:settlement:a:reopened',
  'Synthetic P6D reopened balance settlement',
  '47000000-0000-4000-8000-000000000007'
)::TEXT AS settlement_a_reopened
\gset

SAVEPOINT expect_empty_settlement_denied;
\set ON_ERROR_STOP off
SELECT platform.settle_payment_obligation(
  :'org_a_id', :'case_a_id', :'obligation_a_id',
  'synthetic:p6d:settlement:a:empty',
  'synthetic:p6d:evidence:settlement:a:empty',
  'Synthetic P6D already-settled denial',
  '47000000-0000-4000-8000-000000000008'
);
\set settle_empty_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_empty_settlement_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_empty_settlement_denied;

SELECT pg_temp.assert_true(
  (:'settlement_a_reopened'::JSONB ->> 'amount_minor')::BIGINT = 1000
  AND :'settle_empty_state' = '22023'
  AND (
    SELECT amount_minor - (total_paid_minor - total_refunded_minor) = 0
    FROM platform.payment_obligations
    WHERE organization_id = :'org_a_id'
      AND student_case_id = :'case_a_id'
      AND id = :'obligation_a_id'
  ),
  'fresh reopened-balance settlement or empty-balance denial failed'
);
RESET ROLE;

-- Curator cannot settle finance even when assigned to the exact case.
SET request.jwt.claims TO :'curator_b_claims';
SET ROLE authenticated;
SAVEPOINT expect_curator_settlement_denied;
\set ON_ERROR_STOP off
SELECT platform.settle_payment_obligation(
  :'org_a_id', :'case_b_id', :'obligation_b_id',
  'synthetic:p6d:curator-settle', 'synthetic:p6d:evidence:curator-settle',
  'Synthetic P6D Curator finance denial',
  '47000000-0000-4000-8000-000000000009'
);
\set curator_settle_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_curator_settlement_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_curator_settlement_denied;
SELECT pg_temp.assert_true(
  :'curator_settle_state' = '42501'
  AND (
    SELECT outstanding_minor = 500
    FROM platform.staff_case_finance(:'case_b_id')
    WHERE payment_obligation_id = :'obligation_b_id'
  ),
  'assigned Curator gained finance mutation authority'
);
RESET ROLE;

ROLLBACK;
\echo 'P6D Portal cross-domain closure/RLS acceptance passed'
