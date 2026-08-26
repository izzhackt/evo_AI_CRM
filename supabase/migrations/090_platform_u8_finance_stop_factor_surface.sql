BEGIN;

-- U8 adds bounded read models over the canonical P2E finance ledger. It does
-- not add a second payment store, infer bank/accounting state, or weaken the
-- existing audited mutation functions.

CREATE OR REPLACE FUNCTION platform.staff_case_finance_control(
  p_student_case_id UUID,
  p_history_limit INTEGER DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_organization_id UUID;
  obligations_payload JSONB;
  history_payload JSONB;
BEGIN
  IF p_student_case_id IS NULL
    OR p_history_limit IS NULL
    OR p_history_limit NOT BETWEEN 1 AND 100
  THEN
    RAISE EXCEPTION
      'Student case and history limit from 1 to 100 are required'
      USING ERRCODE = '22023';
  END IF;

  -- Resolve the case and authority together so a missing case and a case from
  -- another tenant fail through the same non-enumerating boundary.
  SELECT student_case.organization_id
  INTO target_organization_id
  FROM platform.student_cases AS student_case
  WHERE student_case.id = p_student_case_id
    AND (
      private.platform_can_read_finance_full(
        student_case.organization_id
      )
      OR (
        private.platform_can_read_student_case(
          student_case.organization_id,
          student_case.id
        )
        AND private.platform_has_permission(
          student_case.organization_id,
          'finance.read.summary'
        )
      )
    )
  LIMIT 1;

  IF target_organization_id IS NULL THEN
    RAISE EXCEPTION
      'Student case finance control is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'payment_obligation_id', obligation.id,
        'label', CASE
          WHEN char_length(obligation.label) <= 500
            AND obligation.label !~ '[[:cntrl:]]'
          THEN obligation.label
          ELSE 'Payment obligation'
        END,
        'category', obligation.category,
        'amount_minor', obligation.amount_minor,
        'currency', obligation.currency,
        'due_at', obligation.due_at,
        'total_paid_minor', obligation.total_paid_minor,
        'total_refunded_minor', obligation.total_refunded_minor,
        'outstanding_minor', obligation.amount_minor - (
          obligation.total_paid_minor - obligation.total_refunded_minor
        ),
        'derived_status', platform_private.derive_obligation_status(
          obligation.amount_minor,
          obligation.total_paid_minor,
          obligation.total_refunded_minor,
          obligation.due_at,
          transaction_timestamp()
        ),
        'overdue', (
          obligation.due_at < transaction_timestamp()
          AND obligation.amount_minor - (
            obligation.total_paid_minor - obligation.total_refunded_minor
          ) > 0
        ),
        'next_action', CASE
          WHEN char_length(obligation.next_action) <= 1000
            AND obligation.next_action !~ '[[:cntrl:]]'
          THEN obligation.next_action
          ELSE 'Contact Finance'
        END,
        'payment_confirmation_count', payment_summary.confirmation_count,
        'last_payment_at', payment_summary.last_payment_at,
        'active_stop_factors', stop_summary.active_stop_factors
      )
      ORDER BY obligation.due_at, obligation.id
    ),
    '[]'::JSONB
  )
  INTO obligations_payload
  FROM platform.payment_obligations AS obligation
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (
        WHERE payment_event.event_type = 'payment'
      )::INTEGER AS confirmation_count,
      max(payment_event.occurred_at) FILTER (
        WHERE payment_event.event_type = 'payment'
      ) AS last_payment_at
    FROM platform.payment_events AS payment_event
    WHERE payment_event.organization_id = obligation.organization_id
      AND payment_event.student_case_id = obligation.student_case_id
      AND payment_event.payment_obligation_id = obligation.id
  ) AS payment_summary ON TRUE
  LEFT JOIN LATERAL (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'stop_factor_id', stop_factor.id,
          'reason', CASE
            WHEN char_length(stop_factor.reason) <= 1000
              AND stop_factor.reason !~ '[[:cntrl:]]'
            THEN stop_factor.reason
            ELSE 'Finance stop factor'
          END,
          'blocked_action', CASE
            WHEN char_length(stop_factor.blocked_action) <= 200
              AND stop_factor.blocked_action !~ '[[:cntrl:]]'
            THEN stop_factor.blocked_action
            ELSE 'downstream_case_progress'
          END,
          'next_action', CASE
            WHEN char_length(stop_factor.next_action) <= 1000
              AND stop_factor.next_action !~ '[[:cntrl:]]'
            THEN stop_factor.next_action
            ELSE 'Contact Finance'
          END,
          'owner_display_name', CASE
            WHEN char_length(owner_profile.display_name) <= 200
              AND owner_profile.display_name !~ '[[:cntrl:]]'
            THEN owner_profile.display_name
            ELSE 'Finance owner'
          END,
          'created_at', stop_factor.created_at
        )
        ORDER BY stop_factor.created_at, stop_factor.id
      ),
      '[]'::JSONB
    ) AS active_stop_factors
    FROM platform.stop_factors AS stop_factor
    JOIN platform.organization_memberships AS owner_membership
      ON owner_membership.organization_id = stop_factor.organization_id
      AND owner_membership.id = stop_factor.owner_membership_id
    JOIN platform.profiles AS owner_profile
      ON owner_profile.id = owner_membership.profile_id
    WHERE stop_factor.organization_id = obligation.organization_id
      AND stop_factor.student_case_id = obligation.student_case_id
      AND stop_factor.payment_obligation_id = obligation.id
      AND stop_factor.status = 'active'
  ) AS stop_summary ON TRUE
  WHERE obligation.organization_id = target_organization_id
    AND obligation.student_case_id = p_student_case_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'audit_event_id', finance_event.id,
        'action', finance_event.action,
        'resource_type', finance_event.resource_type,
        'resource_id', finance_event.resource_id,
        'actor_display_name', finance_event.actor_display_name,
        'reason', finance_event.safe_reason,
        'created_at', finance_event.created_at
      )
      ORDER BY finance_event.created_at DESC, finance_event.id DESC
    ),
    '[]'::JSONB
  )
  INTO history_payload
  FROM (
    SELECT
      audit_event.id,
      audit_event.action,
      audit_event.resource_type,
      audit_event.resource_id,
      CASE
        WHEN audit_event.actor_kind = 'user'
          AND char_length(actor_profile.display_name) <= 200
          AND actor_profile.display_name !~ '[[:cntrl:]]'
        THEN actor_profile.display_name
        WHEN audit_event.actor_kind = 'user' THEN 'Staff member'
        ELSE 'System'
      END AS actor_display_name,
      CASE
        WHEN char_length(audit_event.reason) <= 1000
          AND audit_event.reason !~ '[[:cntrl:]]'
        THEN audit_event.reason
        ELSE 'Finance change'
      END AS safe_reason,
      audit_event.created_at
    FROM platform.audit_events AS audit_event
    LEFT JOIN platform.profiles AS actor_profile
      ON actor_profile.id = audit_event.actor_profile_id
    WHERE audit_event.organization_id = target_organization_id
      AND audit_event.action = ANY (
        ARRAY[
          'finance.obligation.create',
          'finance.payment.record',
          'finance.stop.create',
          'finance.stop.resolve'
        ]::TEXT[]
      )
      AND (
        (
          audit_event.resource_type = 'payment_obligation'
          AND EXISTS (
            SELECT 1
            FROM platform.payment_obligations AS obligation
            WHERE obligation.organization_id = target_organization_id
              AND obligation.student_case_id = p_student_case_id
              AND obligation.id = audit_event.resource_id
          )
        )
        OR (
          audit_event.resource_type = 'payment_event'
          AND EXISTS (
            SELECT 1
            FROM platform.payment_events AS payment_event
            WHERE payment_event.organization_id = target_organization_id
              AND payment_event.student_case_id = p_student_case_id
              AND payment_event.id = audit_event.resource_id
          )
        )
        OR (
          audit_event.resource_type = 'stop_factor'
          AND EXISTS (
            SELECT 1
            FROM platform.stop_factors AS stop_factor
            WHERE stop_factor.organization_id = target_organization_id
              AND stop_factor.student_case_id = p_student_case_id
              AND stop_factor.id = audit_event.resource_id
          )
        )
      )
    ORDER BY audit_event.created_at DESC, audit_event.id DESC
    LIMIT p_history_limit
  ) AS finance_event;

  RETURN jsonb_build_object(
    'organization_id', target_organization_id,
    'student_case_id', p_student_case_id,
    'obligations', obligations_payload,
    'history', history_payload
  );
