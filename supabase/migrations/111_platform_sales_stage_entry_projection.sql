-- ============================================================
-- 111_platform_sales_stage_entry_projection.sql
--
-- Exact, bounded V3 Sales stage-entry cohorts. The projection reads the
-- existing canonical lead plus the append-only workflow receipt/audit pair;
-- it does not create a second event store or infer transitions from
-- platform.leads.updated_at.
-- ============================================================

BEGIN;

CREATE INDEX leads_open_created_cohort_idx
  ON platform.leads (organization_id, created_at, id)
  WHERE lifecycle_state = 'open';

CREATE OR REPLACE FUNCTION platform.staff_sales_stage_entry_cohort(
  p_from_date DATE,
  p_to_date DATE,
  p_limit INTEGER DEFAULT 101,
  p_cursor_entered_at TIMESTAMPTZ DEFAULT NULL,
  p_cursor_request_id UUID DEFAULT NULL
)
RETURNS TABLE (
  organization_id UUID,
  lead_id UUID,
  stage_key TEXT,
  entered_at TIMESTAMPTZ,
  entered_on DATE,
  request_id UUID
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  inconsistent_request_id UUID;
BEGIN
  IF p_from_date IS NULL
    OR p_to_date IS NULL
    OR NOT pg_catalog.isfinite(p_from_date)
    OR NOT pg_catalog.isfinite(p_to_date)
    OR p_to_date < p_from_date
    OR (p_to_date - p_from_date) > 365
  THEN
    RAISE EXCEPTION 'sales_stage_entry_invalid_date_range'
      USING ERRCODE = '22023';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 101 THEN
    RAISE EXCEPTION 'sales_stage_entry_invalid_limit'
      USING ERRCODE = '22023';
  END IF;

  IF (p_cursor_entered_at IS NULL) <> (p_cursor_request_id IS NULL) THEN
    RAISE EXCEPTION 'sales_stage_entry_incomplete_cursor'
      USING ERRCODE = '22023';
  END IF;

  SELECT authority.*
  INTO actor
  FROM platform.current_actor_authority() AS authority
  WHERE authority.platform_role IN ('admin', 'sales')
    AND private.platform_has_permission(
      authority.organization_id,
      'lead.sales.workflow.manage'
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sales_stage_entry_forbidden'
      USING ERRCODE = '42501';
  END IF;

  -- Do not silently turn damaged history into a smaller funnel. Every receipt
  -- in the caller-visible creation cohort must have the exact audit event
  -- emitted by mutate_sales_lead_workflow, and every such audit event must
  -- still have its private receipt. Owner/action-only commands are valid
  -- pairs; the transition filter below excludes them only after this check.
  WITH visible_cohort AS MATERIALIZED (
    SELECT lead.organization_id, lead.id AS lead_id
    FROM platform.leads AS lead
    WHERE lead.organization_id = actor.organization_id
      AND lead.lifecycle_state = 'open'
      AND lead.created_at >= (
        p_from_date::TIMESTAMP AT TIME ZONE 'Asia/Bishkek'
      )
      AND lead.created_at < (
        (p_to_date + 1)::TIMESTAMP AT TIME ZONE 'Asia/Bishkek'
      )
      AND (
        actor.platform_role = 'admin'
        OR lead.current_owner_membership_id = actor.membership_id
        OR lead.current_owner_membership_id IS NULL
      )
  ),
  receipt_mismatches AS (
    SELECT receipt.request_id
    FROM visible_cohort AS cohort
    JOIN platform_private.sales_lead_workflow_receipts AS receipt
      ON receipt.organization_id = cohort.organization_id
     AND receipt.lead_id = cohort.lead_id
    LEFT JOIN platform.audit_events AS audit_event
      ON audit_event.request_id = receipt.request_id
    LEFT JOIN platform.profiles AS actor_profile
      ON actor_profile.id = receipt.actor_profile_id
    LEFT JOIN platform.organization_memberships AS actor_membership
      ON actor_membership.organization_id = receipt.organization_id
     AND actor_membership.id = receipt.actor_membership_id
     AND actor_membership.profile_id = receipt.actor_profile_id
    WHERE audit_event.id IS NULL
      OR actor_profile.id IS NULL
      OR actor_membership.id IS NULL
      OR audit_event.organization_id IS DISTINCT FROM
        receipt.organization_id
      OR audit_event.request_id IS DISTINCT FROM receipt.request_id
      OR audit_event.resource_type IS DISTINCT FROM 'lead'
      OR audit_event.resource_id IS DISTINCT FROM receipt.lead_id
      OR audit_event.actor_kind IS DISTINCT FROM 'user'
      OR audit_event.actor_profile_id IS DISTINCT FROM
        receipt.actor_profile_id
      OR audit_event.actor_membership_id IS DISTINCT FROM
        receipt.actor_membership_id
      OR audit_event.actor_principal IS DISTINCT FROM
        'auth:' || actor_profile.auth_user_id::TEXT
      OR audit_event.action IS DISTINCT FROM
        'lead.sales.workflow.changed'
      OR audit_event.created_at IS DISTINCT FROM receipt.created_at
      OR audit_event.resulting_version IS DISTINCT FROM
        receipt.resulting_workflow_version
      OR receipt.resulting_workflow_version IS DISTINCT FROM
        receipt.expected_workflow_version + 1
      OR audit_event.reason IS DISTINCT FROM COALESCE(
        receipt.requested_reason,
        'sales_workflow_update'
      )
      OR audit_event.before_state IS NULL
      OR audit_event.before_state ->> 'stage_key' IS NULL
      OR NOT (
        audit_event.before_state @> pg_catalog.jsonb_build_object(
          'workflow_version', receipt.expected_workflow_version
        )
      )
      OR NOT (
        audit_event.after_state @> pg_catalog.jsonb_build_object(
          'stage_key', receipt.desired_stage_key,
          'current_owner_membership_id',
            receipt.desired_owner_membership_id,
          'next_action_text', receipt.desired_next_action_text,
          'next_action_due_date', receipt.desired_next_action_due_date,
          'workflow_version', receipt.resulting_workflow_version
        )
      )
      OR NOT (
        receipt.result @> pg_catalog.jsonb_build_object(
          'request_id', receipt.request_id,
          'organization_id', receipt.organization_id,
          'lead_id', receipt.lead_id,
          'stage_key', receipt.desired_stage_key,
          'current_owner_membership_id',
            receipt.desired_owner_membership_id,
          'next_action_text', receipt.desired_next_action_text,
          'next_action_due_date', receipt.desired_next_action_due_date,
          'workflow_version', receipt.resulting_workflow_version
        )
      )
      OR CASE
        WHEN pg_catalog.jsonb_typeof(receipt.result -> 'changed_at')
          IS DISTINCT FROM 'string'
        THEN TRUE
        ELSE (receipt.result ->> 'changed_at')::TIMESTAMPTZ
          IS DISTINCT FROM receipt.created_at
      END
  ),
  audit_without_receipts AS (
    SELECT audit_event.request_id
    FROM visible_cohort AS cohort
    JOIN platform.audit_events AS audit_event
      ON audit_event.organization_id = cohort.organization_id
     AND audit_event.resource_type = 'lead'
     AND audit_event.resource_id = cohort.lead_id
     AND audit_event.action = 'lead.sales.workflow.changed'
    LEFT JOIN platform_private.sales_lead_workflow_receipts AS receipt
      ON receipt.request_id = audit_event.request_id
    WHERE receipt.request_id IS NULL
      OR receipt.organization_id IS DISTINCT FROM
        audit_event.organization_id
      OR receipt.lead_id IS DISTINCT FROM audit_event.resource_id
  ),
  inconsistencies AS (
    SELECT mismatch.request_id
    FROM receipt_mismatches AS mismatch
    UNION ALL
    SELECT missing.request_id
    FROM audit_without_receipts AS missing
  )
  SELECT inconsistency.request_id
  INTO inconsistent_request_id
  FROM inconsistencies AS inconsistency
  ORDER BY inconsistency.request_id
  LIMIT 1;

  IF inconsistent_request_id IS NOT NULL THEN
    RAISE EXCEPTION 'sales_stage_entry_evidence_inconsistent'
      USING ERRCODE = '23514';
  END IF;

  RETURN QUERY
  WITH visible_cohort AS MATERIALIZED (
    SELECT lead.organization_id, lead.id AS lead_id
    FROM platform.leads AS lead
    WHERE lead.organization_id = actor.organization_id
      AND lead.lifecycle_state = 'open'
      AND lead.created_at >= (
        p_from_date::TIMESTAMP AT TIME ZONE 'Asia/Bishkek'
      )
      AND lead.created_at < (
        (p_to_date + 1)::TIMESTAMP AT TIME ZONE 'Asia/Bishkek'
      )
      AND (
        actor.platform_role = 'admin'
        OR lead.current_owner_membership_id = actor.membership_id
        OR lead.current_owner_membership_id IS NULL
      )
  ),
  proven_entries AS MATERIALIZED (
    SELECT
      receipt.organization_id,
      receipt.lead_id,
      receipt.desired_stage_key AS stage_key,
      receipt.created_at AS entered_at,
      receipt.request_id,
      pg_catalog.row_number() OVER (
        PARTITION BY receipt.organization_id,
          receipt.lead_id,
          receipt.desired_stage_key
        ORDER BY receipt.created_at ASC, receipt.request_id ASC
      ) AS entry_rank
    FROM visible_cohort AS cohort
    JOIN platform_private.sales_lead_workflow_receipts AS receipt
      ON receipt.organization_id = cohort.organization_id
     AND receipt.lead_id = cohort.lead_id
    JOIN platform.audit_events AS audit_event
      ON audit_event.request_id = receipt.request_id
    WHERE audit_event.before_state ->> 'stage_key'
      <> audit_event.after_state ->> 'stage_key'
  )
  SELECT
    entry.organization_id,
    entry.lead_id,
    entry.stage_key,
    entry.entered_at,
    pg_catalog.timezone('Asia/Bishkek', entry.entered_at)::DATE AS entered_on,
    entry.request_id
  FROM proven_entries AS entry
  WHERE entry.entry_rank = 1
    AND (
      p_cursor_entered_at IS NULL
      OR (entry.entered_at, entry.request_id)
        > (p_cursor_entered_at, p_cursor_request_id)
    )
  ORDER BY entry.entered_at ASC, entry.request_id ASC
  LIMIT p_limit;
END
$$;

REVOKE ALL ON FUNCTION
  platform.staff_sales_stage_entry_cohort(DATE, DATE, INTEGER, TIMESTAMPTZ, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION
  platform.staff_sales_stage_entry_cohort(DATE, DATE, INTEGER, TIMESTAMPTZ, UUID)
  TO authenticated;

COMMENT ON FUNCTION
  platform.staff_sales_stage_entry_cohort(DATE, DATE, INTEGER, TIMESTAMPTZ, UUID)
IS
  'Returns one first receipt-plus-audit-proven stage entry per visible open lead and stage in an inclusive, at-most-366-day Asia/Bishkek lead-creation cohort, paged by entered_at plus request_id. No stage is inferred from mutable lead timestamps.';

COMMIT;
