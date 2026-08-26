\set ON_ERROR_STOP on

BEGIN;

-- U8 uses only the disposable synthetic platform fixtures. The proof exercises
-- the real Postgres/Auth/RPC path and never contacts a bank, payment provider,
-- amoCRM, WhatsApp, WAHA, or a production database.

CREATE OR REPLACE FUNCTION pg_temp.assert_true(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'U8 assertion failed: %', p_message;
  END IF;
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.assert_true(BOOLEAN, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION pg_temp.u8_attempt_case_control(
  p_student_case_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  result JSONB;
BEGIN
  result := platform.staff_case_finance_control(p_student_case_id, 50);
  RETURN jsonb_build_object('ok', TRUE, 'result', result);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'ok', FALSE,
    'sqlstate', SQLSTATE,
    'message', SQLERRM
  );
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.u8_attempt_case_control(UUID)
  TO authenticated;

CREATE OR REPLACE FUNCTION pg_temp.u8_attempt_stop_create(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_payment_obligation_id UUID,
  p_owner_membership_id UUID,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  result JSONB;
BEGIN
  result := platform.create_stop_factor(
    p_organization_id,
    p_student_case_id,
    p_payment_obligation_id,
    p_owner_membership_id,
    'Unauthorized synthetic U8 stop',
    'application_submission',
    'Contact Finance',
    'synthetic:u8:unauthorized:evidence',
    p_request_id
  );
  RETURN jsonb_build_object('ok', TRUE, 'result', result);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'ok', FALSE,
    'sqlstate', SQLSTATE,
    'message', SQLERRM
  );
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.u8_attempt_stop_create(
  UUID,
  UUID,
  UUID,
  UUID,
  UUID
) TO authenticated;

CREATE OR REPLACE FUNCTION pg_temp.u8_attempt_stop_resolve(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_stop_factor_id UUID,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  result JSONB;
BEGIN
  result := platform.resolve_case_stop_factor(
    p_organization_id,
    p_student_case_id,
    p_stop_factor_id,
    'admin_override',
    NULL,
    'Unauthorized synthetic U8 clear',
    'synthetic:u8:unauthorized:clear:evidence',
    p_request_id
  );
  RETURN jsonb_build_object('ok', TRUE, 'result', result);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'ok', FALSE,
    'sqlstate', SQLSTATE,
    'message', SQLERRM
  );
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.u8_attempt_stop_resolve(
  UUID,
  UUID,
  UUID,
  UUID
) TO authenticated;

SELECT pg_temp.assert_true(
  has_function_privilege(
    'authenticated',
    'platform.staff_case_finance_control(uuid,integer)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'platform.staff_finance_control_queue(integer,uuid[])',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'platform.staff_case_finance_control(uuid,integer)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'platform.staff_finance_control_queue(integer,uuid[])',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'platform.staff_case_finance_control(uuid,integer)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'platform.staff_finance_control_queue(integer,uuid[])',
    'EXECUTE'
  ),
  'U8 read RPC grants must remain authenticated-only'
);

SELECT pg_temp.assert_true(
  (
    SELECT count(*) = 2
      AND bool_and(
        pg_get_userbyid(routine.proowner) = 'postgres'
        AND routine.prosecdef
        AND array_to_string(routine.proconfig, ',') = 'search_path=""'
      )
    FROM pg_proc AS routine
    JOIN pg_namespace AS namespace
      ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'platform'
      AND routine.proname IN (
        'staff_case_finance_control',
        'staff_finance_control_queue'
      )
  ),
  'U8 read RPC owner, security-definer, or empty search-path posture drifted'
);

SELECT
  student_case.organization_id AS org_a_id,
  student_case.id AS case_a_id,
  student_case.current_curator_membership_id AS curator_a_membership_id
FROM platform.student_cases AS student_case
WHERE student_case.source_key = 'synthetic:amocrm:lead:a'
\gset

SELECT student_case.id AS case_b_id
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

SELECT
  membership.id AS admin_a_membership_id,
  membership.current_bundle_id AS admin_a_bundle_id,
  bundle.version AS admin_a_bundle_version,
  profile.auth_user_id AS admin_a_user_id,
  profile.access_version AS admin_a_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile
  ON profile.id = membership.profile_id
JOIN platform.role_bundle_versions AS bundle
  ON bundle.id = membership.current_bundle_id
WHERE membership.organization_id = :'org_a_id'
  AND membership.status = 'active'
  AND membership."current_role" = 'admin'
ORDER BY membership.id
LIMIT 1
\gset

SELECT
  membership.id AS admin_b_membership_id,
  membership.current_bundle_id AS admin_b_bundle_id,
  bundle.version AS admin_b_bundle_version,
  profile.auth_user_id AS admin_b_user_id,
  profile.access_version AS admin_b_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile
  ON profile.id = membership.profile_id
JOIN platform.role_bundle_versions AS bundle
  ON bundle.id = membership.current_bundle_id
WHERE membership.organization_id = :'org_b_id'
  AND membership.status = 'active'
  AND membership."current_role" = 'admin'
ORDER BY membership.id
LIMIT 1
\gset

SELECT
  membership.current_bundle_id AS curator_a_bundle_id,
  bundle.version AS curator_a_bundle_version,
  profile.auth_user_id AS curator_a_user_id,
  profile.access_version AS curator_a_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile
  ON profile.id = membership.profile_id
JOIN platform.role_bundle_versions AS bundle
  ON bundle.id = membership.current_bundle_id
WHERE membership.organization_id = :'org_a_id'
  AND membership.id = :'curator_a_membership_id'
\gset

SELECT
  jsonb_build_object(
    'sub', :'admin_a_user_id',
    'role', 'authenticated',
    'platform_role', 'admin',
    'platform_access_version', :'admin_a_access_version'::BIGINT,
    'platform_organization_id', :'org_a_id',
    'platform_membership_id', :'admin_a_membership_id',
    'platform_bundle_id', :'admin_a_bundle_id',
    'platform_bundle_version', :'admin_a_bundle_version'::INTEGER
  )::TEXT AS admin_a_claims,
  jsonb_build_object(
    'sub', :'admin_b_user_id',
    'role', 'authenticated',
    'platform_role', 'admin',
    'platform_access_version', :'admin_b_access_version'::BIGINT,
    'platform_organization_id', :'org_b_id',
    'platform_membership_id', :'admin_b_membership_id',
    'platform_bundle_id', :'admin_b_bundle_id',
    'platform_bundle_version', :'admin_b_bundle_version'::INTEGER
  )::TEXT AS admin_b_claims,
  jsonb_build_object(
    'sub', :'curator_a_user_id',
    'role', 'authenticated',
    'platform_role', 'curator',
    'platform_access_version', :'curator_a_access_version'::BIGINT,
    'platform_organization_id', :'org_a_id',
    'platform_membership_id', :'curator_a_membership_id',
    'platform_bundle_id', :'curator_a_bundle_id',
    'platform_bundle_version', :'curator_a_bundle_version'::INTEGER
  )::TEXT AS curator_a_claims
\gset

\set u8_payment_grant_request '90000000-0000-4000-8000-000000000100'
\set u8_obligation_request '90000000-0000-4000-8000-000000000101'
\set u8_payment_request '90000000-0000-4000-8000-000000000102'
\set u8_stop_request '90000000-0000-4000-8000-000000000103'
\set u8_resolve_request '90000000-0000-4000-8000-000000000104'
\set u8_denied_stop_request '90000000-0000-4000-8000-000000000105'
\set u8_denied_resolve_request '90000000-0000-4000-8000-000000000106'
\set u8_wrong_case_resolve_request '90000000-0000-4000-8000-000000000107'

SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;

SELECT platform.change_membership_permission(
  :'org_a_id',
  :'admin_a_membership_id',
  'finance.first.payment.confirm',
  TRUE,
  'Synthetic U8 payment confirmer',
  :'u8_payment_grant_request'
);

RESET ROLE;

SELECT profile.access_version AS admin_a_access_version
FROM platform.profiles AS profile
WHERE profile.auth_user_id = :'admin_a_user_id'
\gset

SELECT jsonb_build_object(
  'sub', :'admin_a_user_id',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'admin_a_access_version'::BIGINT,
  'platform_organization_id', :'org_a_id',
  'platform_membership_id', :'admin_a_membership_id',
  'platform_bundle_id', :'admin_a_bundle_id',
  'platform_bundle_version', :'admin_a_bundle_version'::INTEGER
)::TEXT AS admin_a_claims
\gset

SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;

SELECT (
  platform.create_payment_obligation(
    :'org_a_id',
    :'case_a_id',
    'Synthetic U8 overdue installment',
    'evo_service_fee',
    125000,
    'KGS',
    transaction_timestamp() - INTERVAL '2 days',
    'Confirm the remaining installment',
    'Synthetic U8 schedule checkpoint',
    :'u8_obligation_request'
  ) ->> 'payment_obligation_id'
)::TEXT AS u8_obligation_id
\gset

SELECT (
  platform.record_payment_event(
    :'org_a_id',
    :'u8_obligation_id',
    'payment',
    NULL,
    25000,
    'KGS',
    transaction_timestamp() - INTERVAL '1 hour',
    'synthetic:u8:staff-confirmed-payment',
    'synthetic:u8:payment:evidence:private',
    'Synthetic U8 staff-confirmed partial payment',
    :'u8_payment_request'
  ) ->> 'payment_event_id'
)::TEXT AS u8_payment_event_id
\gset

SELECT (
  platform.create_stop_factor(
    :'org_a_id',
    :'case_a_id',
    :'u8_obligation_id',
    :'admin_a_membership_id',
    'Confirmed installment is still incomplete',
    'application_submission',
    'Confirm remaining installment or approve an override',
    'synthetic:u8:stop:evidence:private',
    :'u8_stop_request'
  ) ->> 'stop_factor_id'
)::TEXT AS u8_stop_factor_id
\gset

WITH control AS (
  SELECT platform.staff_case_finance_control(
    :'case_a_id',
    50
  ) AS payload
), u8_obligation AS (
  SELECT obligation
  FROM control
  CROSS JOIN LATERAL jsonb_array_elements(
    control.payload -> 'obligations'
  ) AS obligation
  WHERE obligation ->> 'payment_obligation_id' = :'u8_obligation_id'
)
SELECT pg_temp.assert_true(
  (
    SELECT array_agg(key ORDER BY key) = ARRAY[
      'history',
      'obligations',
      'organization_id',
      'student_case_id'
    ]::TEXT[]
    FROM control
    CROSS JOIN LATERAL jsonb_object_keys(control.payload) AS key
  )
  AND (
    SELECT count(*) = 1
      AND bool_and(
        (obligation ->> 'amount_minor')::BIGINT = 125000
        AND obligation ->> 'currency' = 'KGS'
        AND (obligation ->> 'total_paid_minor')::BIGINT = 25000
        AND (obligation ->> 'total_refunded_minor')::BIGINT = 0
        AND (obligation ->> 'outstanding_minor')::BIGINT = 100000
        AND obligation ->> 'derived_status' = 'overdue'
        AND (obligation ->> 'overdue')::BOOLEAN
        AND (obligation ->> 'payment_confirmation_count')::INTEGER = 1
        AND obligation ->> 'last_payment_at' IS NOT NULL
        AND jsonb_array_length(
          obligation -> 'active_stop_factors'
        ) = 1
        AND obligation #>> '{active_stop_factors,0,stop_factor_id}' =
          :'u8_stop_factor_id'
        AND obligation #>> '{active_stop_factors,0,blocked_action}' =
          'application_submission'
      )
    FROM u8_obligation
  )
  AND (
    SELECT count(*) = 3
    FROM control
    CROSS JOIN LATERAL jsonb_array_elements(
      control.payload -> 'history'
    ) AS history_event
    WHERE history_event ->> 'resource_id' IN (
      :'u8_obligation_id',
      :'u8_payment_event_id',
      :'u8_stop_factor_id'
    )
      AND history_event ->> 'action' IN (
        'finance.obligation.create',
        'finance.payment.record',
        'finance.stop.create'
      )
  )
  AND (
    SELECT payload::TEXT NOT LIKE '%synthetic:u8:%evidence:private%'
    FROM control
  ),
  'U8 case surface must derive overdue/payment/stop state and expose safe audit only'
);

SELECT active_stop_factor_count AS u8_queue_stop_count_before
FROM platform.staff_finance_control_queue(
  100,
  ARRAY[:'case_a_id']::UUID[]
)
WHERE organization_id = :'org_a_id'
  AND student_case_id = :'case_a_id'
\gset

SELECT pg_temp.assert_true(
  :'u8_queue_stop_count_before'::BIGINT >= 1
  AND EXISTS (
    SELECT 1
    FROM platform.staff_finance_control_queue(
      100,
      ARRAY[:'case_a_id']::UUID[]
    )
    WHERE organization_id = :'org_a_id'
      AND student_case_id = :'case_a_id'
      AND overdue_obligation_count >= 1
      AND outstanding_obligation_count >= 1
      AND active_stop_factor_count >= 1
      AND blocked_action = 'application_submission'
      AND stop_reason = 'Confirmed installment is still incomplete'
  ),
  'U8 Admin manager queue must expose overdue and explicit stop state'
);

RESET ROLE;
SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;

SELECT pg_temp.assert_true(
  (
    platform.staff_case_finance_control(:'case_a_id', 50)
      ->> 'organization_id'
  )::UUID = :'org_a_id'
  AND EXISTS (
    SELECT 1
    FROM platform.staff_finance_control_queue(
      100,
      ARRAY[:'case_a_id', :'case_b_id']::UUID[]
    )
    WHERE student_case_id = :'case_a_id'
      AND active_stop_factor_count >= 1
  )
  AND NOT EXISTS (
    SELECT 1
    FROM platform.staff_finance_control_queue(
      100,
      ARRAY[:'case_a_id', :'case_b_id']::UUID[]
    )
    WHERE student_case_id = :'case_b_id'
  ),
  'U8 assigned Curator must see own case finance control without another case'
);

SELECT pg_temp.assert_true(
  NOT (
    pg_temp.u8_attempt_stop_create(
      :'org_a_id',
      :'case_a_id',
      :'u8_obligation_id',
      :'admin_a_membership_id',
      :'u8_denied_stop_request'
    ) ->> 'ok'
  )::BOOLEAN,
  'U8 Curator must not assert a finance stop factor'
);

SELECT pg_temp.assert_true(
  NOT (
    pg_temp.u8_attempt_stop_resolve(
      :'org_a_id',
      :'case_a_id',
      :'u8_stop_factor_id',
      :'u8_denied_resolve_request'
    ) ->> 'ok'
  )::BOOLEAN,
  'U8 Curator must not clear a finance stop factor'
);

RESET ROLE;
SET request.jwt.claims TO :'admin_b_claims';
SET ROLE authenticated;

SELECT pg_temp.assert_true(
  NOT (
    pg_temp.u8_attempt_case_control(:'case_a_id') ->> 'ok'
  )::BOOLEAN
  AND NOT EXISTS (
    SELECT 1
    FROM platform.staff_finance_control_queue(
      100,
      ARRAY[:'case_a_id', :'case_b_id']::UUID[]
    )
    WHERE organization_id = :'org_a_id'
      OR student_case_id IN (:'case_a_id', :'case_b_id')
  ),
  'U8 cross-organization case and queue reads must fail without leakage'
);

RESET ROLE;
SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;

SELECT pg_temp.assert_true(
  NOT (
    pg_temp.u8_attempt_stop_resolve(
      :'org_a_id',
      :'case_b_id',
      :'u8_stop_factor_id',
      :'u8_wrong_case_resolve_request'
    ) ->> 'ok'
  )::BOOLEAN,
  'U8 exact-case stop resolution must reject a same-tenant case mismatch'
);

SELECT (
  platform.resolve_case_stop_factor(
    :'org_a_id',
    :'case_a_id',
    :'u8_stop_factor_id',
    'admin_override',
    NULL,
    'Synthetic U8 approved operational override',
    'synthetic:u8:override:evidence:private',
    :'u8_resolve_request'
  ) ->> 'stop_factor_id'
)::TEXT AS u8_resolved_stop_factor_id
\gset

SELECT (
  platform.resolve_case_stop_factor(
    :'org_a_id',
    :'case_a_id',
    :'u8_stop_factor_id',
    'admin_override',
    NULL,
    'Synthetic U8 approved operational override',
    'synthetic:u8:override:evidence:private',
    :'u8_resolve_request'
  ) ->> 'stop_factor_id'
)::TEXT AS u8_replayed_resolved_stop_factor_id
\gset

WITH control AS (
  SELECT platform.staff_case_finance_control(
    :'case_a_id',
    50
  ) AS payload
), u8_obligation AS (
  SELECT obligation
  FROM control
  CROSS JOIN LATERAL jsonb_array_elements(
    control.payload -> 'obligations'
  ) AS obligation
  WHERE obligation ->> 'payment_obligation_id' = :'u8_obligation_id'
)
SELECT pg_temp.assert_true(
  :'u8_resolved_stop_factor_id' = :'u8_stop_factor_id'
  AND :'u8_replayed_resolved_stop_factor_id' = :'u8_stop_factor_id'
  AND (
    SELECT jsonb_array_length(
      obligation -> 'active_stop_factors'
    ) = 0
    FROM u8_obligation
  )
  AND (
    SELECT count(*) = 1
    FROM control
    CROSS JOIN LATERAL jsonb_array_elements(
      control.payload -> 'history'
    ) AS history_event
    WHERE history_event ->> 'action' = 'finance.stop.resolve'
      AND history_event ->> 'resource_id' = :'u8_stop_factor_id'
  )
  AND (
    SELECT payload::TEXT NOT LIKE '%synthetic:u8:%evidence:private%'
    FROM control
  ),
  'U8 Admin clear must remove the active stop and retain safe audit history'
);

SELECT pg_temp.assert_true(
  (
    SELECT active_stop_factor_count =
      :'u8_queue_stop_count_before'::BIGINT - 1
    FROM platform.staff_finance_control_queue(
      100,
      ARRAY[:'case_a_id']::UUID[]
    )
    WHERE organization_id = :'org_a_id'
      AND student_case_id = :'case_a_id'
  ),
  'U8 queue stop count must update after the audited clear'
);

SELECT pg_temp.assert_true(
  jsonb_array_length(
    platform.staff_case_finance_control(:'case_a_id', 1) -> 'history'
  ) = 1,
  'U8 finance history limit must be enforced'
);

RESET ROLE;
ROLLBACK;
