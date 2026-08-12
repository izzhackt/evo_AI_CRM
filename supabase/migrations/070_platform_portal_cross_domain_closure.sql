-- P6D closes only the missing accepted-UI seams over the existing admissions
-- and finance domains. It adds no new authority, provider integration, domain
-- state or notification category.

CREATE OR REPLACE FUNCTION platform.staff_case_visa(
  p_student_case_id UUID
)
RETURNS TABLE (
  visa_case_id UUID,
  case_id UUID,
  visa_status platform.visa_status,
  note TEXT,
  updated_at TIMESTAMPTZ
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    visa.id,
    visa.student_case_id,
    visa.status,
    CASE
      WHEN latest_event.note IS NULL THEN NULL
      WHEN char_length(latest_event.note) <= 4000
        AND latest_event.note !~ '[[:cntrl:]]'
      THEN latest_event.note
      ELSE NULL
    END,
    visa.updated_at
  FROM platform.visa_cases AS visa
  LEFT JOIN LATERAL (
    SELECT event.note
    FROM platform.visa_case_events AS event
    WHERE event.organization_id = visa.organization_id
      AND event.visa_case_id = visa.id
      AND event.student_case_id = visa.student_case_id
    ORDER BY event.created_at DESC, event.id DESC
    LIMIT 1
  ) AS latest_event ON TRUE
  WHERE visa.student_case_id = p_student_case_id
    AND private.platform_can_read_student_case(
      visa.organization_id,
      visa.student_case_id
    )
    AND private.platform_has_permission(
      visa.organization_id,
      'visa.manage'
    )
  ORDER BY visa.updated_at DESC, visa.id
$$;

CREATE OR REPLACE FUNCTION platform.staff_case_finance(
  p_student_case_id UUID
)
RETURNS TABLE (
  case_id UUID,
  payment_obligation_id UUID,
  obligation_label TEXT,
  category platform.obligation_category,
  amount_minor BIGINT,
  currency TEXT,
  due_at TIMESTAMPTZ,
  derived_status platform.obligation_status,
  overdue BOOLEAN,
  outstanding_minor BIGINT,
  next_action TEXT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    obligation.student_case_id,
    obligation.id,
    CASE
      WHEN char_length(obligation.label) <= 500
        AND obligation.label !~ '[[:cntrl:]]'
      THEN obligation.label
      ELSE 'Payment obligation'
    END,
    obligation.category,
    obligation.amount_minor,
    obligation.currency,
    obligation.due_at,
    platform_private.derive_obligation_status(
      obligation.amount_minor,
      obligation.total_paid_minor,
      obligation.total_refunded_minor,
      obligation.due_at,
      transaction_timestamp()
    ),
    (
      obligation.due_at < transaction_timestamp()
      AND obligation.amount_minor - (
        obligation.total_paid_minor - obligation.total_refunded_minor
      ) > 0
    ),
    obligation.amount_minor - (
      obligation.total_paid_minor - obligation.total_refunded_minor
    ),
    CASE
      WHEN char_length(obligation.next_action) <= 1000
        AND obligation.next_action !~ '[[:cntrl:]]'
      THEN obligation.next_action
      ELSE 'Contact Finance'
    END
  FROM platform.payment_obligations AS obligation
  WHERE obligation.student_case_id = p_student_case_id
    AND (
      private.platform_can_read_finance_full(obligation.organization_id)
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
  ORDER BY obligation.due_at, obligation.id
$$;

CREATE OR REPLACE FUNCTION platform.settle_payment_obligation(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_payment_obligation_id UUID,
  p_source_key TEXT,
  p_evidence_ref TEXT,
  p_reason TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  prior_event platform.audit_events%ROWTYPE;
  target_case platform.student_cases%ROWTYPE;
  obligation_row platform.payment_obligations%ROWTYPE;
  outstanding_minor BIGINT;
  recorded JSONB;
BEGIN
  PERFORM platform_private.lock_p2e_request(p_request_id);

  IF p_organization_id IS NULL
    OR p_student_case_id IS NULL
    OR p_payment_obligation_id IS NULL
    OR p_source_key IS NULL
    OR char_length(p_source_key) NOT BETWEEN 1 AND 512
    OR btrim(p_source_key) = ''
    OR p_source_key ~ '[[:cntrl:]]'
    OR p_evidence_ref IS NULL
    OR char_length(p_evidence_ref) NOT BETWEEN 1 AND 512
    OR btrim(p_evidence_ref) = ''
    OR p_evidence_ref ~ '[[:cntrl:]]'
    OR p_reason IS NULL
    OR char_length(p_reason) NOT BETWEEN 1 AND 1000
    OR btrim(p_reason) = ''
    OR p_reason ~ '[[:cntrl:]]'
  THEN
    RAISE EXCEPTION
      'Exact obligation, source, evidence and reason are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_finance_actor(
    p_organization_id,
    'finance.event.confirm'
  );

  -- Replay is checked before current balance. A later refund may reopen an
  -- outstanding balance, but an already consumed request can only return its
  -- original settlement and can never pay the later balance.
  SELECT *
  INTO prior_event
  FROM platform.audit_events AS event
  WHERE event.request_id = p_request_id;

  IF FOUND THEN
    IF prior_event.organization_id <> p_organization_id
      OR prior_event.action <> 'finance.payment.record'
      OR prior_event.resource_type <> 'payment_event'
      OR prior_event.reason <> btrim(p_reason)
      OR NOT (prior_event.after_state @> jsonb_build_object(
        'organization_id', p_organization_id,
        'student_case_id', p_student_case_id,
        'payment_obligation_id', p_payment_obligation_id,
        'event_type', 'payment',
        'referenced_payment_event_id', NULL,
        'source_key', btrim(p_source_key),
        'evidence_ref', btrim(p_evidence_ref)
      ))
    THEN
      RAISE EXCEPTION
        'request_id % was already used for another mutation',
        p_request_id
        USING ERRCODE = '22023';
    END IF;

    RETURN jsonb_build_object(
      'organization_id', prior_event.after_state -> 'organization_id',
      'payment_event_id', prior_event.after_state -> 'payment_event_id',
      'payment_obligation_id',
        prior_event.after_state -> 'payment_obligation_id',
      'student_case_id', prior_event.after_state -> 'student_case_id',
      'event_type', prior_event.after_state -> 'event_type',
      'amount_minor', prior_event.after_state -> 'amount_minor',
      'currency', prior_event.after_state -> 'currency',
      'total_paid_minor', prior_event.after_state -> 'total_paid_minor',
      'total_refunded_minor',
        prior_event.after_state -> 'total_refunded_minor'
    );
  END IF;

  -- Preserve the accepted case -> obligation -> event/evidence lock order used
  -- by record_payment_event. A direct ledger writer can therefore never hold
  -- the case lock while this wrapper holds the child obligation lock.
  SELECT *
  INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Payment obligation is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO obligation_row
  FROM platform.payment_obligations AS obligation
  WHERE obligation.organization_id = p_organization_id
    AND obligation.student_case_id = p_student_case_id
    AND obligation.id = p_payment_obligation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Payment obligation is unavailable'
      USING ERRCODE = '42501';
  END IF;

  -- Re-check authority after the row wait so an authority change cannot be
  -- hidden behind a concurrent ledger writer.
  SELECT *
  INTO actor
  FROM platform_private.require_finance_actor(
    p_organization_id,
    'finance.event.confirm'
  );

  outstanding_minor := obligation_row.amount_minor - (
    obligation_row.total_paid_minor - obligation_row.total_refunded_minor
  );

  IF outstanding_minor <= 0 THEN
    RAISE EXCEPTION
      'Payment obligation has no outstanding balance'
      USING ERRCODE = '22023';
  END IF;

  recorded := platform.record_payment_event(
    p_organization_id,
    p_payment_obligation_id,
    'payment',
    NULL,
    outstanding_minor,
    obligation_row.currency,
    transaction_timestamp(),
    btrim(p_source_key),
    btrim(p_evidence_ref),
    btrim(p_reason),
    p_request_id
  );

  -- The ledger and immutable audit retain source/evidence/time provenance.
  -- The browser-facing receipt deliberately returns none of those private
  -- fields and contains no provider or amoCRM identifier.
  RETURN jsonb_build_object(
    'organization_id', recorded -> 'organization_id',
    'payment_event_id', recorded -> 'payment_event_id',
    'payment_obligation_id', recorded -> 'payment_obligation_id',
    'student_case_id', recorded -> 'student_case_id',
    'event_type', recorded -> 'event_type',
    'amount_minor', recorded -> 'amount_minor',
    'currency', recorded -> 'currency',
    'total_paid_minor', recorded -> 'total_paid_minor',
    'total_refunded_minor', recorded -> 'total_refunded_minor'
  );
END
$$;

REVOKE ALL ON FUNCTION platform.staff_case_visa(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_case_visa(UUID)
  TO authenticated;

REVOKE ALL ON FUNCTION platform.staff_case_finance(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_case_finance(UUID)
  TO authenticated;

REVOKE ALL ON FUNCTION platform.settle_payment_obligation(
  UUID,
  UUID,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.settle_payment_obligation(
  UUID,
  UUID,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  UUID
) TO authenticated;

COMMENT ON FUNCTION platform.staff_case_visa(UUID) IS
  'P6D actor-derived exact-case staff visa projection without private evidence or provider identifiers.';
COMMENT ON FUNCTION platform.staff_case_finance(UUID) IS
  'P6D actor-derived exact-case finance projection without private evidence or provider identifiers.';
COMMENT ON FUNCTION platform.settle_payment_obligation(
  UUID,
  UUID,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  UUID
) IS
  'P6D evidence-required full settlement with database-derived balance, currency and transaction time.';
