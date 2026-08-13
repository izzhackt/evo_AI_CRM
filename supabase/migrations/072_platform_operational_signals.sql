-- ============================================================
-- 072_platform_operational_signals.sql
--
-- P7B1: bounded, service-only operational signals for the private CRM
-- readiness and Prometheus collectors. The RPC returns one safe global
-- aggregate and never exposes tenant, actor, provider or work-item identity.
-- ============================================================

BEGIN;

-- Existing queue indexes do not support the P7B retry-wait updated_at age,
-- leased-state counts or expired-lease seek with the tenant as the leading
-- key. These partial indexes match the fixed predicates used below.
CREATE INDEX durable_work_items_p7b_ready_idx
  ON platform_private.durable_work_items (
    organization_id,
    available_at,
    id
  )
  WHERE state = 'queued';

CREATE INDEX durable_work_items_p7b_retry_wait_idx
  ON platform_private.durable_work_items (
    organization_id,
    updated_at,
    id
  )
  WHERE state = 'retry_wait';

CREATE INDEX durable_work_items_p7b_leased_idx
  ON platform_private.durable_work_items (
    organization_id,
    id
  )
  WHERE state = 'leased';

CREATE INDEX durable_work_items_p7b_expired_lease_idx
  ON platform_private.durable_work_items (
    organization_id,
    leased_until,
    id
  )
  WHERE state = 'leased'
    AND leased_until IS NOT NULL;

-- P5D's claim indexes cover eligibility, not fixed state counts or the oldest
-- unarchived created_at signal. Keep both paths tenant-leading and partial.
CREATE INDEX waha_media_archive_work_p7b_state_idx
  ON platform_private.waha_media_archive_work (
    organization_id,
    state,
    id
  )
  WHERE state <> 'archived';

CREATE INDEX waha_media_archive_work_p7b_oldest_idx
  ON platform_private.waha_media_archive_work (
    organization_id,
    created_at,
    id
  )
  WHERE state <> 'archived';

-- The append-only lifecycle needs a state/time seek before the existing
-- latest-per-intent index proves that a candidate is still current.
CREATE INDEX autonomous_reply_lifecycle_p7b_state_time_idx
  ON platform_private.autonomous_reply_intent_lifecycle (
    organization_id,
    state,
    created_at,
    id,
    intent_id
  );

CREATE OR REPLACE FUNCTION platform_private.p7b_observability_clock()
RETURNS TIMESTAMPTZ
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.statement_timestamp()
$$;

