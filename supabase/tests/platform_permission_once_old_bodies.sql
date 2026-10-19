\set ON_ERROR_STOP on
-- Прежние (выпущенные до 310) тела функций, которые заменяет миграция 310, под временными
-- именами private.pw310_old_*. Файл подключается набором platform_permission_once.sql
-- внутри его транзакции (ROLLBACK убирает всё). Тексты сняты pg_get_functiondef с цепочки
-- 001-309; для девяти заменяемых функций md5(prosrc) равен якорю миграции 310 (набор это
-- проверяет). Две обёртки (..._sales_lead_page_note, ..._read_snapshot) отличаются от
-- выпущенных только именем вызываемой копии. Синтетика: только определения функций.

-- private.staff_communication_page
CREATE FUNCTION private.pw310_old_communication_page(p_organization_id uuid, p_limit integer, p_before_sort_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_conversation_id uuid DEFAULT NULL::uuid, p_queue platform.communication_queue DEFAULT NULL::platform.communication_queue, p_status platform.communication_status DEFAULT NULL::platform.communication_status, p_conversation_id uuid DEFAULT NULL::uuid, p_query text DEFAULT NULL::text, p_waiting_only boolean DEFAULT false, p_unanswered_first boolean DEFAULT false, p_before_waiting boolean DEFAULT NULL::boolean)
 RETURNS TABLE(conversation_id uuid, student_case_id uuid, queue platform.communication_queue, status platform.communication_status, subject text, waha_session_name text, kommo_account_id bigint, kommo_conversation_id text, amocrm_account_id bigint, amocrm_lead_id bigint, amocrm_contact_id bigint, created_at timestamp with time zone, sort_at timestamp with time zone, last_message_direction platform.communication_direction, last_message_at timestamp with time zone, waiting_since timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  normalized_query TEXT;
  normalized_phone_query TEXT;
  unanswered_first CONSTANT BOOLEAN := COALESCE(p_unanswered_first, FALSE);
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 101 THEN
    RAISE EXCEPTION 'Invalid page limit' USING ERRCODE = '22023';
  END IF;

  IF (p_before_sort_at IS NULL) <> (p_before_conversation_id IS NULL) THEN
    RAISE EXCEPTION 'Incomplete conversation cursor' USING ERRCODE = '22023';
  END IF;

  -- «Неотвеченные»: the cursor carries the group of its row; elsewhere it
  -- has none.
  IF (unanswered_first AND (p_before_sort_at IS NULL) <> (p_before_waiting IS NULL))
    OR (NOT unanswered_first AND p_before_waiting IS NOT NULL)
  THEN
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
    latest_message.created_at AS last_message_at,
    waiting_message.created_at AS waiting_since
  FROM platform.communication_conversations AS conversation
  LEFT JOIN platform.clients AS canonical_client
    ON canonical_client.organization_id = conversation.organization_id
    AND canonical_client.id = conversation.canonical_client_id
  LEFT JOIN LATERAL (
    SELECT message.id, message.created_at, message.direction
    FROM platform.communication_messages AS message
    WHERE message.organization_id = conversation.organization_id
      AND message.conversation_id = conversation.id
    ORDER BY message.created_at DESC, message.id DESC
    LIMIT 1
  ) AS latest_message ON TRUE
  LEFT JOIN LATERAL (
    SELECT message.id, message.created_at
    FROM platform.communication_messages AS message
    WHERE message.organization_id = conversation.organization_id
      AND message.conversation_id = conversation.id
      AND message.direction = 'outbound'
    ORDER BY message.created_at DESC, message.id DESC
    LIMIT 1
  ) AS latest_outbound ON latest_message.direction = 'inbound'
  LEFT JOIN LATERAL (
    SELECT message.created_at
    FROM platform.communication_messages AS message
    WHERE message.organization_id = conversation.organization_id
      AND message.conversation_id = conversation.id
      AND message.direction = 'inbound'
      AND (
        latest_outbound.id IS NULL
        OR (message.created_at, message.id)
          > (latest_outbound.created_at, latest_outbound.id)
      )
    ORDER BY message.created_at ASC, message.id ASC
    LIMIT 1
  ) AS waiting_message ON latest_message.direction = 'inbound'
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
      NOT COALESCE(p_waiting_only, FALSE)
      OR waiting_message.created_at IS NOT NULL
    )
    AND (
      p_before_sort_at IS NULL
      OR (
        NOT unanswered_first
        AND (
          GREATEST(
            conversation.updated_at,
            COALESCE(latest_message.created_at, conversation.updated_at)
          ),
          conversation.id
        ) < (p_before_sort_at, p_before_conversation_id)
      )
      OR (
        unanswered_first
        AND (
          waiting_message.created_at IS NOT NULL,
          GREATEST(
            conversation.updated_at,
            COALESCE(latest_message.created_at, conversation.updated_at)
          ),
          conversation.id
        ) < (p_before_waiting, p_before_sort_at, p_before_conversation_id)
      )
    )
  ORDER BY
    -- FALSE for every row unless «Неотвеченные»: the default order is 122's.
    (unanswered_first AND waiting_message.created_at IS NOT NULL) DESC,
    GREATEST(
      conversation.updated_at,
      COALESCE(latest_message.created_at, conversation.updated_at)
    ) DESC,
    conversation.id DESC
  LIMIT p_limit;
END
$function$;

-- private.staff_sales_lead_page
CREATE FUNCTION private.pw310_old_sales_lead_page(p_limit integer, p_cursor_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid, p_connection_filter text DEFAULT 'all'::text, p_stage_filter text DEFAULT NULL::text, p_assignment_filter text DEFAULT 'all'::text, p_owner_membership_id uuid DEFAULT NULL::uuid, p_due_filter text DEFAULT 'all'::text, p_query text DEFAULT NULL::text)
 RETURNS TABLE(sort_at timestamp with time zone, organization_id uuid, lead_id uuid, client_id uuid, client_display_name text, client_email text, client_phone text, current_owner_membership_id uuid, current_owner_display_name text, stage_key text, source_key text, lifecycle_state platform.lead_lifecycle_state, next_action_text text, next_action_due_date date, workflow_version bigint, is_connected boolean, open_duplicate_candidate_count bigint, linked_student_case_count bigint, linked_conversation_count bigint, created_at timestamp with time zone, updated_at timestamp with time zone, stage_entered_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  WHERE platform_private.staff_has_permission(authority.organization_id,authority.membership_id,'lead.read');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sales_workflow_forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF p_owner_membership_id IS NOT NULL
    AND (
      NOT platform_private.is_eligible_sales_owner(
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
      AND platform_private.staff_can_access(lead.organization_id,actor.membership_id,'lead.read','lead',lead.id)
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
      ) AS is_exact
    FROM visible_lead_scope AS scope
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
              AND (source_event.verification_status = 'verified'
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
              ) <> 'api' OR platform_private.waha_history_binding_source_ok(source_event.organization_id, source_event.id))
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
              AND (source_event.verification_status = 'verified'
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
              ) <> 'api' OR platform_private.waha_history_binding_source_ok(source_event.organization_id, source_event.id))
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
      AND platform_private.staff_can_access(lead.organization_id,actor.membership_id,'lead.read','lead',lead.id)
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
$function$;

