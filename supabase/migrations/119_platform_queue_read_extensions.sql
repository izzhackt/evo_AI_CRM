-- ============================================================
-- 119_platform_queue_read_extensions.sql
--
-- V3 stage-C queue-read deficits, closed with read-only projection facts:
--   (a) the conversation queue exposes the stored direction and time of the
--       latest persisted message (NULL when the conversation has none);
--   (b) the same queue accepts an optional bounded participant/phone query
--       over the stored subject and the canonical client identity;
--   (c) the Sales queue exposes the receipt-and-audit-proven time of the last
--       entry into the lead's CURRENT stage (falling back to immutable
--       lead.created_at when the lead has never transitioned);
--   (d) the Admissions task queue gains a keyset cursor over its existing
--       (deadline projection, id) order plus optional due-day bounds, so a
--       calendar can read past the first page. Cursorless behavior is
--       byte-identical to migration 110.
--
-- Every function below is a STABLE read: no mutation, no request_id, no new
-- audit action. Actor guards are carried over unchanged from 078/094/110.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- (a) + (b) Conversation queue: last-message facts and search.
-- The return shape changes, so both the page and its snapshot wrapper are
-- replaced (the snapshot forwards page.* and must match column-for-column).
-- ------------------------------------------------------------

DROP FUNCTION platform.staff_communication_snapshot(UUID, UUID);
DROP FUNCTION platform.staff_communication_page(
  UUID, INTEGER, TIMESTAMPTZ, UUID,
  platform.communication_queue, platform.communication_status, UUID
);