ALTER FUNCTION platform_private.p7b_observability_clock()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION platform_private.p7b_observability_clock()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION platform.platform_operational_signals_v1(
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '3000ms'
SET lock_timeout = '1000ms'
AS $$
DECLARE
  observation_clock TIMESTAMPTZ;
  applicable_organization_ids UUID[] := ARRAY[]::UUID[];
  audit_organization_id UUID;
  raw_count BIGINT;
  raw_age BIGINT;
  source_timestamp TIMESTAMPTZ;
  saturated_signal BOOLEAN := FALSE;

  queue_ready_count INTEGER := 0;
  queue_retry_wait_count INTEGER := 0;
  queue_leased_count INTEGER := 0;
  queue_expired_lease_count INTEGER := 0;
  queue_oldest_ready_age_seconds INTEGER;
  queue_oldest_retry_wait_age_seconds INTEGER;
  dead_letter_count INTEGER := 0;
  unknown_delivery_open_count INTEGER := 0;
  provider_conflict_open_count INTEGER := 0;

  private_media_pending_count INTEGER := 0;
  private_media_processing_count INTEGER := 0;
  private_media_retryable_error_count INTEGER := 0;
  private_media_terminal_error_count INTEGER := 0;
  private_media_expired_lease_count INTEGER := 0;
  private_media_oldest_unarchived_age_seconds INTEGER;

  autonomy_queued_count INTEGER := 0;
  autonomy_dispatching_count INTEGER := 0;
  autonomy_unknown_count INTEGER := 0;
  autonomy_manual_review_count INTEGER := 0;
  autonomy_oldest_queued_age_seconds INTEGER;
  autonomy_oldest_dispatching_age_seconds INTEGER;

  waha_readiness TEXT := 'unconfigured';
  waha_evidence_kind TEXT;
  waha_age_seconds INTEGER;
  waha_evidence_future BOOLEAN := FALSE;
  ai_readiness TEXT := 'unconfigured';
  ai_evidence_kind TEXT;
  ai_age_seconds INTEGER;
  ai_evidence_future BOOLEAN := FALSE;
  dependency_raw_age BIGINT;

  audit_append_status TEXT := 'unavailable';
BEGIN
  IF p_request_id IS NULL
    OR p_request_id = '00000000-0000-0000-0000-000000000000'::UUID
  THEN
    RAISE EXCEPTION 'A non-nil observability request UUID is required'
      USING ERRCODE = '22023';
  END IF;

  observation_clock := platform_private.p7b_observability_clock();

  SELECT COALESCE(
    pg_catalog.array_agg(candidate.organization_id ORDER BY candidate.organization_id),
    ARRAY[]::UUID[]
  )
  INTO applicable_organization_ids
  FROM (
    SELECT organization.id AS organization_id
    FROM platform.organizations AS organization
    WHERE organization.status = 'active'
      AND (
        EXISTS (
          SELECT 1
          FROM platform.organization_memberships AS membership
          JOIN platform.record_scopes AS scope
            ON scope.organization_id = membership.organization_id
            AND scope.scope_kind = 'organization'
            AND scope.scope_key = membership.organization_id
            AND scope.is_active
          CROSS JOIN LATERAL (
            SELECT assignment.granted, assignment.scope_version
            FROM platform.membership_scope_assignments AS assignment
            WHERE assignment.organization_id = membership.organization_id
              AND assignment.membership_id = membership.id
              AND assignment.scope_id = scope.id
            ORDER BY assignment.assignment_version DESC
            LIMIT 1
          ) AS latest_assignment
          WHERE membership.organization_id = organization.id
            AND membership.status = 'active'
            AND membership."current_role" = 'admin'
            AND latest_assignment.scope_version = scope.scope_version
            AND latest_assignment.granted
        )
        OR EXISTS (
          SELECT 1
          FROM platform_private.messaging_integration_health_events AS health
          WHERE health.organization_id = organization.id
            AND health.target IN ('waha', 'ai')
        )
        OR EXISTS (
          SELECT 1
          FROM platform_private.durable_work_items AS item
          WHERE item.organization_id = organization.id
            AND item.state IN ('queued', 'retry_wait', 'leased')
        )
        OR EXISTS (
          SELECT 1
          FROM platform_private.durable_work_dead_letters AS dead_letter
          WHERE dead_letter.organization_id = organization.id
        )
        OR EXISTS (
          SELECT 1
          FROM platform.work_review_cases AS review
          WHERE review.organization_id = organization.id
            AND review.status = 'open'
            AND review.review_kind IN (
              'unknown_delivery',
              'provider_conflict'
            )
        )
        OR EXISTS (
          SELECT 1
          FROM platform_private.waha_media_archive_work AS media
          WHERE media.organization_id = organization.id
            AND media.state <> 'archived'
        )
        OR EXISTS (
          SELECT 1
          FROM platform_private.autonomous_reply_intent_lifecycle AS lifecycle
          WHERE lifecycle.organization_id = organization.id
            AND lifecycle.state IN (
              'queued',
              'dispatching',
              'unknown',
              'manual_review'
            )
            AND NOT EXISTS (
              SELECT 1
              FROM platform_private.autonomous_reply_intent_lifecycle AS later
              WHERE later.organization_id = lifecycle.organization_id
                AND later.intent_id = lifecycle.intent_id
                AND (later.created_at, later.id) >
                  (lifecycle.created_at, lifecycle.id)
            )
        )
      )
  ) AS candidate;

  -- Every count has a fixed inner saturation limit. No query requests an
  -- exact count after the result can no longer change the public signal.
  SELECT pg_catalog.count(*)
  INTO raw_count
  FROM (
    SELECT 1
    FROM platform_private.durable_work_items AS item
    WHERE item.organization_id = ANY(applicable_organization_ids)
      AND item.state = 'queued'
    LIMIT 1000001
  ) AS bounded;
  queue_ready_count := LEAST(raw_count, 1000000)::INTEGER;
  saturated_signal := saturated_signal OR raw_count > 1000000;

  SELECT pg_catalog.count(*)
  INTO raw_count
  FROM (
    SELECT 1
    FROM platform_private.durable_work_items AS item
    WHERE item.organization_id = ANY(applicable_organization_ids)
      AND item.state = 'retry_wait'
    LIMIT 1000001
  ) AS bounded;
  queue_retry_wait_count := LEAST(raw_count, 1000000)::INTEGER;
  saturated_signal := saturated_signal OR raw_count > 1000000;

  SELECT pg_catalog.count(*)
  INTO raw_count
  FROM (
    SELECT 1
    FROM platform_private.durable_work_items AS item
    WHERE item.organization_id = ANY(applicable_organization_ids)
      AND item.state = 'leased'
    LIMIT 1000001
  ) AS bounded;
  queue_leased_count := LEAST(raw_count, 1000000)::INTEGER;
  saturated_signal := saturated_signal OR raw_count > 1000000;

  SELECT pg_catalog.count(*)
  INTO raw_count
  FROM (
    SELECT 1
    FROM platform_private.durable_work_items AS item
    WHERE item.organization_id = ANY(applicable_organization_ids)
      AND item.state = 'leased'
      AND item.leased_until IS NOT NULL
      AND item.leased_until <= observation_clock
    LIMIT 1000001
  ) AS bounded;
  queue_expired_lease_count :=
    LEAST(raw_count, 1000000)::INTEGER;
  saturated_signal := saturated_signal OR raw_count > 1000000;

  SELECT candidate.available_at
  INTO source_timestamp
  FROM pg_catalog.unnest(applicable_organization_ids)
    AS applicable(organization_id)
  CROSS JOIN LATERAL (
    SELECT item.available_at, item.id
    FROM platform_private.durable_work_items AS item
    WHERE item.organization_id = applicable.organization_id
      AND item.state = 'queued'
    ORDER BY item.available_at, item.id
    LIMIT 1
  ) AS candidate
  ORDER BY candidate.available_at, candidate.id
  LIMIT 1;
  IF source_timestamp IS NOT NULL THEN
    raw_age := pg_catalog.floor(
      EXTRACT(EPOCH FROM observation_clock - source_timestamp)
    )::BIGINT;
    saturated_signal := saturated_signal
      OR raw_age < 0
      OR raw_age > 31536000;
    queue_oldest_ready_age_seconds :=
      LEAST(GREATEST(raw_age, 0), 31536000)::INTEGER;
  END IF;

  source_timestamp := NULL;
  SELECT candidate.updated_at
  INTO source_timestamp
  FROM pg_catalog.unnest(applicable_organization_ids)
    AS applicable(organization_id)
  CROSS JOIN LATERAL (
    SELECT item.updated_at, item.id
    FROM platform_private.durable_work_items AS item
    WHERE item.organization_id = applicable.organization_id
      AND item.state = 'retry_wait'
    ORDER BY item.updated_at, item.id
    LIMIT 1
  ) AS candidate
  ORDER BY candidate.updated_at, candidate.id
  LIMIT 1;
  IF source_timestamp IS NOT NULL THEN
    raw_age := pg_catalog.floor(
      EXTRACT(EPOCH FROM observation_clock - source_timestamp)
    )::BIGINT;
    saturated_signal := saturated_signal
      OR raw_age < 0
      OR raw_age > 31536000;
    queue_oldest_retry_wait_age_seconds :=
      LEAST(GREATEST(raw_age, 0), 31536000)::INTEGER;
  END IF;

  SELECT pg_catalog.count(*)
  INTO raw_count
  FROM (
    SELECT 1
    FROM platform_private.durable_work_dead_letters AS dead_letter
    WHERE dead_letter.organization_id = ANY(applicable_organization_ids)
    LIMIT 1000001
  ) AS bounded;
  dead_letter_count := LEAST(raw_count, 1000000)::INTEGER;
  saturated_signal := saturated_signal OR raw_count > 1000000;

  SELECT pg_catalog.count(*)
  INTO raw_count
  FROM (
    SELECT 1
    FROM platform.work_review_cases AS review
    WHERE review.organization_id = ANY(applicable_organization_ids)
      AND review.status = 'open'
      AND review.review_kind = 'unknown_delivery'
    LIMIT 1000001
  ) AS bounded;
  unknown_delivery_open_count :=
    LEAST(raw_count, 1000000)::INTEGER;
  saturated_signal := saturated_signal OR raw_count > 1000000;

  SELECT pg_catalog.count(*)
  INTO raw_count
  FROM (
    SELECT 1
    FROM platform.work_review_cases AS review
    WHERE review.organization_id = ANY(applicable_organization_ids)
      AND review.status = 'open'
      AND review.review_kind = 'provider_conflict'
    LIMIT 1000001
  ) AS bounded;
  provider_conflict_open_count :=
    LEAST(raw_count, 1000000)::INTEGER;
  saturated_signal := saturated_signal OR raw_count > 1000000;

  SELECT pg_catalog.count(*)
  INTO raw_count
  FROM (
    SELECT 1
    FROM platform_private.waha_media_archive_work AS media
    WHERE media.organization_id = ANY(applicable_organization_ids)
      AND media.state = 'pending'
    LIMIT 1000001
  ) AS bounded;
  private_media_pending_count :=
    LEAST(raw_count, 1000000)::INTEGER;
  saturated_signal := saturated_signal OR raw_count > 1000000;

  SELECT pg_catalog.count(*)
  INTO raw_count
  FROM (
    SELECT 1
    FROM platform_private.waha_media_archive_work AS media
    WHERE media.organization_id = ANY(applicable_organization_ids)
      AND media.state = 'processing'
    LIMIT 1000001
  ) AS bounded;
  private_media_processing_count :=
    LEAST(raw_count, 1000000)::INTEGER;
  saturated_signal := saturated_signal OR raw_count > 1000000;

  SELECT pg_catalog.count(*)
  INTO raw_count
  FROM (
    SELECT 1
    FROM platform_private.waha_media_archive_work AS media
    WHERE media.organization_id = ANY(applicable_organization_ids)
      AND media.state = 'retryable_error'
    LIMIT 1000001
  ) AS bounded;
  private_media_retryable_error_count :=
    LEAST(raw_count, 1000000)::INTEGER;
  saturated_signal := saturated_signal OR raw_count > 1000000;

  SELECT pg_catalog.count(*)
  INTO raw_count
  FROM (
    SELECT 1
    FROM platform_private.waha_media_archive_work AS media
    WHERE media.organization_id = ANY(applicable_organization_ids)
      AND media.state = 'terminal_error'
    LIMIT 1000001
  ) AS bounded;
  private_media_terminal_error_count :=
    LEAST(raw_count, 1000000)::INTEGER;
  saturated_signal := saturated_signal OR raw_count > 1000000;

  SELECT pg_catalog.count(*)
  INTO raw_count
  FROM (
    SELECT 1
    FROM platform_private.waha_media_archive_work AS media
    WHERE media.organization_id = ANY(applicable_organization_ids)
      AND media.state = 'processing'
      AND media.lease_expires_at IS NOT NULL
      AND media.lease_expires_at <= observation_clock
    LIMIT 1000001
  ) AS bounded;
  private_media_expired_lease_count :=
    LEAST(raw_count, 1000000)::INTEGER;
  saturated_signal := saturated_signal OR raw_count > 1000000;

  source_timestamp := NULL;
  SELECT candidate.created_at
  INTO source_timestamp
  FROM pg_catalog.unnest(applicable_organization_ids)
    AS applicable(organization_id)
  CROSS JOIN LATERAL (
    SELECT media.created_at, media.id
    FROM platform_private.waha_media_archive_work AS media
    WHERE media.organization_id = applicable.organization_id
      AND media.state <> 'archived'
    ORDER BY media.created_at, media.id
    LIMIT 1
  ) AS candidate
  ORDER BY candidate.created_at, candidate.id
  LIMIT 1;
  IF source_timestamp IS NOT NULL THEN
    raw_age := pg_catalog.floor(
      EXTRACT(EPOCH FROM observation_clock - source_timestamp)
    )::BIGINT;
    saturated_signal := saturated_signal
      OR raw_age < 0
      OR raw_age > 31536000;
    private_media_oldest_unarchived_age_seconds :=
      LEAST(GREATEST(raw_age, 0), 31536000)::INTEGER;
  END IF;

  SELECT pg_catalog.count(*)
  INTO raw_count
  FROM (
    SELECT 1
    FROM platform_private.autonomous_reply_intent_lifecycle AS lifecycle
    WHERE lifecycle.organization_id = ANY(applicable_organization_ids)
      AND lifecycle.state = 'queued'
      AND NOT EXISTS (
        SELECT 1
        FROM platform_private.autonomous_reply_intent_lifecycle AS later
        WHERE later.organization_id = lifecycle.organization_id
          AND later.intent_id = lifecycle.intent_id
          AND (later.created_at, later.id) >
            (lifecycle.created_at, lifecycle.id)
      )
    LIMIT 1000001
  ) AS bounded;
  autonomy_queued_count := LEAST(raw_count, 1000000)::INTEGER;
  saturated_signal := saturated_signal OR raw_count > 1000000;

  SELECT pg_catalog.count(*)
  INTO raw_count
  FROM (
    SELECT 1
    FROM platform_private.autonomous_reply_intent_lifecycle AS lifecycle
    WHERE lifecycle.organization_id = ANY(applicable_organization_ids)
      AND lifecycle.state = 'dispatching'
      AND NOT EXISTS (
        SELECT 1
        FROM platform_private.autonomous_reply_intent_lifecycle AS later
        WHERE later.organization_id = lifecycle.organization_id
          AND later.intent_id = lifecycle.intent_id
          AND (later.created_at, later.id) >
            (lifecycle.created_at, lifecycle.id)
      )
    LIMIT 1000001
  ) AS bounded;
  autonomy_dispatching_count :=
    LEAST(raw_count, 1000000)::INTEGER;
  saturated_signal := saturated_signal OR raw_count > 1000000;

  SELECT pg_catalog.count(*)
  INTO raw_count
  FROM (
    SELECT 1
    FROM platform_private.autonomous_reply_intent_lifecycle AS lifecycle
    WHERE lifecycle.organization_id = ANY(applicable_organization_ids)
      AND lifecycle.state = 'unknown'
      AND NOT EXISTS (
        SELECT 1
        FROM platform_private.autonomous_reply_intent_lifecycle AS later
        WHERE later.organization_id = lifecycle.organization_id
          AND later.intent_id = lifecycle.intent_id
          AND (later.created_at, later.id) >
            (lifecycle.created_at, lifecycle.id)
      )
    LIMIT 1000001
  ) AS bounded;
  autonomy_unknown_count := LEAST(raw_count, 1000000)::INTEGER;
  saturated_signal := saturated_signal OR raw_count > 1000000;

  SELECT pg_catalog.count(*)
  INTO raw_count
  FROM (
    SELECT 1
    FROM platform_private.autonomous_reply_intent_lifecycle AS lifecycle
    WHERE lifecycle.organization_id = ANY(applicable_organization_ids)
      AND lifecycle.state = 'manual_review'
      AND NOT EXISTS (
        SELECT 1
        FROM platform_private.autonomous_reply_intent_lifecycle AS later
        WHERE later.organization_id = lifecycle.organization_id
          AND later.intent_id = lifecycle.intent_id
          AND (later.created_at, later.id) >
            (lifecycle.created_at, lifecycle.id)
      )
    LIMIT 1000001
  ) AS bounded;
  autonomy_manual_review_count :=
    LEAST(raw_count, 1000000)::INTEGER;
  saturated_signal := saturated_signal OR raw_count > 1000000;

  source_timestamp := NULL;
  SELECT candidate.created_at
  INTO source_timestamp
  FROM pg_catalog.unnest(applicable_organization_ids)
    AS applicable(organization_id)
  CROSS JOIN LATERAL (
    SELECT lifecycle.created_at, lifecycle.id
    FROM platform_private.autonomous_reply_intent_lifecycle AS lifecycle
    WHERE lifecycle.organization_id = applicable.organization_id
      AND lifecycle.state = 'queued'
      AND NOT EXISTS (
        SELECT 1
        FROM platform_private.autonomous_reply_intent_lifecycle AS later
        WHERE later.organization_id = lifecycle.organization_id
          AND later.intent_id = lifecycle.intent_id
          AND (later.created_at, later.id) >
            (lifecycle.created_at, lifecycle.id)
      )
    ORDER BY lifecycle.created_at, lifecycle.id
    LIMIT 1
  ) AS candidate
  ORDER BY candidate.created_at, candidate.id
  LIMIT 1;
  IF source_timestamp IS NOT NULL THEN
    raw_age := pg_catalog.floor(
      EXTRACT(EPOCH FROM observation_clock - source_timestamp)
    )::BIGINT;
    saturated_signal := saturated_signal
      OR raw_age < 0
      OR raw_age > 31536000;
    autonomy_oldest_queued_age_seconds :=
      LEAST(GREATEST(raw_age, 0), 31536000)::INTEGER;
  END IF;

  source_timestamp := NULL;
  SELECT candidate.created_at
  INTO source_timestamp
  FROM pg_catalog.unnest(applicable_organization_ids)
    AS applicable(organization_id)
  CROSS JOIN LATERAL (
    SELECT lifecycle.created_at, lifecycle.id
    FROM platform_private.autonomous_reply_intent_lifecycle AS lifecycle
    WHERE lifecycle.organization_id = applicable.organization_id
      AND lifecycle.state = 'dispatching'
      AND NOT EXISTS (
        SELECT 1
        FROM platform_private.autonomous_reply_intent_lifecycle AS later
        WHERE later.organization_id = lifecycle.organization_id
          AND later.intent_id = lifecycle.intent_id
          AND (later.created_at, later.id) >
            (lifecycle.created_at, lifecycle.id)
      )
    ORDER BY lifecycle.created_at, lifecycle.id
    LIMIT 1
  ) AS candidate
  ORDER BY candidate.created_at, candidate.id
  LIMIT 1;
  IF source_timestamp IS NOT NULL THEN
    raw_age := pg_catalog.floor(
      EXTRACT(EPOCH FROM observation_clock - source_timestamp)
    )::BIGINT;
    saturated_signal := saturated_signal
      OR raw_age < 0
      OR raw_age > 31536000;
    autonomy_oldest_dispatching_age_seconds :=
      LEAST(GREATEST(raw_age, 0), 31536000)::INTEGER;
  END IF;

  SELECT
    CASE
      WHEN pg_catalog.count(*) = 0
        OR pg_catalog.count(latest.id) < pg_catalog.count(*)
        THEN 'unconfigured'
      WHEN pg_catalog.min(
        CASE latest.readiness
          WHEN 'unconfigured' THEN 0
          WHEN 'configured_unverified' THEN 1
          WHEN 'blocked' THEN 2
          WHEN 'ready' THEN 3
        END
      ) = 0 THEN 'unconfigured'
      WHEN pg_catalog.min(
        CASE latest.readiness
          WHEN 'unconfigured' THEN 0
          WHEN 'configured_unverified' THEN 1
          WHEN 'blocked' THEN 2
          WHEN 'ready' THEN 3
        END
      ) = 1 THEN 'configured_unverified'
      WHEN pg_catalog.min(
        CASE latest.readiness
          WHEN 'unconfigured' THEN 0
          WHEN 'configured_unverified' THEN 1
          WHEN 'blocked' THEN 2
          WHEN 'ready' THEN 3
        END
      ) = 2 THEN 'blocked'
      ELSE 'ready'
    END,
    CASE
      WHEN pg_catalog.count(*) = 0
        OR pg_catalog.count(latest.id) < pg_catalog.count(*)
        THEN NULL
      WHEN pg_catalog.min(
        CASE latest.evidence_kind
          WHEN 'configuration_check' THEN 0
          WHEN 'local_non_provider' THEN 1
          WHEN 'provider_observed' THEN 2
        END
      ) = 0 THEN 'configuration_check'
      WHEN pg_catalog.min(
        CASE latest.evidence_kind
          WHEN 'configuration_check' THEN 0
          WHEN 'local_non_provider' THEN 1
          WHEN 'provider_observed' THEN 2
        END
      ) = 1 THEN 'local_non_provider'
      ELSE 'provider_observed'
    END,
    pg_catalog.max(
      pg_catalog.floor(
        EXTRACT(EPOCH FROM observation_clock - latest.observed_at)
      )::BIGINT
    ),
    COALESCE(
      pg_catalog.bool_or(latest.observed_at > observation_clock),
      FALSE
    )
  INTO
    waha_readiness,
    waha_evidence_kind,
    dependency_raw_age,
    waha_evidence_future
  FROM pg_catalog.unnest(applicable_organization_ids)
    AS applicable(organization_id)
  LEFT JOIN LATERAL (
    SELECT
      health.id,
      health.readiness,
      health.evidence_kind,
      health.observed_at
    FROM platform_private.messaging_integration_health_events AS health
    WHERE health.organization_id = applicable.organization_id
      AND health.target = 'waha'
    ORDER BY health.observed_at DESC, health.id DESC
    LIMIT 1
  ) AS latest ON TRUE;

  IF dependency_raw_age IS NOT NULL THEN
    saturated_signal := saturated_signal
      OR dependency_raw_age > 31536000
      OR waha_evidence_future;
    waha_age_seconds := LEAST(
      GREATEST(dependency_raw_age, 0),
      31536000
    )::INTEGER;
  END IF;

  dependency_raw_age := NULL;
  SELECT
    CASE
      WHEN pg_catalog.count(*) = 0
        OR pg_catalog.count(latest.id) < pg_catalog.count(*)
        THEN 'unconfigured'
      WHEN pg_catalog.min(
        CASE latest.readiness
          WHEN 'unconfigured' THEN 0
          WHEN 'configured_unverified' THEN 1
          WHEN 'blocked' THEN 2
          WHEN 'ready' THEN 3
        END
      ) = 0 THEN 'unconfigured'
      WHEN pg_catalog.min(
        CASE latest.readiness
          WHEN 'unconfigured' THEN 0
          WHEN 'configured_unverified' THEN 1
          WHEN 'blocked' THEN 2
          WHEN 'ready' THEN 3
        END
      ) = 1 THEN 'configured_unverified'
      WHEN pg_catalog.min(
        CASE latest.readiness
          WHEN 'unconfigured' THEN 0
          WHEN 'configured_unverified' THEN 1
          WHEN 'blocked' THEN 2
          WHEN 'ready' THEN 3
        END
      ) = 2 THEN 'blocked'
      ELSE 'ready'
    END,
    CASE
      WHEN pg_catalog.count(*) = 0
        OR pg_catalog.count(latest.id) < pg_catalog.count(*)
        THEN NULL
      WHEN pg_catalog.min(
        CASE latest.evidence_kind
          WHEN 'configuration_check' THEN 0
          WHEN 'local_non_provider' THEN 1
          WHEN 'provider_observed' THEN 2
        END
      ) = 0 THEN 'configuration_check'
      WHEN pg_catalog.min(
        CASE latest.evidence_kind
          WHEN 'configuration_check' THEN 0
          WHEN 'local_non_provider' THEN 1
          WHEN 'provider_observed' THEN 2
        END
      ) = 1 THEN 'local_non_provider'
      ELSE 'provider_observed'
    END,
    pg_catalog.max(
      pg_catalog.floor(
        EXTRACT(EPOCH FROM observation_clock - latest.observed_at)
      )::BIGINT
    ),
    COALESCE(
      pg_catalog.bool_or(latest.observed_at > observation_clock),
      FALSE
    )
  INTO
    ai_readiness,
    ai_evidence_kind,
    dependency_raw_age,
    ai_evidence_future
  FROM pg_catalog.unnest(applicable_organization_ids)
    AS applicable(organization_id)
  LEFT JOIN LATERAL (
    SELECT
      health.id,
      health.readiness,
      health.evidence_kind,
      health.observed_at
    FROM platform_private.messaging_integration_health_events AS health
    WHERE health.organization_id = applicable.organization_id
      AND health.target = 'ai'
    ORDER BY health.observed_at DESC, health.id DESC
    LIMIT 1
  ) AS latest ON TRUE;

  IF dependency_raw_age IS NOT NULL THEN
    saturated_signal := saturated_signal
      OR dependency_raw_age > 31536000
      OR ai_evidence_future;
    ai_age_seconds := LEAST(
      GREATEST(dependency_raw_age, 0),
      31536000
    )::INTEGER;
  END IF;

  SELECT applicable.organization_id
  INTO audit_organization_id
  FROM pg_catalog.unnest(applicable_organization_ids)
    AS applicable(organization_id)
  ORDER BY applicable.organization_id
  LIMIT 1;

  IF audit_organization_id IS NOT NULL THEN
    BEGIN
      INSERT INTO platform.audit_events (
        organization_id,
        actor_kind,
        actor_profile_id,
        actor_principal,
        action,
        resource_type,
        resource_id,
        before_state,
        after_state,
        reason,
        request_id
      )
      VALUES (
        audit_organization_id,
        'system',
        NULL,
        'evo-platform:p7b-observability',
        'platform.observability.probe',
        'organization',
        audit_organization_id,
        NULL,
        '{"status":"probe"}'::JSONB,
        'P7B transactional audit append probe',
        p_request_id
      );

      RAISE EXCEPTION 'P7B audit append rollback sentinel'
        USING ERRCODE = 'P7B01';
    EXCEPTION
      WHEN SQLSTATE 'P7B01' THEN
        audit_append_status := 'ready';
      WHEN OTHERS THEN
        audit_append_status := 'failed';
    END;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'schema_version', 'p7b-v1',
    'observed_at', pg_catalog.to_char(
      observation_clock AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ),
    'saturated', saturated_signal,
    'queue_ready_count', queue_ready_count,
    'queue_retry_wait_count', queue_retry_wait_count,
    'queue_leased_count', queue_leased_count,
    'queue_expired_lease_count', queue_expired_lease_count,
    'queue_oldest_ready_age_seconds', queue_oldest_ready_age_seconds,
    'queue_oldest_retry_wait_age_seconds',
      queue_oldest_retry_wait_age_seconds,
    'dead_letter_count', dead_letter_count,
    'unknown_delivery_open_count', unknown_delivery_open_count,
    'provider_conflict_open_count', provider_conflict_open_count,
    'private_media_pending_count', private_media_pending_count,
    'private_media_processing_count', private_media_processing_count,
    'private_media_retryable_error_count',
      private_media_retryable_error_count,
    'private_media_terminal_error_count', private_media_terminal_error_count,
    'private_media_expired_lease_count', private_media_expired_lease_count,
    'private_media_oldest_unarchived_age_seconds',
      private_media_oldest_unarchived_age_seconds,
    'autonomy_queued_count', autonomy_queued_count,
    'autonomy_dispatching_count', autonomy_dispatching_count,
    'autonomy_unknown_count', autonomy_unknown_count,
    'autonomy_manual_review_count', autonomy_manual_review_count,
    'autonomy_oldest_queued_age_seconds',
      autonomy_oldest_queued_age_seconds,
    'autonomy_oldest_dispatching_age_seconds',
      autonomy_oldest_dispatching_age_seconds,
    'waha_readiness', waha_readiness,
    'waha_evidence_kind', waha_evidence_kind,
    'waha_age_seconds', waha_age_seconds,
    'waha_evidence_future', waha_evidence_future,
    'ai_readiness', ai_readiness,
    'ai_evidence_kind', ai_evidence_kind,
    'ai_age_seconds', ai_age_seconds,
    'ai_evidence_future', ai_evidence_future,
    'audit_append_status', audit_append_status
  );
END
$$;

ALTER FUNCTION platform.platform_operational_signals_v1(UUID)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION platform.platform_operational_signals_v1(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.platform_operational_signals_v1(UUID)
  TO service_role;

COMMENT ON FUNCTION platform.platform_operational_signals_v1(UUID) IS
  'P7B1 service-only bounded global operational signals without tenant or provider identity.';

COMMIT;