-- private.staff_sales_lead_page_with_latest_note
CREATE FUNCTION private.pw310_old_sales_lead_page_note(p_limit integer, p_cursor_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid, p_connection_filter text DEFAULT 'all'::text, p_stage_filter text DEFAULT NULL::text, p_assignment_filter text DEFAULT 'all'::text, p_owner_membership_id uuid DEFAULT NULL::uuid, p_due_filter text DEFAULT 'all'::text, p_query text DEFAULT NULL::text)
 RETURNS TABLE(sort_at timestamp with time zone, organization_id uuid, lead_id uuid, client_id uuid, client_display_name text, client_email text, client_phone text, current_owner_membership_id uuid, current_owner_display_name text, stage_key text, source_key text, lifecycle_state platform.lead_lifecycle_state, next_action_text text, next_action_due_date date, workflow_version bigint, is_connected boolean, open_duplicate_candidate_count bigint, linked_student_case_count bigint, linked_conversation_count bigint, created_at timestamp with time zone, updated_at timestamp with time zone, stage_entered_at timestamp with time zone, latest_note_id uuid, latest_note_body text, latest_note_author_display_name text, latest_note_created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT
    page.*,
    latest_note.id,
    latest_note.body,
    latest_note.author_display_name,
    latest_note.created_at
  FROM private.pw310_old_sales_lead_page(
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
  LEFT JOIN LATERAL (
    SELECT
      note.id,
      note.body,
      author_profile.display_name AS author_display_name,
      note.created_at
    FROM platform.case_notes AS note
    JOIN platform.organization_memberships AS author_membership
      ON author_membership.organization_id = note.organization_id
     AND author_membership.id = note.created_by_membership_id
    JOIN platform.profiles AS author_profile
      ON author_profile.id = author_membership.profile_id
    WHERE note.organization_id = page.organization_id
      AND note.lead_id = page.lead_id
      AND note.student_case_id IS NULL
    ORDER BY note.created_at DESC, note.id DESC
    LIMIT 1
  ) AS latest_note ON TRUE
$function$;

-- platform.staff_sales_count_v1
CREATE FUNCTION private.pw310_old_sales_count(p_organization_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  actor RECORD;
  first_month DATE;
  sales_count BIGINT;
  undated_count BIGINT;
  other_count BIGINT;
  elsewhere_count BIGINT;
BEGIN
  SELECT a.* INTO actor FROM platform.current_actor_authority() a
  WHERE a.organization_id = p_organization_id AND a.membership_id IS NOT NULL
    AND a.platform_role IS DISTINCT FROM 'student'
    AND platform_private.staff_has_permission(a.organization_id, a.membership_id, 'sales.register.read');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sales_count_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to
    OR p_from < DATE '1900-01-01' OR p_to > DATE '2100-12-31' OR p_to - p_from > 366 THEN
    RAISE EXCEPTION 'sales_count_invalid' USING ERRCODE = '22023';
  END IF;
  first_month := date_trunc('month', p_from)::DATE;

  -- The same record visibility as read_sales_register_v2 (216). A sale date
  -- is the record's own «Дата продажи»; nothing falls back to report_month.
  WITH visible AS MATERIALIZED (
    SELECT r.report_month, NULLIF(r.fields->>'signing_date', '')::DATE AS sale_date
    FROM platform_private.sales_register r
    WHERE r.organization_id = p_organization_id AND NOT r.archived AND r.withdrawal_kind IS NULL
      AND platform_private.staff_can_access(
        p_organization_id, actor.membership_id, 'sales.register.read', 'sales_register', r.id)
  )
  SELECT
    count(*) FILTER (WHERE v.sale_date BETWEEN p_from AND p_to),
    count(*) FILTER (WHERE v.sale_date IS NULL AND v.report_month BETWEEN first_month AND p_to),
    count(*) FILTER (WHERE v.sale_date IS NOT NULL AND v.sale_date NOT BETWEEN p_from AND p_to
      AND v.report_month BETWEEN first_month AND p_to),
    count(*) FILTER (WHERE v.sale_date BETWEEN p_from AND p_to
      AND v.report_month NOT BETWEEN first_month AND p_to)
  INTO sales_count, undated_count, other_count, elsewhere_count
  FROM visible v;

  RETURN jsonb_build_object(
    'organization_id', p_organization_id, 'from', p_from, 'to', p_to,
    'sales', sales_count::TEXT,
    'undated', undated_count::TEXT,
    'other_sale_date', other_count::TEXT,
    'filed_elsewhere', elsewhere_count::TEXT);
END
$function$;

-- platform.read_sales_register_v5
CREATE FUNCTION private.pw310_old_register_v5(p_organization_id uuid, p_year integer, p_month integer DEFAULT NULL::integer, p_offset integer DEFAULT 0, p_record_id uuid DEFAULT NULL::uuid, p_archived boolean DEFAULT false, p_manager_key text DEFAULT NULL::text, p_direction text DEFAULT NULL::text, p_needs_review boolean DEFAULT NULL::boolean, p_query text DEFAULT NULL::text, p_sale_slice text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor RECORD; selected JSONB:=NULL; rows JSONB; total BIGINT; totals JSONB; targets JSONB; owners JSONB;
 managers JSONB; facets JSONB; withdrawn JSONB;
 unresolved_cost BIGINT; unresolved_paid BIGINT; first_month DATE; last_month DATE; period_end DATE;
 normalized_query TEXT := NULLIF(btrim(p_query),''); query_lower TEXT; query_digits TEXT;
 manager_key TEXT := CASE WHEN p_manager_key IS NULL THEN NULL ELSE platform_private.sales_manager_label_key(p_manager_key) END;
BEGIN
 SELECT * INTO actor FROM platform_private.sales_register_actor(p_organization_id);
 IF p_year IS NULL OR p_year NOT BETWEEN 1900 AND 2100 OR (p_month IS NOT NULL AND p_month NOT BETWEEN 1 AND 12)
   OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 1000000 OR p_archived IS NULL
   OR (p_manager_key IS NOT NULL AND (length(p_manager_key) NOT BETWEEN 1 AND 300 OR p_manager_key ~ '[[:cntrl:]]' OR manager_key = ''))
   OR (p_direction IS NOT NULL AND (length(p_direction) NOT BETWEEN 1 AND 500 OR p_direction ~ '[[:cntrl:]]'))
   OR (p_query IS NOT NULL AND (length(p_query)>200 OR p_query ~ '[[:cntrl:]]'))
   OR (p_sale_slice IS NOT NULL AND (p_sale_slice NOT IN ('undated','other_sale_date','filed_elsewhere') OR p_archived)) THEN
   RAISE EXCEPTION 'sales_register_invalid_filter' USING ERRCODE='22023'; END IF;
 query_lower:=lower(normalized_query);
 query_digits:=CASE WHEN normalized_query ~ '^[+0-9 ().-]+$'
   THEN NULLIF(regexp_replace(normalized_query,'[^0-9]','','g'),'') ELSE NULL END;
 first_month:=make_date(p_year,coalesce(p_month,1),1);
 last_month:=CASE WHEN p_month IS NULL THEN make_date(p_year,12,1) ELSE first_month END;
 period_end:=(last_month + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
 IF p_record_id IS NOT NULL THEN
   SELECT platform_private.sales_register_row_v3(r) INTO selected FROM platform_private.sales_register r
     WHERE r.organization_id=p_organization_id AND r.id=p_record_id AND platform_private.staff_can_access(p_organization_id, actor.membership_id,
      'sales.register.read', 'sales_register', r.id);
   IF NOT FOUND THEN RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501'; END IF;
 END IF;
 -- `base` is v3's selection without the manager filter: the manager options
 -- count what choosing each of them would show.
 WITH base AS MATERIALIZED (SELECT r.* FROM platform_private.sales_register r WHERE r.organization_id=p_organization_id
   AND platform_private.staff_can_access(p_organization_id, actor.membership_id,
      'sales.register.read', 'sales_register', r.id) AND r.archived=p_archived
   -- The slices explain the number «Продажи», which has no refusals (307).
   AND (p_sale_slice IS NULL OR r.withdrawal_kind IS NULL)
   AND CASE WHEN p_sale_slice = 'filed_elsewhere'
     THEN NULLIF(r.fields->>'signing_date','')::DATE BETWEEN first_month AND period_end
       AND r.report_month NOT BETWEEN first_month AND last_month
     ELSE r.report_month BETWEEN first_month AND last_month END
   AND (p_sale_slice IS NULL OR p_sale_slice = 'filed_elsewhere'
     OR (p_sale_slice = 'undated' AND NULLIF(r.fields->>'signing_date','') IS NULL)
     OR (p_sale_slice = 'other_sale_date'
       AND NULLIF(r.fields->>'signing_date','')::DATE NOT BETWEEN first_month AND period_end))
   AND (p_direction IS NULL OR r.fields->>'direction'=p_direction)
   AND (p_needs_review IS NULL OR (r.fields->>'needs_review')::BOOLEAN=p_needs_review)
   AND (normalized_query IS NULL
     OR strpos(lower(coalesce(r.fields->>'applicant_name','')),query_lower)>0
     OR strpos(lower(coalesce(r.fields->>'contract_number','')),query_lower)>0
     OR (query_digits IS NOT NULL AND strpos(regexp_replace(coalesce(r.fields->>'phone',''),'[^0-9]','','g'),query_digits)>0))),
 filtered AS MATERIALIZED (SELECT b.* FROM base b
   WHERE manager_key IS NULL OR platform_private.sales_manager_label_key(b.fields->>'manager_label')=manager_key),
 -- Paid side of the totals: «Оплачено в валюте договора» for a record paid in
 -- another currency when that amount is in the cost currency; else as v3.
 paid AS (SELECT (f.withdrawal_kind IS NOT NULL) AS refused, CASE WHEN f.paid_contract_minor IS NOT NULL AND f.paid_contract_currency=f.fields->>'service_cost_currency'
       AND f.fields->>'paid_currency' IS DISTINCT FROM f.fields->>'service_cost_currency'
     THEN f.paid_contract_currency ELSE f.fields->>'paid_currency' END AS currency,
   CASE WHEN f.paid_contract_minor IS NOT NULL AND f.paid_contract_currency=f.fields->>'service_cost_currency'
       AND f.fields->>'paid_currency' IS DISTINCT FROM f.fields->>'service_cost_currency'
     THEN f.paid_contract_minor ELSE (f.fields->>'paid_minor')::BIGINT END AS minor
   FROM filtered f WHERE f.fields->>'paid_minor' IS NOT NULL)
 SELECT (SELECT count(*) FROM filtered),
   coalesce((SELECT jsonb_agg(platform_private.sales_register_row_v3(page::platform_private.sales_register) ORDER BY page.report_month DESC,page.id) FROM
      (SELECT * FROM filtered ORDER BY report_month DESC,id LIMIT 50 OFFSET p_offset) page),'[]'),
   (SELECT count(*) FROM filtered WHERE withdrawal_kind IS NULL AND fields->>'service_cost_minor' IS NULL),
   (SELECT count(*) FROM filtered WHERE withdrawal_kind IS NULL AND fields->>'paid_minor' IS NULL),
   coalesce((SELECT jsonb_agg(jsonb_build_object('currency',currency,'cost_minor',cost_minor::TEXT,'paid_minor',paid_minor::TEXT) ORDER BY currency)
     FROM (SELECT currency,sum(cost_minor) cost_minor,sum(paid_minor) paid_minor FROM (
       SELECT fields->>'service_cost_currency' currency,(fields->>'service_cost_minor')::BIGINT cost_minor,0::BIGINT paid_minor FROM filtered WHERE withdrawal_kind IS NULL AND fields->>'service_cost_minor' IS NOT NULL
       UNION ALL SELECT p.currency,0::BIGINT,p.minor FROM paid p WHERE NOT p.refused) amounts GROUP BY currency) sums),'[]'),
   coalesce((SELECT jsonb_object_agg(k.key, k.n) FROM (SELECT platform_private.sales_manager_label_key(b.fields->>'manager_label') AS key, count(*) AS n
     FROM base b GROUP BY 1) k WHERE k.key<>''),'{}'),
   -- Refusals stay in the table but not in the sums above; what was paid on them is named apart.
   jsonb_build_object('count',(SELECT count(*) FROM filtered WHERE withdrawal_kind IS NOT NULL),
     'paid',coalesce((SELECT jsonb_agg(jsonb_build_object('currency',w.currency,'paid_minor',w.minor::TEXT) ORDER BY w.currency)
       FROM (SELECT p.currency,sum(p.minor) minor FROM paid p WHERE p.refused GROUP BY p.currency) w),'[]'))
 INTO total,rows,unresolved_cost,unresolved_paid,totals,facets,withdrawn;
 IF p_archived THEN totals:='[]'; unresolved_cost:=0; unresolved_paid:=0; withdrawn:=jsonb_build_object('count',0,'paid','[]'::JSONB); END IF;
 -- Menu of managers: every key the actor can read (as v3's labels), named by
 -- the owner's mapping or, unmapped, by its most frequent tidy spelling.
 WITH spelled AS (SELECT platform_private.sales_manager_label_key(r.fields->>'manager_label') AS key,
     regexp_replace(btrim(r.fields->>'manager_label'),'[[:space:]]+',' ','g') AS tidy, count(*) AS n
   FROM platform_private.sales_register r WHERE r.organization_id=p_organization_id AND platform_private.staff_can_access(p_organization_id, actor.membership_id,
      'sales.register.read', 'sales_register', r.id)
   AND r.fields->>'manager_label'<>'' GROUP BY 1,2),
 best AS (SELECT DISTINCT ON (s.key) s.key, s.tidy FROM spelled s WHERE s.key<>'' ORDER BY s.key, s.n DESC, s.tidy),
 named AS (SELECT b.key, left(coalesce(m.display_name, b.tidy),300) AS name FROM best b
   LEFT JOIN platform_private.sales_manager_labels m ON m.organization_id=p_organization_id AND m.label_key=b.key AND m.display_name IS NOT NULL
   ORDER BY 2, 1 LIMIT 1000)
 SELECT coalesce(jsonb_agg(jsonb_build_object('key',n.key,'name',n.name,'count',coalesce((facets->>n.key)::BIGINT,0)) ORDER BY n.name,n.key),'[]')
   INTO managers FROM named n;
 IF platform_private.staff_can_access(p_organization_id, actor.membership_id,
      'sales.register.target.manage', 'organization', p_organization_id) THEN
   SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.id,'version',t.version::TEXT,'report_month',t.report_month,
     'manager_label',t.manager_label,'target_count',t.target_count) ORDER BY t.report_month,t.manager_label),'[]') INTO targets
     FROM platform_private.sales_register_targets t WHERE t.organization_id=p_organization_id AND t.report_month BETWEEN first_month AND last_month;
 ELSE targets:='[]'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'label',left(btrim(regexp_replace(coalesce(p.display_name,''),'[[:cntrl:]]',' ','g')),300)) ORDER BY p.display_name,m.id),'[]') INTO owners
 FROM platform.organization_memberships m JOIN platform.profiles p ON p.id=m.profile_id
 WHERE m.organization_id=p_organization_id AND platform_private.staff_can_receive_assignment(p_organization_id, m.id, 'sales.register.read', 'sales_register', NULL)
   AND platform_private.staff_can_create_for_owner(p_organization_id, actor.membership_id,
     'sales.register.manage', 'sales_register', m.id);
 RETURN jsonb_build_object('query',normalized_query,'manager_key',manager_key,'organization_id',p_organization_id,'year',p_year,'month',p_month,'offset',p_offset,
   'total_count',total,'rows',rows,'selected',selected,'has_more',p_offset+50<total,'totals',totals,
   'unresolved_cost_count',unresolved_cost,'unresolved_paid_count',unresolved_paid,'targets',targets,'manager_options',managers,'owner_options',owners,
   'withdrawn',withdrawn);