END
$$;

CREATE OR REPLACE FUNCTION platform.resolve_case_stop_factor(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_stop_factor_id UUID,
  p_resolution_kind platform.stop_factor_resolution_kind,
  p_payment_event_id UUID,
  p_reason TEXT,
  p_evidence_ref TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM *
  FROM platform_private.require_finance_actor(
    p_organization_id,
    'finance.stop.manage'
  );

  IF p_student_case_id IS NULL
    OR p_stop_factor_id IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM platform.stop_factors AS stop_factor
      WHERE stop_factor.organization_id = p_organization_id
        AND stop_factor.student_case_id = p_student_case_id
        AND stop_factor.id = p_stop_factor_id
    )
  THEN
    RAISE EXCEPTION 'Case-bound stop factor is unavailable'
      USING ERRCODE = '42501';
  END IF;

  RETURN platform.resolve_stop_factor(
    p_organization_id,
    p_stop_factor_id,
    p_resolution_kind,
    p_payment_event_id,
    p_reason,
    p_evidence_ref,
    p_request_id
  );
END
$$;

CREATE OR REPLACE FUNCTION platform.staff_finance_control_queue(
  p_limit INTEGER DEFAULT 100,
  p_student_case_ids UUID[] DEFAULT NULL
)
RETURNS TABLE (
  organization_id UUID,
  student_case_id UUID,
  overdue_obligation_count BIGINT,
  outstanding_obligation_count BIGINT,
  active_stop_factor_count BIGINT,
  blocked_action TEXT,
  stop_reason TEXT,
  stop_next_action TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION
      'Finance control queue limit must be from 1 to 100'
      USING ERRCODE = '22023';
  END IF;

  IF p_student_case_ids IS NOT NULL
    AND (
      pg_catalog.cardinality(p_student_case_ids) NOT BETWEEN 1 AND 100
      OR pg_catalog.array_position(p_student_case_ids, NULL) IS NOT NULL
      OR (
        SELECT count(*)
        FROM (
          SELECT DISTINCT requested_case_id
          FROM pg_catalog.unnest(p_student_case_ids)
            AS requested_case(requested_case_id)
        ) AS unique_requested_cases
      ) <> pg_catalog.cardinality(p_student_case_ids)
    )
  THEN
    RAISE EXCEPTION
      'Finance control queue case scope must contain 1 to 100 unique case ids'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH authorized_obligations AS (
    SELECT
      obligation.organization_id,
      obligation.student_case_id,
      obligation.id AS payment_obligation_id,
      obligation.due_at,
      obligation.amount_minor - (
        obligation.total_paid_minor - obligation.total_refunded_minor
      ) AS outstanding_minor,
      (
        obligation.due_at < transaction_timestamp()
        AND obligation.amount_minor - (
          obligation.total_paid_minor - obligation.total_refunded_minor
        ) > 0
      ) AS overdue
    FROM platform.payment_obligations AS obligation
    WHERE (
      p_student_case_ids IS NULL
      OR obligation.student_case_id = ANY (p_student_case_ids)
    )
    AND (
      private.platform_can_read_finance_full(
        obligation.organization_id
      )
      OR (
        private.platform_can_read_student_case(
          obligation.organization_id,
          obligation.student_case_id
        )
        AND private.platform_has_permission(
          obligation.organization_id,
          'finance.read.summary'
        )
      )
    )
  ),
  case_metrics AS (
    SELECT
      obligation.organization_id,
      obligation.student_case_id,
      count(*) FILTER (WHERE obligation.overdue) AS overdue_count,
      count(*) FILTER (
        WHERE obligation.outstanding_minor > 0
      ) AS outstanding_count,
      min(obligation.due_at) FILTER (
        WHERE obligation.overdue
      ) AS oldest_overdue_at
    FROM authorized_obligations AS obligation
    GROUP BY obligation.organization_id, obligation.student_case_id
  ),
  stop_metrics AS (
    SELECT
      obligation.organization_id,
      obligation.student_case_id,
      count(stop_factor.id) AS active_stop_count
    FROM authorized_obligations AS obligation
    JOIN platform.stop_factors AS stop_factor
      ON stop_factor.organization_id = obligation.organization_id
      AND stop_factor.student_case_id = obligation.student_case_id
      AND stop_factor.payment_obligation_id =
        obligation.payment_obligation_id
      AND stop_factor.status = 'active'
    GROUP BY obligation.organization_id, obligation.student_case_id
  )
  SELECT
    metrics.organization_id,
    metrics.student_case_id,
    metrics.overdue_count,
    metrics.outstanding_count,
    COALESCE(stops.active_stop_count, 0),
    representative_stop.blocked_action,
    representative_stop.stop_reason,
    representative_stop.stop_next_action
  FROM case_metrics AS metrics
  LEFT JOIN stop_metrics AS stops
    ON stops.organization_id = metrics.organization_id
    AND stops.student_case_id = metrics.student_case_id
  LEFT JOIN LATERAL (
    SELECT
      CASE
        WHEN char_length(stop_factor.blocked_action) <= 200
          AND stop_factor.blocked_action !~ '[[:cntrl:]]'
        THEN stop_factor.blocked_action
        ELSE 'downstream_case_progress'
      END AS blocked_action,
      CASE
        WHEN char_length(stop_factor.reason) <= 1000
          AND stop_factor.reason !~ '[[:cntrl:]]'
        THEN stop_factor.reason
        ELSE 'Finance stop factor'
      END AS stop_reason,
      CASE
        WHEN char_length(stop_factor.next_action) <= 1000
          AND stop_factor.next_action !~ '[[:cntrl:]]'
        THEN stop_factor.next_action
        ELSE 'Contact Finance'
      END AS stop_next_action
    FROM authorized_obligations AS obligation
    JOIN platform.stop_factors AS stop_factor
      ON stop_factor.organization_id = obligation.organization_id
      AND stop_factor.student_case_id = obligation.student_case_id
      AND stop_factor.payment_obligation_id =
        obligation.payment_obligation_id
    WHERE obligation.organization_id = metrics.organization_id
      AND obligation.student_case_id = metrics.student_case_id
      AND stop_factor.status = 'active'
    ORDER BY
      obligation.overdue DESC,
      obligation.due_at,
      stop_factor.created_at DESC,
      stop_factor.id DESC
    LIMIT 1
  ) AS representative_stop ON TRUE
  ORDER BY
    (COALESCE(stops.active_stop_count, 0) > 0) DESC,
    metrics.overdue_count DESC,
    metrics.outstanding_count DESC,
    metrics.oldest_overdue_at ASC NULLS LAST,
    metrics.student_case_id
  LIMIT p_limit;
END
$$;

REVOKE ALL ON FUNCTION platform.staff_case_finance_control(UUID, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE
  ON FUNCTION platform.staff_case_finance_control(UUID, INTEGER)
  TO authenticated;

REVOKE ALL ON FUNCTION platform.staff_finance_control_queue(INTEGER, UUID[])
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE
  ON FUNCTION platform.staff_finance_control_queue(INTEGER, UUID[])
  TO authenticated;

REVOKE ALL ON FUNCTION platform.resolve_case_stop_factor(
  UUID,
  UUID,
  UUID,
  platform.stop_factor_resolution_kind,
  UUID,
  TEXT,
  TEXT,
  UUID
)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.resolve_case_stop_factor(
  UUID,
  UUID,
  UUID,
  platform.stop_factor_resolution_kind,
  UUID,
  TEXT,
  TEXT,
  UUID
)
  TO authenticated;

COMMENT ON FUNCTION platform.staff_case_finance_control(UUID, INTEGER) IS
  'U8 authorized exact-case payment schedule, active finance stops and bounded safe finance audit history; no evidence or provider identifiers.';
COMMENT ON FUNCTION platform.staff_finance_control_queue(INTEGER, UUID[]) IS
  'U8 authorized tenant-scoped case finance control queue ordered by active stops, overdue obligations and outstanding checkpoints, optionally limited to exact application-page case ids.';
COMMENT ON FUNCTION platform.resolve_case_stop_factor(
  UUID,
  UUID,
  UUID,
  platform.stop_factor_resolution_kind,
  UUID,
  TEXT,
  TEXT,
  UUID
) IS
  'U8 exact-case wrapper around the canonical audited stop resolution; includes resolved rows so lost-response retries reach request-id replay without allowing a browser case mismatch.';

COMMIT;