CREATE FUNCTION private.staff_communication_page(
  p_organization_id UUID,
  p_limit INTEGER,
  p_before_sort_at TIMESTAMPTZ DEFAULT NULL,
  p_before_conversation_id UUID DEFAULT NULL,
  p_queue platform.communication_queue DEFAULT NULL,
  p_status platform.communication_status DEFAULT NULL,
  p_conversation_id UUID DEFAULT NULL,
  p_query TEXT DEFAULT NULL
)
RETURNS TABLE (
  conversation_id UUID,
  student_case_id UUID,
  queue platform.communication_queue,
  status platform.communication_status,
  subject TEXT,
  waha_session_name TEXT,
  kommo_account_id BIGINT,
  kommo_conversation_id TEXT,
  amocrm_account_id BIGINT,
  amocrm_lead_id BIGINT,
  amocrm_contact_id BIGINT,
  created_at TIMESTAMPTZ,
  sort_at TIMESTAMPTZ,
  last_message_direction platform.communication_direction,
  last_message_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  normalized_query TEXT;
  normalized_phone_query TEXT;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 101 THEN
    RAISE EXCEPTION 'Invalid page limit' USING ERRCODE = '22023';
  END IF;

  IF (p_before_sort_at IS NULL) <> (p_before_conversation_id IS NULL) THEN
    RAISE EXCEPTION 'Incomplete conversation cursor' USING ERRCODE = '22023';
  END IF;

  IF p_query IS NOT NULL
    AND pg_catalog.length(pg_catalog.btrim(p_query)) > 200
  THEN
    RAISE EXCEPTION 'Conversation query is too long' USING ERRCODE = '22023';
  END IF;

  normalized_query := NULLIF(
    pg_catalog.lower(pg_catalog.btrim(p_query)),
    ''
  );
  normalized_phone_query := CASE
    WHEN p_query IS NOT NULL
      AND pg_catalog.btrim(p_query) ~ '^[+0-9() ./-]+$'
    THEN NULLIF(
      pg_catalog.regexp_replace(p_query, '[^0-9]', '', 'g'),
      ''
    )
    ELSE NULL
  END;

  PERFORM 1
  FROM platform_private.require_domain_actor_read(
    p_organization_id,
    'communication.read.full'
  );

  RETURN QUERY
  SELECT
    conversation.id,
    conversation.student_case_id,
    conversation.queue,
    conversation.status,
    conversation.subject,
    conversation.waha_session_name,
    conversation.kommo_account_id,
    conversation.kommo_conversation_id,
    conversation.amocrm_account_id,
    conversation.amocrm_lead_id,
    conversation.amocrm_contact_id,
    conversation.created_at,
    GREATEST(
      conversation.updated_at,
      COALESCE(latest_message.created_at, conversation.updated_at)
    ) AS sort_at,
    latest_message.direction AS last_message_direction,
    latest_message.created_at AS last_message_at
  FROM platform.communication_conversations AS conversation
  LEFT JOIN platform.clients AS canonical_client
    ON canonical_client.organization_id = conversation.organization_id
    AND canonical_client.id = conversation.canonical_client_id
  LEFT JOIN LATERAL (
    SELECT message.created_at, message.direction
    FROM platform.communication_messages AS message
    WHERE message.organization_id = conversation.organization_id
      AND message.conversation_id = conversation.id
    ORDER BY message.created_at DESC, message.id DESC
    LIMIT 1
  ) AS latest_message ON TRUE
  WHERE conversation.organization_id = p_organization_id
    AND private.platform_can_read_communication_full(
      conversation.organization_id,
      conversation.id
    )
    AND (p_queue IS NULL OR conversation.queue = p_queue)
    AND (p_status IS NULL OR conversation.status = p_status)
    AND (
      p_conversation_id IS NULL
      OR conversation.id = p_conversation_id
    )
    -- The search reads only fields the projection already owns: the stored
    -- conversation subject and, when a canonical client is linked, that
    -- client's display name and phone. No provider payload is consulted.
    AND (
      normalized_query IS NULL
      OR pg_catalog.strpos(
        pg_catalog.lower(pg_catalog.concat_ws(
          ' ',
          conversation.subject,
          canonical_client.display_name,
          canonical_client.phone,
          canonical_client.normalized_phone
        )),
        normalized_query
      ) > 0
      OR (
        normalized_phone_query IS NOT NULL
        AND pg_catalog.strpos(
          pg_catalog.regexp_replace(
            COALESCE(
              canonical_client.normalized_phone,
              canonical_client.phone,
              ''
            ),
            '[^0-9]',
            '',
            'g'
          ),
          normalized_phone_query
        ) > 0
      )
    )
    AND (
      p_before_sort_at IS NULL
      OR (
        GREATEST(
          conversation.updated_at,
          COALESCE(latest_message.created_at, conversation.updated_at)
        ),
        conversation.id
      ) < (p_before_sort_at, p_before_conversation_id)
    )
  ORDER BY GREATEST(
    conversation.updated_at,
    COALESCE(latest_message.created_at, conversation.updated_at)
  ) DESC, conversation.id DESC
  LIMIT p_limit;
END
$$;

CREATE FUNCTION platform.staff_communication_page(
  p_organization_id UUID,
  p_limit INTEGER,
  p_before_sort_at TIMESTAMPTZ DEFAULT NULL,
  p_before_conversation_id UUID DEFAULT NULL,
  p_queue platform.communication_queue DEFAULT NULL,
  p_status platform.communication_status DEFAULT NULL,
  p_conversation_id UUID DEFAULT NULL,
  p_query TEXT DEFAULT NULL
)
RETURNS TABLE (
  conversation_id UUID,
  student_case_id UUID,
  queue platform.communication_queue,
  status platform.communication_status,
  subject TEXT,
  waha_session_name TEXT,
  kommo_account_id BIGINT,
  kommo_conversation_id TEXT,
  amocrm_account_id BIGINT,
  amocrm_lead_id BIGINT,
  amocrm_contact_id BIGINT,
  created_at TIMESTAMPTZ,
  sort_at TIMESTAMPTZ,
  last_message_direction platform.communication_direction,
  last_message_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT page.*
  FROM private.staff_communication_page(
    p_organization_id,
    p_limit,
    p_before_sort_at,
    p_before_conversation_id,
    p_queue,
    p_status,
    p_conversation_id,
    p_query
  ) AS page
$$;

CREATE FUNCTION platform.staff_communication_snapshot(
  p_organization_id UUID,
  p_conversation_id UUID
)
RETURNS TABLE (
  conversation_id UUID,
  student_case_id UUID,
  queue platform.communication_queue,
  status platform.communication_status,
  subject TEXT,
  waha_session_name TEXT,
  kommo_account_id BIGINT,
  kommo_conversation_id TEXT,
  amocrm_account_id BIGINT,
  amocrm_lead_id BIGINT,
  amocrm_contact_id BIGINT,
  created_at TIMESTAMPTZ,
  sort_at TIMESTAMPTZ,
  last_message_direction platform.communication_direction,
  last_message_at TIMESTAMPTZ
)
LANGUAGE SQL
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT page.*
  FROM platform.staff_communication_page(
    p_organization_id,
    1,
    NULL,
    NULL,
    NULL,
    NULL,
    p_conversation_id,
    NULL
  ) AS page
$$;

REVOKE ALL ON FUNCTION platform.staff_communication_page(
  UUID, INTEGER, TIMESTAMPTZ, UUID,
  platform.communication_queue, platform.communication_status, UUID, TEXT
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION private.staff_communication_page(
  UUID, INTEGER, TIMESTAMPTZ, UUID,
  platform.communication_queue, platform.communication_status, UUID, TEXT
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.staff_communication_page(
  UUID, INTEGER, TIMESTAMPTZ, UUID,
  platform.communication_queue, platform.communication_status, UUID, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION platform.staff_communication_page(
  UUID, INTEGER, TIMESTAMPTZ, UUID,
  platform.communication_queue, platform.communication_status, UUID, TEXT
) TO authenticated;

REVOKE ALL ON FUNCTION platform.staff_communication_snapshot(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_communication_snapshot(UUID, UUID)
  TO authenticated;

COMMENT ON FUNCTION platform.staff_communication_page(
  UUID, INTEGER, TIMESTAMPTZ, UUID,
  platform.communication_queue, platform.communication_status, UUID, TEXT
) IS
  'Bounded communication queue with latest-observation ordering, stored last-message direction/time facts (NULL without messages) and an optional subject/canonical-client search; keyset cursor unchanged.';

COMMENT ON FUNCTION platform.staff_communication_snapshot(UUID, UUID) IS
  'One authorized communication summary by exact conversation id, including the stored last-message facts; never scans or downloads the full queue.';

-- ------------------------------------------------------------
-- (c) Sales queue: proven current-stage entry time.
-- The argument list is unchanged; only the return shape grows, so the
-- function is replaced in place with the migration-094 body plus one
-- receipt-and-audit-backed scalar projection.
-- ------------------------------------------------------------

DROP FUNCTION platform.staff_sales_lead_page(
  INTEGER, TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT
);

CREATE FUNCTION private.staff_sales_lead_page(
  p_limit INTEGER,
  p_cursor_updated_at TIMESTAMPTZ DEFAULT NULL,
  p_cursor_id UUID DEFAULT NULL,
  p_connection_filter TEXT DEFAULT 'all',
  p_stage_filter TEXT DEFAULT NULL,
  p_assignment_filter TEXT DEFAULT 'all',
  p_owner_membership_id UUID DEFAULT NULL,
  p_due_filter TEXT DEFAULT 'all',
  p_query TEXT DEFAULT NULL
)
RETURNS TABLE (
  sort_at TIMESTAMPTZ,
  organization_id UUID,
  lead_id UUID,
  client_id UUID,
  client_display_name TEXT,
  client_email TEXT,
  client_phone TEXT,
  current_owner_membership_id UUID,
  current_owner_display_name TEXT,
  stage_key TEXT,
  source_key TEXT,
  lifecycle_state platform.lead_lifecycle_state,
  next_action_text TEXT,
  next_action_due_date DATE,
  workflow_version BIGINT,
  is_connected BOOLEAN,
  open_duplicate_candidate_count BIGINT,
  linked_student_case_count BIGINT,
  linked_conversation_count BIGINT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  stage_entered_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  normalized_connection_filter TEXT;
  normalized_stage_filter TEXT;
  normalized_assignment_filter TEXT;
  normalized_due_filter TEXT;
  normalized_query TEXT;
  bishkek_today DATE;
  inconsistent_request_id UUID;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 101 THEN
    RAISE EXCEPTION 'sales_workflow_invalid_limit'
      USING ERRCODE = '22023';
  END IF;

  IF (p_cursor_updated_at IS NULL) <> (p_cursor_id IS NULL) THEN
    RAISE EXCEPTION 'sales_workflow_incomplete_cursor'
      USING ERRCODE = '22023';
  END IF;

  IF p_query IS NOT NULL AND pg_catalog.length(pg_catalog.btrim(p_query)) > 200
  THEN
    RAISE EXCEPTION 'sales_workflow_query_too_long'
      USING ERRCODE = '22023';
  END IF;

  normalized_connection_filter := COALESCE(
    NULLIF(pg_catalog.lower(pg_catalog.btrim(p_connection_filter)), ''),
    'all'
  );
  normalized_stage_filter := COALESCE(
    NULLIF(pg_catalog.btrim(p_stage_filter), ''),
    'all'
  );
  normalized_assignment_filter := COALESCE(
    NULLIF(pg_catalog.lower(pg_catalog.btrim(p_assignment_filter)), ''),
    'all'
  );
  normalized_due_filter := COALESCE(
    NULLIF(pg_catalog.lower(pg_catalog.btrim(p_due_filter)), ''),
    'all'
  );
  normalized_query := NULLIF(
    pg_catalog.lower(pg_catalog.btrim(p_query)),
    ''
  );

  IF normalized_connection_filter NOT IN (
    'all', 'connected', 'unconnected'
  ) THEN
    RAISE EXCEPTION 'sales_workflow_invalid_connection_filter'
      USING ERRCODE = '22023';
  END IF;

  IF normalized_stage_filter <> 'all'
    AND normalized_stage_filter NOT IN (
      'new',
      'contacting',
      'qualified',
      'meeting_scheduled',
      'meeting_completed',
      'potential'
    )
  THEN
    RAISE EXCEPTION 'sales_workflow_invalid_stage_filter'
      USING ERRCODE = '22023';
  END IF;

  IF normalized_assignment_filter NOT IN ('all', 'mine', 'unassigned') THEN
    RAISE EXCEPTION 'sales_workflow_invalid_assignment_filter'
      USING ERRCODE = '22023';
  END IF;

  IF normalized_due_filter NOT IN (
    'all', 'scheduled', 'unscheduled', 'due_today', 'overdue'
  ) THEN
    RAISE EXCEPTION 'sales_workflow_invalid_due_filter'
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
    RAISE EXCEPTION 'sales_workflow_forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF p_owner_membership_id IS NOT NULL
    AND (
      actor.platform_role <> 'admin'
      OR NOT platform_private.is_eligible_sales_owner(
        actor.organization_id,
        p_owner_membership_id
      )
    )
  THEN
    RAISE EXCEPTION 'sales_workflow_invalid_owner_filter'
      USING ERRCODE = '22023';
  END IF;

  -- The current-stage timestamp is allowed to depend on the U4 receipt/audit
  -- ledger only after the complete caller-visible ledger has passed the exact
  -- migration-111 integrity contract. A damaged pair must fail the queue
  -- closed instead of silently changing a lead's apparent stage age. A lead
  -- with no receipt is valid only as the version-1 creation baseline or as
  -- migration 086's exact audited vocabulary normalization to version 2.
  WITH visible_lead_scope AS MATERIALIZED (
    SELECT lead.organization_id, lead.id AS lead_id
    FROM platform.leads AS lead
    WHERE lead.organization_id = actor.organization_id
      AND lead.lifecycle_state = 'open'
      AND (
        actor.platform_role = 'admin'
        OR lead.current_owner_membership_id = actor.membership_id
        OR lead.current_owner_membership_id IS NULL
      )
  ),
  receipt_mismatches AS (
    SELECT receipt.request_id
    FROM visible_lead_scope AS scope
    JOIN platform_private.sales_lead_workflow_receipts AS receipt
      ON receipt.organization_id = scope.organization_id
     AND receipt.lead_id = scope.lead_id
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
        WHEN NOT pg_catalog.pg_input_is_valid(
          receipt.result ->> 'changed_at',
          'timestamp with time zone'
        )
        THEN TRUE
        ELSE (receipt.result ->> 'changed_at')::TIMESTAMPTZ
          IS DISTINCT FROM receipt.created_at
      END
  ),
  audit_without_receipts AS (
    SELECT audit_event.request_id
    FROM visible_lead_scope AS scope
    JOIN platform.audit_events AS audit_event
      ON audit_event.organization_id = scope.organization_id
     AND audit_event.resource_type = 'lead'
     AND audit_event.resource_id = scope.lead_id
     AND audit_event.action = 'lead.sales.workflow.changed'
    LEFT JOIN platform_private.sales_lead_workflow_receipts AS receipt
      ON receipt.request_id = audit_event.request_id
    WHERE receipt.request_id IS NULL
      OR receipt.organization_id IS DISTINCT FROM
        audit_event.organization_id
      OR receipt.lead_id IS DISTINCT FROM audit_event.resource_id
  ),
  normalization_events AS (
    SELECT
      scope.organization_id,
      scope.lead_id,
      (
        audit_event.actor_kind = 'system'
        AND audit_event.actor_profile_id IS NULL
        AND audit_event.actor_membership_id IS NULL
        AND audit_event.actor_principal =
          'migration:086_platform_sales_workflow'
        AND audit_event.before_state IS NOT DISTINCT FROM
          pg_catalog.jsonb_build_object(
            'stage_key', 'new_inbound',
            'workflow_version', 1
          )
        AND audit_event.after_state IS NOT DISTINCT FROM
          pg_catalog.jsonb_build_object(
            'stage_key', 'new',
            'workflow_version', 2
          )
        AND audit_event.reason =
          'U4 normalizes the sole U3 legacy Sales stage'
        AND audit_event.resulting_version = 2
        AND audit_event.created_at >= lead.created_at
      ) AS is_exact
    FROM visible_lead_scope AS scope
    JOIN platform.leads AS lead
      ON lead.organization_id = scope.organization_id
     AND lead.id = scope.lead_id
    JOIN platform.audit_events AS audit_event
      ON audit_event.organization_id = scope.organization_id
     AND audit_event.resource_type = 'lead'
     AND audit_event.resource_id = scope.lead_id
     AND audit_event.action = 'lead.sales.stage.normalized'
  ),
  legacy_normalization_evidence AS (
    SELECT
      normalization.organization_id,
      normalization.lead_id,
      pg_catalog.count(*) AS event_count,
      pg_catalog.count(*) FILTER (
        WHERE normalization.is_exact
      ) AS exact_event_count
    FROM normalization_events AS normalization
    GROUP BY normalization.organization_id, normalization.lead_id
  ),
  current_state_mismatches AS (
    SELECT COALESCE(latest_receipt.request_id, lead.id) AS request_id
    FROM visible_lead_scope AS scope
    JOIN platform.leads AS lead
      ON lead.organization_id = scope.organization_id
     AND lead.id = scope.lead_id
    LEFT JOIN LATERAL (
      SELECT receipt.*
      FROM platform_private.sales_lead_workflow_receipts AS receipt
      WHERE receipt.organization_id = scope.organization_id
        AND receipt.lead_id = scope.lead_id
      ORDER BY
        receipt.resulting_workflow_version DESC,
        receipt.request_id DESC
      LIMIT 1
    ) AS latest_receipt ON TRUE
    LEFT JOIN legacy_normalization_evidence AS normalization
      ON normalization.organization_id = scope.organization_id
     AND normalization.lead_id = scope.lead_id
    WHERE (
        latest_receipt.request_id IS NULL
        AND NOT (
          (
            lead.workflow_version = 1
            AND lead.next_action_text IS NULL
            AND lead.next_action_due_date IS NULL
            AND normalization.lead_id IS NULL
          )
          OR (
            lead.workflow_version = 2
            AND lead.stage_key = 'new'
            AND lead.next_action_text IS NULL
            AND lead.next_action_due_date IS NULL
            AND COALESCE(normalization.event_count, 0) = 1
            AND COALESCE(normalization.exact_event_count, 0) = 1
          )
        )
      )
      OR (
        latest_receipt.request_id IS NOT NULL
        AND (
          latest_receipt.resulting_workflow_version IS DISTINCT FROM
            lead.workflow_version
          OR latest_receipt.desired_stage_key IS DISTINCT FROM lead.stage_key
          OR latest_receipt.desired_owner_membership_id IS DISTINCT FROM
            lead.current_owner_membership_id
          OR latest_receipt.desired_next_action_text IS DISTINCT FROM
            lead.next_action_text
          OR latest_receipt.desired_next_action_due_date IS DISTINCT FROM
            lead.next_action_due_date
        )
      )
  ),
  inconsistencies AS (
    SELECT mismatch.request_id
    FROM receipt_mismatches AS mismatch
    UNION ALL
    SELECT missing.request_id
    FROM audit_without_receipts AS missing
    UNION ALL
    SELECT current_state.request_id
    FROM current_state_mismatches AS current_state
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

  bishkek_today := pg_catalog.timezone(
    'Asia/Bishkek',
    pg_catalog.statement_timestamp()
  )::DATE;

  RETURN QUERY
  WITH visible AS MATERIALIZED (
    SELECT
      lead.updated_at AS sort_at,
      lead.organization_id,
      lead.id AS lead_id,
      client.id AS client_id,
      client.display_name AS client_display_name,
      client.email AS client_email,
      client.phone AS client_phone,
      lead.current_owner_membership_id,
      owner_profile.display_name AS current_owner_display_name,
      lead.stage_key,
      lead.source_key,
      lead.lifecycle_state,
      lead.next_action_text,
      lead.next_action_due_date,
      lead.workflow_version,
      EXISTS (
        SELECT 1
        FROM platform.communication_conversations AS direct_conversation
        WHERE direct_conversation.organization_id = lead.organization_id
          AND direct_conversation.canonical_lead_id = lead.id
          AND direct_conversation.sales_authority_source = 'platform_intake'
          AND direct_conversation.queue = 'sales'
          AND direct_conversation.canonical_client_id = lead.client_id
          AND EXISTS (
            SELECT 1
            FROM platform_private.waha_direct_chat_bindings AS binding
            JOIN platform_private.provider_webhook_events AS source_event
              ON source_event.organization_id = binding.organization_id
             AND source_event.id = binding.source_webhook_event_id
            WHERE binding.organization_id = direct_conversation.organization_id
              AND binding.conversation_id = direct_conversation.id
              AND binding.waha_session_name = direct_conversation.waha_session_name
              AND source_event.provider = 'waha'
              AND source_event.verification_status = 'verified'
              AND source_event.event_type IN ('message', 'message.any')
              AND source_event.raw_payload -> 'payload' -> 'fromMe'
                = 'false'::JSONB
              AND pg_catalog.lower(
                COALESCE(
                  pg_catalog.btrim(
                    source_event.raw_payload -> 'payload' ->> 'source'
                  ),
                  ''
                )
              ) <> 'api'
          )
          AND private.platform_can_read_canonical_lead(
            lead.organization_id,
            lead.id
          )
          AND private.platform_can_read_communication_full(
            direct_conversation.organization_id,
            direct_conversation.id
          )
      ) AS is_connected,
      CASE
        WHEN client.id IS NULL THEN 0::BIGINT
        ELSE (
          SELECT pg_catalog.count(*)
          FROM platform_private.client_duplicate_candidates AS candidate
          WHERE candidate.organization_id = lead.organization_id
            AND candidate.status = 'open'
            AND client.id IN (
              candidate.left_client_id,
              candidate.right_client_id
            )
        )
      END AS open_duplicate_candidate_count,
      (
        SELECT pg_catalog.count(*)
        FROM platform.student_cases AS student_case
        WHERE student_case.organization_id = lead.organization_id
          AND (
            student_case.canonical_lead_id = lead.id
            OR (
              lead.client_id IS NOT NULL
              AND student_case.canonical_client_id = lead.client_id
            )
          )
          AND private.platform_can_read_student_case(
            student_case.organization_id,
            student_case.id
          )
      ) AS linked_student_case_count,
      (
        SELECT pg_catalog.count(*)
        FROM platform.communication_conversations AS conversation
        WHERE conversation.organization_id = lead.organization_id
          AND conversation.canonical_lead_id = lead.id
          AND conversation.sales_authority_source = 'platform_intake'
          AND conversation.queue = 'sales'
          AND conversation.canonical_client_id = lead.client_id
          AND EXISTS (
            SELECT 1
            FROM platform_private.waha_direct_chat_bindings AS binding
            JOIN platform_private.provider_webhook_events AS source_event
              ON source_event.organization_id = binding.organization_id
             AND source_event.id = binding.source_webhook_event_id
            WHERE binding.organization_id = conversation.organization_id
              AND binding.conversation_id = conversation.id
              AND binding.waha_session_name = conversation.waha_session_name
              AND source_event.provider = 'waha'
              AND source_event.verification_status = 'verified'
              AND source_event.event_type IN ('message', 'message.any')
              AND source_event.raw_payload -> 'payload' -> 'fromMe'
                = 'false'::JSONB
              AND pg_catalog.lower(
                COALESCE(
                  pg_catalog.btrim(
                    source_event.raw_payload -> 'payload' ->> 'source'
                  ),
                  ''
                )
              ) <> 'api'
          )
          AND private.platform_can_read_canonical_lead(
            lead.organization_id,
            lead.id
          )
          AND private.platform_can_read_communication_full(
            conversation.organization_id,
            conversation.id
          )
      ) AS linked_conversation_count,
      lead.created_at,
      lead.updated_at,
      -- The last proven entry into the lead's CURRENT stage is selected by
      -- authoritative workflow version, not mutable lead.updated_at or event
      -- wall-clock order. Owner/action-only commands cannot reset it; a lead
      -- with no U4 business transition uses its immutable creation timestamp;
      -- migration 086's audited vocabulary normalization remains that baseline.
      COALESCE((
        SELECT receipt.created_at
        FROM platform_private.sales_lead_workflow_receipts AS receipt
        JOIN platform.audit_events AS audit_event
          ON audit_event.request_id = receipt.request_id
        WHERE receipt.organization_id = lead.organization_id
          AND receipt.lead_id = lead.id
          AND receipt.desired_stage_key = lead.stage_key
          AND audit_event.organization_id = receipt.organization_id
          AND audit_event.resource_type = 'lead'
          AND audit_event.resource_id = receipt.lead_id
          AND audit_event.action = 'lead.sales.workflow.changed'
          AND audit_event.before_state ->> 'stage_key'
            <> audit_event.after_state ->> 'stage_key'
          AND audit_event.after_state ->> 'stage_key' = lead.stage_key
        ORDER BY
          receipt.resulting_workflow_version DESC,
          receipt.request_id DESC
        LIMIT 1
      ), lead.created_at) AS stage_entered_at
    FROM platform.leads AS lead
    LEFT JOIN platform.clients AS client
      ON client.organization_id = lead.organization_id
      AND client.id = lead.client_id
    LEFT JOIN platform.organization_memberships AS owner_membership
      ON owner_membership.organization_id = lead.organization_id
      AND owner_membership.id = lead.current_owner_membership_id
    LEFT JOIN platform.profiles AS owner_profile
      ON owner_profile.id = owner_membership.profile_id
    WHERE lead.organization_id = actor.organization_id
      AND lead.lifecycle_state = 'open'
      AND (
        actor.platform_role = 'admin'
        OR lead.current_owner_membership_id = actor.membership_id
        OR lead.current_owner_membership_id IS NULL
      )
      AND (
        normalized_stage_filter = 'all'
        OR lead.stage_key = normalized_stage_filter
      )
      AND (
        normalized_assignment_filter = 'all'
        OR (
          normalized_assignment_filter = 'mine'
          AND lead.current_owner_membership_id = actor.membership_id
        )
        OR (
          normalized_assignment_filter = 'unassigned'
          AND lead.current_owner_membership_id IS NULL
        )
      )
      AND (
        p_owner_membership_id IS NULL
        OR lead.current_owner_membership_id = p_owner_membership_id
      )
      AND (
        normalized_due_filter = 'all'
        OR (
          normalized_due_filter = 'scheduled'
          AND lead.next_action_due_date IS NOT NULL
        )
        OR (
          normalized_due_filter = 'unscheduled'
          AND lead.next_action_due_date IS NULL
        )
        OR (
          normalized_due_filter = 'due_today'
          AND lead.next_action_due_date = bishkek_today
        )
        OR (
          normalized_due_filter = 'overdue'
          AND lead.next_action_due_date < bishkek_today
        )
      )
      AND (
        normalized_query IS NULL
        OR pg_catalog.strpos(
          pg_catalog.lower(
            pg_catalog.concat_ws(
              ' ',
              client.display_name,
              client.email,
              client.phone,
              owner_profile.display_name,
              lead.id::TEXT,
              lead.stage_key,
              lead.source_key,
              lead.next_action_text
            )
          ),
          normalized_query
        ) > 0
      )
  )
  SELECT
    visible.sort_at,
    visible.organization_id,
    visible.lead_id,
    visible.client_id,
    visible.client_display_name,
    visible.client_email,
    visible.client_phone,
    visible.current_owner_membership_id,
    visible.current_owner_display_name,
    visible.stage_key,
    visible.source_key,
    visible.lifecycle_state,
    visible.next_action_text,
    visible.next_action_due_date,
    visible.workflow_version,
    visible.is_connected,
    visible.open_duplicate_candidate_count,
    visible.linked_student_case_count,
    visible.linked_conversation_count,
    visible.created_at,
    visible.updated_at,
    visible.stage_entered_at
  FROM visible
  WHERE (
      normalized_connection_filter = 'all'
      OR (
        normalized_connection_filter = 'connected'
        AND visible.is_connected
      )
      OR (
        normalized_connection_filter = 'unconnected'
        AND NOT visible.is_connected
      )
    )
    AND (
      p_cursor_updated_at IS NULL
      OR (visible.sort_at, visible.lead_id)
        < (p_cursor_updated_at, p_cursor_id)
    )
  ORDER BY visible.sort_at DESC, visible.lead_id DESC
  LIMIT p_limit;
END
$$;

CREATE FUNCTION platform.staff_sales_lead_page(
  p_limit INTEGER,
  p_cursor_updated_at TIMESTAMPTZ DEFAULT NULL,
  p_cursor_id UUID DEFAULT NULL,
  p_connection_filter TEXT DEFAULT 'all',
  p_stage_filter TEXT DEFAULT NULL,
  p_assignment_filter TEXT DEFAULT 'all',
  p_owner_membership_id UUID DEFAULT NULL,
  p_due_filter TEXT DEFAULT 'all',
  p_query TEXT DEFAULT NULL
)
RETURNS TABLE (
  sort_at TIMESTAMPTZ,
  organization_id UUID,
  lead_id UUID,
  client_id UUID,
  client_display_name TEXT,
  client_email TEXT,
  client_phone TEXT,
  current_owner_membership_id UUID,
  current_owner_display_name TEXT,
  stage_key TEXT,
  source_key TEXT,
  lifecycle_state platform.lead_lifecycle_state,
  next_action_text TEXT,
  next_action_due_date DATE,
  workflow_version BIGINT,
  is_connected BOOLEAN,
  open_duplicate_candidate_count BIGINT,
  linked_student_case_count BIGINT,
  linked_conversation_count BIGINT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  stage_entered_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT page.*
  FROM private.staff_sales_lead_page(
    p_limit,
    p_cursor_updated_at,
    p_cursor_id,
    p_connection_filter,
    p_stage_filter,
    p_assignment_filter,
    p_owner_membership_id,
    p_due_filter,
    p_query
  ) AS page
$$;

REVOKE ALL ON FUNCTION platform.staff_sales_lead_page(
  INTEGER, TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION private.staff_sales_lead_page(
  INTEGER, TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.staff_sales_lead_page(
  INTEGER, TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION platform.staff_sales_lead_page(
  INTEGER, TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT
) TO authenticated;

COMMENT ON FUNCTION platform.staff_sales_lead_page(
  INTEGER, TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT
) IS
  'Bounded role-scoped U4 Sales queue with pre-limit connected, stage, assignment, due and query filters plus the receipt-and-audit-proven current-stage entry time (lead.created_at when no transition exists).';

-- ------------------------------------------------------------
-- (d) Admissions task queue: keyset cursor and due-day bounds.
-- The cursorless single-argument call keeps migration-110 behavior exactly;
-- only the argument list grows, so the old signature is dropped to keep one
-- unambiguous overload.
-- ------------------------------------------------------------

DROP FUNCTION platform.staff_case_task_queue(INTEGER);

CREATE FUNCTION private.staff_case_task_queue(
  p_limit INTEGER,
  p_after_sort_at TIMESTAMPTZ DEFAULT NULL,
  p_after_case_task_id UUID DEFAULT NULL,
  p_due_from DATE DEFAULT NULL,
  p_due_to DATE DEFAULT NULL
)
RETURNS TABLE (
  sort_at TIMESTAMPTZ,
  organization_id UUID,
  case_task_id UUID,
  version TEXT,
  student_case_id UUID,
  student_display_name TEXT,
  case_state platform.student_case_state,
  task_type TEXT,
  title TEXT,
  status platform.case_task_status,
  priority platform.case_task_priority,
  due_at TIMESTAMPTZ,
  due_on DATE,
  student_visible BOOLEAN,
  assignee_membership_id UUID,
  assignee_display_name TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 101 THEN
    RAISE EXCEPTION 'Task queue limit from 1 to 101 is required'
      USING ERRCODE = '22023';
  END IF;

  IF (p_after_sort_at IS NULL) <> (p_after_case_task_id IS NULL) THEN
    RAISE EXCEPTION 'Incomplete task queue cursor'
      USING ERRCODE = '22023';
  END IF;

  IF (
    p_due_from IS NOT NULL
    AND NOT pg_catalog.isfinite(p_due_from)
  ) OR (
    p_due_to IS NOT NULL
    AND NOT pg_catalog.isfinite(p_due_to)
  ) OR (
    p_due_from IS NOT NULL
    AND p_due_to IS NOT NULL
    AND p_due_to < p_due_from
  ) THEN
    RAISE EXCEPTION 'Invalid task queue due-day bounds'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_admissions_runtime_actor('task.manage');

  RETURN QUERY
  SELECT
    CASE
      WHEN case_task.due_at IS NOT NULL THEN case_task.due_at
      WHEN case_task.due_on IS NOT NULL THEN
        case_task.due_on::TIMESTAMP AT TIME ZONE 'Asia/Bishkek'
      ELSE '9999-12-31 00:00:00+00'::TIMESTAMPTZ
    END,
    case_task.organization_id,
    case_task.id,
    case_task.version::TEXT,
    case_task.student_case_id,
    student_case.student_display_name,
    student_case.state,
    case_task.task_type,
    case_task.title,
    case_task.status,
    case_task.priority,
    case_task.due_at,
    case_task.due_on,
    case_task.student_visible,
    case_task.assignee_membership_id,
    assignee_profile.display_name,
    case_task.created_at,
    case_task.updated_at
  FROM platform.case_tasks AS case_task
  JOIN platform.student_cases AS student_case
    ON student_case.organization_id = case_task.organization_id
    AND student_case.id = case_task.student_case_id
  JOIN platform.organization_memberships AS assignee_membership
    ON assignee_membership.organization_id = case_task.organization_id
    AND assignee_membership.id = case_task.assignee_membership_id
  JOIN platform.profiles AS assignee_profile
    ON assignee_profile.id = assignee_membership.profile_id
  WHERE case_task.organization_id = actor.organization_id
    AND student_case.state IN ('active', 'closed')
    AND student_case.handoff_at IS NOT NULL
    AND (
      actor.platform_role = 'admin'
      OR student_case.current_curator_membership_id = actor.membership_id
    )
    -- Keyset over the exact existing (deadline projection, id) order. A
    -- NULL cursor reproduces migration-110 output byte for byte.
    AND (
      p_after_sort_at IS NULL
      OR (
        CASE
          WHEN case_task.due_at IS NOT NULL THEN case_task.due_at
          WHEN case_task.due_on IS NOT NULL THEN
            case_task.due_on::TIMESTAMP AT TIME ZONE 'Asia/Bishkek'
          ELSE '9999-12-31 00:00:00+00'::TIMESTAMPTZ
        END,
        case_task.id
      ) > (p_after_sort_at, p_after_case_task_id)
    )
    -- Due-day bounds compare the canonical deadline day in the organization
    -- calendar: due_on for all-day work, the Bishkek day of due_at for timed
    -- work. Unscheduled tasks have no day and match no bound.
    AND (
      p_due_from IS NULL
      OR CASE
        WHEN case_task.due_at IS NOT NULL THEN
          pg_catalog.timezone('Asia/Bishkek', case_task.due_at)::DATE
        ELSE case_task.due_on
      END >= p_due_from
    )
    AND (
      p_due_to IS NULL
      OR CASE
        WHEN case_task.due_at IS NOT NULL THEN
          pg_catalog.timezone('Asia/Bishkek', case_task.due_at)::DATE
        ELSE case_task.due_on
      END <= p_due_to
    )
  ORDER BY
    CASE
      WHEN case_task.due_at IS NOT NULL THEN case_task.due_at
      WHEN case_task.due_on IS NOT NULL THEN
        case_task.due_on::TIMESTAMP AT TIME ZONE 'Asia/Bishkek'
      ELSE '9999-12-31 00:00:00+00'::TIMESTAMPTZ
    END,
    case_task.id
  LIMIT p_limit;
END
$$;

CREATE FUNCTION platform.staff_case_task_queue(
  p_limit INTEGER,
  p_after_sort_at TIMESTAMPTZ DEFAULT NULL,
  p_after_case_task_id UUID DEFAULT NULL,
  p_due_from DATE DEFAULT NULL,
  p_due_to DATE DEFAULT NULL
)
RETURNS TABLE (
  sort_at TIMESTAMPTZ,
  organization_id UUID,
  case_task_id UUID,
  version TEXT,
  student_case_id UUID,
  student_display_name TEXT,
  case_state platform.student_case_state,
  task_type TEXT,
  title TEXT,
  status platform.case_task_status,
  priority platform.case_task_priority,
  due_at TIMESTAMPTZ,
  due_on DATE,
  student_visible BOOLEAN,
  assignee_membership_id UUID,
  assignee_display_name TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT queue.*
  FROM private.staff_case_task_queue(
    p_limit,
    p_after_sort_at,
    p_after_case_task_id,
    p_due_from,
    p_due_to
  ) AS queue
$$;

REVOKE ALL ON FUNCTION platform.staff_case_task_queue(
  INTEGER, TIMESTAMPTZ, UUID, DATE, DATE
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION private.staff_case_task_queue(
  INTEGER, TIMESTAMPTZ, UUID, DATE, DATE
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.staff_case_task_queue(
  INTEGER, TIMESTAMPTZ, UUID, DATE, DATE
) TO authenticated;
GRANT EXECUTE ON FUNCTION platform.staff_case_task_queue(
  INTEGER, TIMESTAMPTZ, UUID, DATE, DATE
) TO authenticated;

COMMENT ON FUNCTION platform.staff_case_task_queue(
  INTEGER, TIMESTAMPTZ, UUID, DATE, DATE
) IS
  'Bounded Admissions task queue in canonical (deadline projection, id) order with an optional keyset cursor and optional inclusive due-day bounds; a cursorless call reproduces migration-110 behavior exactly.';

COMMIT;