END $function$;

-- platform.staff_sales_stage_entry_cohort
CREATE FUNCTION private.pw310_old_stage_entry_cohort(p_from_date date, p_to_date date, p_limit integer DEFAULT 101, p_cursor_entered_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_request_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(organization_id uuid, lead_id uuid, stage_key text, entered_at timestamp with time zone, entered_on date, request_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  WHERE platform_private.staff_has_permission(authority.organization_id,authority.membership_id,'lead.read');

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
      AND platform_private.staff_can_access(lead.organization_id,actor.membership_id,'lead.read','lead',lead.id)
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
      AND platform_private.staff_can_access(lead.organization_id,actor.membership_id,'lead.read','lead',lead.id)
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
$function$;

-- platform.staff_student_case_sales_links
CREATE FUNCTION private.pw310_old_sales_links(p_organization_id uuid, p_student_case_ids uuid[])
 RETURNS TABLE(student_case_id uuid, lead_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF p_organization_id IS NULL
    OR p_organization_id = '00000000-0000-0000-0000-000000000000'::UUID
  THEN
    RAISE EXCEPTION 'Invalid student-case sales-link organization'
      USING ERRCODE = '22023';
  END IF;

  IF p_student_case_ids IS NULL
    OR pg_catalog.cardinality(p_student_case_ids) NOT BETWEEN 1 AND 100
  THEN
    RAISE EXCEPTION 'Student-case sales-link scope must contain 1 to 100 ids'
      USING ERRCODE = '22023';
  END IF;

  IF pg_catalog.array_ndims(p_student_case_ids) <> 1 THEN
    RAISE EXCEPTION 'Student-case sales-link scope must be one-dimensional'
      USING ERRCODE = '22023';
  END IF;

  IF pg_catalog.array_position(p_student_case_ids, NULL::UUID) IS NOT NULL
    OR pg_catalog.array_position(
      p_student_case_ids,
      '00000000-0000-0000-0000-000000000000'::UUID
    ) IS NOT NULL
  THEN
    RAISE EXCEPTION 'Student-case sales-link scope contains an invalid id'
      USING ERRCODE = '22023';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM (
      SELECT DISTINCT requested.student_case_id
      FROM pg_catalog.unnest(p_student_case_ids)
        AS requested(student_case_id)
    ) AS unique_requested_cases
  ) <> pg_catalog.cardinality(p_student_case_ids)
  THEN
    RAISE EXCEPTION 'Student-case sales-link scope contains duplicate ids'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH visible_leads AS MATERIALIZED (
    SELECT
      visible.organization_id,
      visible.lead_id
    FROM platform_private.visible_canonical_leads() AS visible
    WHERE visible.organization_id = p_organization_id
  )
  SELECT
    student_case.id,
    visible_lead.lead_id
  FROM platform.current_actor_authority() AS actor
  JOIN platform.student_cases AS student_case
    ON student_case.organization_id = actor.organization_id
   AND student_case.organization_id = p_organization_id
  JOIN visible_leads AS visible_lead
    ON visible_lead.organization_id = student_case.organization_id
   AND visible_lead.lead_id = student_case.canonical_lead_id
  WHERE student_case.id = ANY (p_student_case_ids)
    AND COALESCE(
      private.platform_can_read_student_case(
        student_case.organization_id,
        student_case.id
      ),
      FALSE
    )
  ORDER BY student_case.id;
END
$function$;

-- platform.staff_student_case_page
CREATE FUNCTION private.pw310_old_case_page(p_limit integer, p_before_sort_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_student_case_id uuid DEFAULT NULL::uuid, p_state platform.student_case_state DEFAULT NULL::platform.student_case_state, p_query text DEFAULT NULL::text, p_student_case_id uuid DEFAULT NULL::uuid, p_direction text DEFAULT NULL::text, p_curator_membership_id uuid DEFAULT NULL::uuid, p_attention text DEFAULT NULL::text)
 RETURNS TABLE(access_mode text, sort_at timestamp with time zone, organization_id uuid, student_case_id uuid, student_display_name text, target_country text, target_degree text, program_direction text, intake text, language_assumption text, funding_assumption text, route_approval_status platform.route_approval_status, operational_stage text, state platform.student_case_state, created_at timestamp with time zone, updated_at timestamp with time zone, handoff_at timestamp with time zone, next_action text, responsible_sales_display_name text, current_curator_display_name text, applied_ozo_workflow_contract_version_id uuid, overdue_task_count bigint, overdue_obligation_count bigint, rejected_document_count bigint, admissions_direction text, next_action_due_on date, admissions_version bigint, attention_flags text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF (p_direction IS NOT NULL AND p_direction NOT IN ('CN','MY','EUROPE','AE','TR','unknown')) OR (p_attention IS NOT NULL AND p_attention NOT IN ('overdue','awaiting_partner','submitted','decisions','visas','arrivals','awaiting_ack','needs_curator')) THEN RAISE EXCEPTION 'Invalid admissions filters' USING ERRCODE='22023'; END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 101 THEN
    RAISE EXCEPTION 'Invalid page limit' USING ERRCODE = '22023';
  END IF;

  IF (p_before_sort_at IS NULL) <> (p_before_student_case_id IS NULL) THEN
    RAISE EXCEPTION 'Incomplete student-case cursor' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH visible AS MATERIALIZED (
    SELECT
      'full'::TEXT AS access_mode,
      student_case.updated_at AS sort_at,
      student_case.organization_id,
      student_case.id AS student_case_id,
      student_case.student_display_name,
      student_case.target_country,
      student_case.target_degree,
      student_case.program_direction,
      student_case.intake,
      student_case.language_assumption,
      student_case.funding_assumption,
      student_case.route_approval_status,
      student_case.operational_stage,
      student_case.state,
      student_case.created_at,
      student_case.updated_at,
      student_case.handoff_at,
      student_case.next_action,
      sales_profile.display_name AS responsible_sales_display_name,
      curator_profile.display_name AS current_curator_display_name,
      student_case.applied_ozo_workflow_contract_version_id,
      student_case.admissions_direction,student_case.next_action_due_on,student_case.admissions_version
    FROM platform.current_actor_authority() AS authority
    JOIN platform.student_cases AS student_case
      ON student_case.organization_id = authority.organization_id
    LEFT JOIN platform.organization_memberships AS sales_membership
      ON sales_membership.organization_id = student_case.organization_id
     AND sales_membership.id = student_case.responsible_sales_membership_id
    LEFT JOIN platform.profiles AS sales_profile
      ON sales_profile.id = sales_membership.profile_id
    LEFT JOIN platform.organization_memberships AS curator_membership
      ON curator_membership.organization_id = student_case.organization_id
     AND curator_membership.id = student_case.current_curator_membership_id
    LEFT JOIN platform.profiles AS curator_profile
      ON curator_profile.id = curator_membership.profile_id
    WHERE private.platform_can_read_student_case(
      student_case.organization_id,
      student_case.id
    )

    UNION ALL

    SELECT
      'sales_summary'::TEXT,
      student_case.handoff_at,
      student_case.organization_id,
      student_case.id,
      student_case.student_display_name,
      student_case.target_country,
      student_case.target_degree,
      NULL::TEXT,
      NULL::TEXT,
      NULL::TEXT,
      NULL::TEXT,
      NULL::platform.route_approval_status,
      NULL::TEXT,
      student_case.state,
      student_case.created_at,
      student_case.updated_at,
      student_case.handoff_at,
      NULL::TEXT,
      NULL::TEXT,
      curator_profile.display_name,
      NULL::UUID, NULL::TEXT, NULL::DATE, NULL::BIGINT
    FROM platform.current_actor_authority() AS authority
    JOIN platform.student_cases AS student_case
      ON student_case.organization_id = authority.organization_id
    JOIN platform.organization_memberships AS sales_membership
      ON sales_membership.organization_id = student_case.organization_id
     AND sales_membership.id = student_case.responsible_sales_membership_id
    JOIN platform.profiles AS sales_profile
      ON sales_profile.id = sales_membership.profile_id
    JOIN platform.organization_memberships AS curator_membership
      ON curator_membership.organization_id = student_case.organization_id
     AND curator_membership.id = student_case.current_curator_membership_id
    JOIN platform.profiles AS curator_profile
      ON curator_profile.id = curator_membership.profile_id
    WHERE sales_profile.auth_user_id = (SELECT auth.uid())
      AND sales_membership.status = 'active'
      AND platform_private.is_eligible_staff_responsibility(sales_membership.organization_id, sales_membership.id, 'sales')
      AND sales_profile.status = 'active'
      AND curator_membership.status = 'active'
      AND platform_private.is_eligible_staff_responsibility(curator_membership.organization_id, curator_membership.id, 'curator')
      AND curator_profile.status = 'active'
      AND student_case.state IN ('active', 'closed')
      AND student_case.handoff_at IS NOT NULL
      AND private.platform_has_permission(
        student_case.organization_id,
        'case.read.summary'
      )
      AND NOT COALESCE(
        private.platform_can_read_student_case(
          student_case.organization_id,
          student_case.id
        ),
        FALSE
      )
  ),
  page AS MATERIALIZED (
    SELECT visible.*
    FROM visible
    WHERE (p_state IS NULL OR visible.state = p_state)
      AND (p_direction IS NULL OR (visible.access_mode = 'full' AND COALESCE(visible.admissions_direction,'unknown')=p_direction))
      AND (p_curator_membership_id IS NULL OR (visible.access_mode = 'full' AND EXISTS(SELECT 1 FROM platform.student_cases f WHERE f.organization_id=visible.organization_id AND f.id=visible.student_case_id AND f.current_curator_membership_id=p_curator_membership_id)))
      AND (p_attention IS NULL OR (visible.access_mode = 'full' AND p_attention=ANY(platform_private.admissions_attention_flags(visible.student_case_id))))
      AND (
        p_student_case_id IS NULL
        OR visible.student_case_id = p_student_case_id
      )
      AND (
        p_query IS NULL
        OR btrim(p_query) = ''
        OR strpos(
          lower(concat_ws(
            ' ',
            visible.student_display_name,
            visible.target_country,
            visible.target_degree,
            visible.program_direction
          )),
          lower(btrim(p_query))
        ) > 0
      )
      AND (
        p_before_sort_at IS NULL
        OR (visible.sort_at, visible.student_case_id)
          < (p_before_sort_at, p_before_student_case_id)
      )
    ORDER BY visible.sort_at DESC, visible.student_case_id DESC
    LIMIT p_limit
  )
  SELECT
    page.access_mode,
    page.sort_at,
    page.organization_id,
    page.student_case_id,
    page.student_display_name,
    page.target_country,
    page.target_degree,
    page.program_direction,
    page.intake,
    page.language_assumption,
    page.funding_assumption,
    page.route_approval_status,
    page.operational_stage,
    page.state,
    page.created_at,
    page.updated_at,
    page.handoff_at,
    page.next_action,
    page.responsible_sales_display_name,
    page.current_curator_display_name,
    page.applied_ozo_workflow_contract_version_id,
    CASE WHEN page.access_mode = 'full' THEN (
      SELECT count(*)
      FROM platform.case_tasks AS task
      WHERE task.organization_id = page.organization_id
        AND task.student_case_id = page.student_case_id
        AND (
          (task.due_at IS NOT NULL AND task.due_at < statement_timestamp())
          OR (
            task.due_on IS NOT NULL
            AND (statement_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE
              > task.due_on
          )
        )
        AND task.status NOT IN ('done', 'cancelled')
    ) END,
    CASE WHEN page.access_mode = 'full' THEN (
      SELECT count(*)
      FROM platform.payment_obligations AS obligation
      WHERE obligation.organization_id = page.organization_id
        AND obligation.student_case_id = page.student_case_id
        AND obligation.due_at < statement_timestamp()
        AND obligation.total_paid_minor - obligation.total_refunded_minor
          < obligation.amount_minor
    ) END,
    CASE WHEN page.access_mode = 'full' THEN (
      SELECT count(*)
      FROM platform.document_slots AS slot
      WHERE slot.organization_id = page.organization_id
        AND slot.student_case_id = page.student_case_id
        AND slot.status = 'rejected'
    ) END, page.admissions_direction,page.next_action_due_on,page.admissions_version,
    CASE WHEN page.access_mode = 'full' THEN platform_private.admissions_attention_flags(page.student_case_id) END
  FROM page
  ORDER BY page.sort_at DESC, page.student_case_id DESC;
END
$function$;

-- platform.staff_student_case_read_snapshot
CREATE FUNCTION private.pw310_old_read_snapshot(p_student_case_id uuid)
 RETURNS TABLE(access_mode text, sort_at timestamp with time zone, organization_id uuid, student_case_id uuid, student_display_name text, target_country text, target_degree text, program_direction text, intake text, language_assumption text, funding_assumption text, route_approval_status platform.route_approval_status, operational_stage text, state platform.student_case_state, created_at timestamp with time zone, updated_at timestamp with time zone, handoff_at timestamp with time zone, next_action text, responsible_sales_display_name text, current_curator_display_name text, applied_ozo_workflow_contract_version_id uuid, overdue_task_count bigint, overdue_obligation_count bigint, rejected_document_count bigint, student_case_op_handoff_id uuid, op_workflow_contract_version_id uuid, approved_commercial_fields jsonb, unresolved_questions jsonb, promises jsonb, handoff_next_step text, handoff_due_at timestamp with time zone, handoff_responsible_role platform.business_role, handoff_created_at timestamp with time zone, admissions_direction text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT
    page.access_mode, page.sort_at, page.organization_id, page.student_case_id,
    page.student_display_name, page.target_country, page.target_degree,
    page.program_direction, page.intake, page.language_assumption,
    page.funding_assumption, page.route_approval_status, page.operational_stage,
    page.state, page.created_at, page.updated_at, page.handoff_at, page.next_action,
    page.responsible_sales_display_name, page.current_curator_display_name,
    page.applied_ozo_workflow_contract_version_id, page.overdue_task_count,
    page.overdue_obligation_count, page.rejected_document_count,
    CASE WHEN page.access_mode = 'full' THEN handoff.id END,
    CASE WHEN page.access_mode = 'full'
      THEN handoff.op_workflow_contract_version_id END,
    CASE WHEN page.access_mode = 'full'
      THEN handoff.approved_commercial_fields END,
    CASE WHEN page.access_mode = 'full' THEN handoff.unresolved_questions END,
    CASE WHEN page.access_mode = 'full' THEN handoff.promises END,
    CASE WHEN page.access_mode = 'full' THEN handoff.next_step END,
    CASE WHEN page.access_mode = 'full' THEN handoff.due_at END,
    CASE WHEN page.access_mode = 'full' THEN handoff.responsible_role END,
    CASE WHEN page.access_mode = 'full' THEN handoff.created_at END,
    CASE WHEN page.access_mode = 'full' THEN page.admissions_direction END
  FROM private.pw310_old_case_page(
    1,
    NULL,
    NULL,
    NULL,
    NULL,
    p_student_case_id
  ) AS page
  LEFT JOIN platform.student_case_op_handoffs AS handoff
    ON page.access_mode = 'full'
   AND handoff.organization_id = page.organization_id
   AND handoff.student_case_id = page.student_case_id
$function$;

-- private.staff_student_case_activity
CREATE FUNCTION private.pw310_old_case_activity(p_student_case_id uuid, p_limit integer DEFAULT 50, p_before_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  actor RECORD;
  result JSONB;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'Authenticated staff required' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100
    OR (p_before_at IS NULL) <> (p_before_id IS NULL)
    OR (p_before_at IS NOT NULL AND NOT isfinite(p_before_at)) THEN
    RAISE EXCEPTION 'Invalid activity page' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO actor
    FROM platform_private.u7_require_case_workspace_actor(p_student_case_id);

  WITH audited AS (
    SELECT event.id, event.created_at, event.action, target.kind, target.id AS target_id,
      CASE WHEN event.action = 'task.change' THEN
        platform_private.u7_changed_field_codes(event.before_state, event.after_state,
          ARRAY['status','priority','due_at','due_on','assignee_membership_id']::TEXT[])
        ELSE '[]'::JSONB END AS changed_fields
    FROM platform.audit_events AS event
    CROSS JOIN LATERAL (
      SELECT 'overview'::TEXT AS kind, p_student_case_id AS id
      WHERE event.resource_type = 'student_case' AND event.resource_id = p_student_case_id
        AND event.action = ANY(ARRAY['case.create','case.curator.set','case.lifecycle.change',
          'case.route.change','lead.admissions.handoff.completed',
          'case.handoff.acknowledge','case.handoff.clarification',
          'case.coverage.start','case.coverage.return','case.next.action.change','case.direction.set']::TEXT[])
      UNION ALL
      SELECT 'task', task.id FROM platform.case_tasks AS task
      WHERE event.resource_type = 'case_task' AND event.resource_id = task.id
        AND task.organization_id = actor.organization_id AND task.student_case_id = p_student_case_id
        AND event.action = ANY(ARRAY['task.create','task.change']::TEXT[])
      UNION ALL
      SELECT 'overview', application.id FROM platform.university_applications AS application
      WHERE event.resource_type = 'university_application' AND event.resource_id = application.id
        AND application.organization_id = actor.organization_id AND application.student_case_id = p_student_case_id
        AND event.action = ANY(ARRAY['application.create','application.details.update','application.status.change']::TEXT[])
      UNION ALL
      SELECT 'overview', visa.id FROM platform.visa_cases AS visa
      WHERE event.resource_type = 'visa_case' AND event.resource_id = visa.id
        AND visa.organization_id = actor.organization_id AND visa.student_case_id = p_student_case_id
        AND event.action = ANY(ARRAY['visa.create','visa.status.change']::TEXT[])
      UNION ALL
      SELECT 'documents', slot.id FROM platform.document_slots AS slot
      WHERE event.resource_type = 'document_slot' AND event.resource_id = slot.id
        AND slot.organization_id = actor.organization_id AND slot.student_case_id = p_student_case_id
        AND event.action = ANY(ARRAY['document.slot.create','document.slot.custom.create','document.slot.metadata.change']::TEXT[])
      UNION ALL
      SELECT 'documents', version.document_slot_id FROM platform.document_versions AS version
      WHERE event.resource_type = 'document_version' AND event.resource_id = version.id
        AND version.organization_id = actor.organization_id AND version.student_case_id = p_student_case_id
        AND event.action = ANY(ARRAY['document.version.record','document.version.review','document.validation.attest']::TEXT[])
      UNION ALL
      SELECT 'money', obligation.id FROM platform.payment_obligations AS obligation
      WHERE event.resource_type = 'payment_obligation' AND event.resource_id = obligation.id
        AND obligation.organization_id = actor.organization_id AND obligation.student_case_id = p_student_case_id
        AND private.platform_has_permission(actor.organization_id, 'finance.read.summary')
        AND event.action = 'finance.obligation.create'
      UNION ALL
      SELECT 'money', payment.id FROM platform.payment_events AS payment
      WHERE event.resource_type = 'payment_event' AND event.resource_id = payment.id
        AND payment.organization_id = actor.organization_id AND payment.student_case_id = p_student_case_id
        AND private.platform_has_permission(actor.organization_id, 'finance.read.summary')
        AND event.action = 'finance.payment.record'
      UNION ALL
      SELECT 'money', stop.id FROM platform.stop_factors AS stop
      WHERE event.resource_type = 'stop_factor' AND event.resource_id = stop.id
        AND stop.organization_id = actor.organization_id AND stop.student_case_id = p_student_case_id
        AND private.platform_has_permission(actor.organization_id, 'finance.read.summary')
        AND event.action = ANY(ARRAY['finance.stop.create','finance.stop.resolve']::TEXT[])
      UNION ALL
      SELECT 'conversation', conversation.id FROM platform.communication_conversations AS conversation
      WHERE event.resource_type = 'communication_conversation' AND event.resource_id = conversation.id
        AND conversation.organization_id = actor.organization_id AND conversation.student_case_id = p_student_case_id
        AND private.platform_can_read_communication_full(actor.organization_id, conversation.id)
        AND event.action = ANY(ARRAY['communication.conversation.create','communication.conversation.link']::TEXT[])
      UNION ALL
      SELECT 'conversation', message.conversation_id FROM platform.communication_messages AS message
      JOIN platform.communication_conversations AS conversation
        ON conversation.organization_id = message.organization_id AND conversation.id = message.conversation_id
      WHERE event.resource_type = 'communication_message' AND event.resource_id = message.id
        AND message.organization_id = actor.organization_id AND conversation.student_case_id = p_student_case_id
        AND private.platform_can_read_communication_full(actor.organization_id, message.conversation_id)
        AND event.action = 'communication.message.record'
    ) AS target
    WHERE event.organization_id = actor.organization_id
      AND (p_before_at IS NULL OR (event.created_at, event.id) < (p_before_at, p_before_id))
    ORDER BY event.created_at DESC, event.id DESC
    LIMIT p_limit + 1
  ), message_records AS (
    -- Provider workers can persist a verified message without the old record RPC.
    -- Use only canonical metadata and omit records already represented by audit.
    SELECT message.id, message.created_at, 'communication.message.record'::TEXT AS action,
      'conversation'::TEXT AS kind, message.conversation_id AS target_id, '[]'::JSONB AS changed_fields
    FROM platform.communication_messages AS message
    JOIN platform.communication_conversations AS conversation
      ON conversation.organization_id = message.organization_id AND conversation.id = message.conversation_id
    WHERE message.organization_id = actor.organization_id AND conversation.student_case_id = p_student_case_id
      AND private.platform_can_read_communication_full(actor.organization_id, message.conversation_id)
      AND (p_before_at IS NULL OR (message.created_at, message.id) < (p_before_at, p_before_id))
      AND NOT EXISTS (SELECT 1 FROM platform.audit_events AS event
        WHERE event.organization_id = actor.organization_id AND event.resource_type = 'communication_message'
          AND event.resource_id = message.id AND event.action = 'communication.message.record')
    ORDER BY message.created_at DESC, message.id DESC LIMIT p_limit + 1
  ), scoped AS (
    SELECT * FROM (SELECT * FROM audited UNION ALL SELECT * FROM message_records) AS combined
    ORDER BY created_at DESC, id DESC LIMIT p_limit + 1
  ), numbered AS (
    SELECT *, row_number() OVER (ORDER BY created_at DESC, id DESC) AS ordinal FROM scoped
  )
  SELECT jsonb_build_object(
    'organization_id', actor.organization_id,
    'student_case_id', p_student_case_id,
    'events', COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 'action', action, 'target_kind', kind, 'target_id', target_id,
      'occurred_at', CASE WHEN kind = 'documents' THEN NULL ELSE created_at END,
      'changed_fields', changed_fields
    ) || CASE WHEN action = 'case.direction.set' THEN jsonb_build_object('direction_change',
        (SELECT platform_private.case_direction_change(direction_event.before_state, direction_event.after_state)
         FROM platform.audit_events AS direction_event
         WHERE direction_event.organization_id = actor.organization_id AND direction_event.id = numbered.id))
      ELSE '{}'::JSONB END
      ORDER BY created_at DESC, id DESC) FILTER (WHERE ordinal <= p_limit), '[]'::JSONB),
    'next_cursor', CASE WHEN count(*) > p_limit THEN
      (SELECT jsonb_build_object('at', created_at, 'id', id) FROM numbered WHERE ordinal = p_limit)
      ELSE NULL END
  ) INTO result FROM numbered;
  RETURN result;
END
$function$;

-- platform.staff_student_case_queue_v1
CREATE FUNCTION private.pw310_old_queue_v1(p_view text, p_limit integer DEFAULT 25, p_sort text DEFAULT 'due'::text, p_cursor text DEFAULT NULL::text, p_direction text DEFAULT NULL::text, p_curator_membership_id uuid DEFAULT NULL::uuid, p_pipeline_stage text DEFAULT NULL::text, p_query text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  a RECORD;
  today DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bishkek')::DATE;
  q TEXT := NULLIF(btrim(p_query), '');
  parts TEXT[];
  cursor_rank INTEGER;
  cursor_due DATE;
  cursor_updated TIMESTAMPTZ;
  cursor_id UUID;
  cursor_invalid BOOLEAN := FALSE;
  result JSONB;
BEGIN
  SELECT * INTO a FROM platform.current_actor_authority();
  IF a.membership_id IS NULL OR a.platform_role IS NOT DISTINCT FROM 'student'
    OR NOT private.platform_has_permission(a.organization_id, 'case.read.full') THEN
    RAISE EXCEPTION 'Staff admissions authority required' USING ERRCODE = '42501';
  END IF;
  IF p_view IS NULL OR p_view NOT IN ('mine', 'needs_action', 'active', 'needs_curator', 'closed', 'pending')
    OR p_sort IS NULL OR p_sort NOT IN ('due', 'updated')
    OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
    OR (p_direction IS NOT NULL AND p_direction NOT IN ('CN', 'MY', 'EUROPE', 'AE', 'TR', 'unknown'))
    OR (p_pipeline_stage IS NOT NULL AND p_pipeline_stage NOT IN ('new', 'shortlist', 'documents',
      'ready_to_submit', 'awaiting_decision', 'confirmed', 'visa', 'predeparture', 'arrived'))
    OR (p_query IS NOT NULL AND char_length(p_query) > 200)
  THEN
    RAISE EXCEPTION 'Invalid student case queue request' USING ERRCODE = '22023';
  END IF;

  IF p_cursor IS NOT NULL THEN
    parts := string_to_array(p_cursor, '|');
    BEGIN
      IF p_sort = 'due' AND p_cursor ~ '^due\|[012]\|([0-9]{4}-[0-9]{2}-[0-9]{2}|infinity)\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        cursor_rank := parts[2]::INTEGER;
        cursor_due := parts[3]::DATE;
        cursor_id := parts[4]::UUID;
        -- Rank 0 carries a real date; ranks 1-2 (no date / no step) carry infinity.
        cursor_invalid := (cursor_rank = 0) = (cursor_due = 'infinity'::DATE);
      ELSIF p_sort = 'updated' AND p_cursor ~ '^updated\|[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        cursor_updated := parts[2]::TIMESTAMPTZ;
        cursor_id := parts[3]::UUID;
      ELSE
        cursor_invalid := TRUE;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      cursor_invalid := TRUE;
    END;
    IF cursor_invalid THEN
      RAISE EXCEPTION 'Invalid student case queue cursor' USING ERRCODE = '22023';
    END IF;
  END IF;

  WITH candidates AS MATERIALIZED (
    SELECT c.organization_id, c.id, c.updated_at,
      platform_private.case_next_action_band(c.next_action, c.next_action_due_on, today) AS band,
      CASE WHEN c.next_action IS NULL THEN 2 WHEN c.next_action_due_on IS NULL THEN 1 ELSE 0 END AS sort_rank,
      CASE WHEN c.next_action IS NOT NULL AND c.next_action_due_on IS NOT NULL
        THEN c.next_action_due_on ELSE 'infinity'::DATE END AS sort_due
    FROM platform.student_cases AS c
    WHERE c.organization_id = a.organization_id
      AND (p_direction IS NULL OR COALESCE(c.admissions_direction, 'unknown') = p_direction)
      AND (p_curator_membership_id IS NULL OR c.current_curator_membership_id = p_curator_membership_id)
      AND (p_pipeline_stage IS NULL OR c.pipeline_stage = p_pipeline_stage)
      AND (q IS NULL OR strpos(lower(concat_ws(' ', c.student_display_name, c.target_country,
        c.target_degree, c.program_direction)), lower(q)) > 0)
      AND private.platform_can_read_student_case(c.organization_id, c.id)
      AND platform_private.case_queue_in_view(p_view, c.state,
        c.current_curator_membership_id = a.membership_id,
        CASE WHEN p_view IN ('needs_action', 'needs_curator') AND c.state IN ('active', 'pending')
          THEN platform_private.case_queue_flags(c.id) END)
  ), page AS MATERIALIZED (
    SELECT candidates.*, row_number() OVER (ORDER BY
      CASE WHEN p_sort = 'due' THEN sort_rank END ASC,
      CASE WHEN p_sort = 'due' THEN sort_due END ASC,
      CASE WHEN p_sort = 'due' THEN id END ASC,
      CASE WHEN p_sort = 'updated' THEN updated_at END DESC,
      CASE WHEN p_sort = 'updated' THEN id END DESC) AS ordinal
    FROM candidates
    WHERE p_cursor IS NULL
      OR (p_sort = 'due' AND (sort_rank, sort_due, id) > (cursor_rank, cursor_due, cursor_id))
      OR (p_sort = 'updated' AND (updated_at, id) < (cursor_updated, cursor_id))
    ORDER BY
      CASE WHEN p_sort = 'due' THEN sort_rank END ASC,
      CASE WHEN p_sort = 'due' THEN sort_due END ASC,
      CASE WHEN p_sort = 'due' THEN id END ASC,
      CASE WHEN p_sort = 'updated' THEN updated_at END DESC,
      CASE WHEN p_sort = 'updated' THEN id END DESC
    LIMIT p_limit + 1
  ), shown AS (
    SELECT page.ordinal, page.band,
      CASE WHEN p_sort = 'due'
        THEN 'due|' || page.sort_rank || '|' || CASE WHEN page.sort_due = 'infinity'::DATE
          THEN 'infinity' ELSE to_char(page.sort_due, 'YYYY-MM-DD') END || '|' || page.id::TEXT
        ELSE 'updated|' || to_char(page.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
          || '|' || page.id::TEXT
      END AS row_cursor,
      c.*,
      curator_profile.display_name AS curator_display_name,
      platform_private.admissions_attention_flags(c.id) AS flags,
      private.platform_can_read_document_full(c.organization_id, c.id) AS can_read_documents
    FROM page
    JOIN platform.student_cases AS c ON c.organization_id = page.organization_id AND c.id = page.id
    LEFT JOIN platform.organization_memberships AS curator_membership
      ON curator_membership.organization_id = c.organization_id
     AND curator_membership.id = c.current_curator_membership_id
    LEFT JOIN platform.profiles AS curator_profile ON curator_profile.id = curator_membership.profile_id
    WHERE page.ordinal <= p_limit
  )
  SELECT jsonb_build_object(
    'view', p_view,
    'sort', p_sort,
    'today', to_char(today, 'YYYY-MM-DD'),
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'student_case_id', shown.id,
      'student_display_name', shown.student_display_name,
      'state', shown.state,
      'admissions_direction', shown.admissions_direction,
      'target_country', shown.target_country,
      'target_degree', shown.target_degree,
      'pipeline_stage', shown.pipeline_stage,
      'pipeline_hidden', shown.pipeline_hidden_at IS NOT NULL,
      'next_action', shown.next_action,
      'next_action_due_on', to_char(shown.next_action_due_on, 'YYYY-MM-DD'),
      'due_band', shown.band,
      'admissions_version', shown.admissions_version::TEXT,
      'current_curator_membership_id', shown.current_curator_membership_id,
      'current_curator_display_name', shown.curator_display_name,
      'is_mine', COALESCE(shown.current_curator_membership_id = a.membership_id, FALSE),
      'attention_flags', to_jsonb(COALESCE(shown.flags, ARRAY[]::TEXT[])),
      'needs_reply', platform_private.case_needs_reply(shown.organization_id, shown.id),
      'overdue_task_count', (
        SELECT count(*) FROM platform.case_tasks AS task
        WHERE task.organization_id = shown.organization_id AND task.student_case_id = shown.id
          AND task.status NOT IN ('done', 'cancelled')
          AND ((task.due_at IS NOT NULL AND task.due_at < CURRENT_TIMESTAMP)
            OR (task.due_on IS NOT NULL AND task.due_on < today))),
      'documents', CASE WHEN shown.can_read_documents THEN (
        SELECT jsonb_build_object(
          'total', count(*),
          'submitted', count(*) FILTER (WHERE slot.status = 'submitted'),
          'correction_required', count(*) FILTER (WHERE slot.status = 'correction_required'),
          'rejected', count(*) FILTER (WHERE slot.status = 'rejected'),
          'approved', count(*) FILTER (WHERE slot.status = 'approved'),
          'missing', count(*) FILTER (WHERE slot.status = 'required'),
          'oldest_submitted_at', (
            SELECT min(waiting_version.created_at)
            FROM platform.document_slots AS waiting_slot
            JOIN platform.document_versions AS waiting_version
              ON waiting_version.organization_id = waiting_slot.organization_id
             AND waiting_version.id = waiting_slot.current_version_id
            WHERE waiting_slot.organization_id = shown.organization_id
              AND waiting_slot.student_case_id = shown.id
              AND waiting_slot.removed_at IS NULL
              AND waiting_slot.status = 'submitted'))
        FROM platform.document_slots AS slot
        WHERE slot.organization_id = shown.organization_id AND slot.student_case_id = shown.id
          AND slot.removed_at IS NULL) END,
      'updated_at', shown.updated_at,
      'cursor', shown.row_cursor
    ) ORDER BY shown.ordinal) FROM shown), '[]'::JSONB),
    'next_cursor', CASE WHEN (SELECT count(*) FROM page) > p_limit
      THEN (SELECT shown.row_cursor FROM shown WHERE shown.ordinal = p_limit) END
  ) INTO result;
  RETURN result;
END
$function$;

DO $pw310_old_grants$
DECLARE f REGPROCEDURE;
BEGIN
  FOR f IN SELECT p.oid::REGPROCEDURE FROM pg_proc p WHERE p.pronamespace = 'private'::REGNAMESPACE AND p.proname LIKE 'pw310\_old\_%'
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, anon', f);
  END LOOP;
END
$pw310_old_grants$;
