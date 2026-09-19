-- OTH-1 «Воронка поступления»: a curator-owned kanban board for
-- platform.student_cases, DECOUPLED from the fact-gated admissions playbook
-- (137's operational_stage/admissions_version/admissions_facts/
-- transition_case_admissions_v1). Architecture decided and journal-recorded
-- in a separate, already-merged PR; this migration implements it.
--
-- This migration NEVER calls platform.transition_case_admissions_v1 and NEVER
-- writes operational_stage, admissions_version or admissions_facts. The new
-- columns (pipeline_stage, pipeline_hidden_at) are a second, independent
-- position on the same row -- see the trigger-safety note on section (a)
-- below for why that is safe against 137's admissions_case_command_guard.
--
-- Sections:
--  a) platform.student_cases: ADD COLUMN pipeline_stage (9-key CHECK, default
--     'new') + pipeline_hidden_at; an index for the board read; an honest,
--     minimal-surface backfill UPDATE per mapped source stage.
--  b) platform_private.case_pipeline_requests: request-id replay receipts,
--     same append-only-receipt shape as platform_private.lead_sale_conditions_requests
--     (181).
--  c) platform.move_case_pipeline_v1: SECURITY DEFINER write RPC. Actor is
--     resolved via platform.current_actor_authority() (role admin/curator),
--     same lightweight style 181's save_lead_sale_conditions_v1 and 183's
--     admissions_direction_summary_v1 use (no p_organization_id-less RPC,
--     since this is a write and the caller already carries the org id, same
--     as save_lead_sale_conditions_v1). Resource-level authorization is
--     platform_private.staff_can_access(...,'case.update.append',
--     'student_case',...) -- the exact permission key
--     platform_private.require_case_operator (146/156/173) uses for this
--     family of case-update RPCs -- but this function does NOT call
--     require_case_operator/require_domain_actor directly: 181's shape
--     resolves the actor once, then checks the request-id replay table
--     BEFORE the resource-scoped staff_can_access call, so a replay of an
--     already-successful request returns its receipt even if the actor's
--     resource-level access changed since (deliberate idempotency semantics,
--     copied from 181's own ordering, not an oversight).
--     Idempotency: same advisory-lock/fingerprint/receipt-table shape as
--     181's lead_sale_conditions, locked by (organization_id,student_case_id)
--     -- the resource, not the request id, exactly like 181 locks by
--     (organization_id,lead_id) rather than by request id (146's per-request
--     lock is a different domain's shape, not used here).
--     No optimistic version on this single field -- see the one-line SQL
--     comment at the UPDATE below.
--  d) platform.staff_admissions_pipeline_board_v1: STABLE read RPC, JSONB
--     result {rows,truncated}, shape convention of 183/144 (jsonb_build_object
--     wrapping a jsonb_agg). Org-less signature like 183's
--     admissions_direction_summary_v1 (actor's own organization only, via
--     current_actor_authority()). Row scope reuses
--     private.platform_can_read_student_case (156), which IS
--     platform_private.staff_can_access_for_actor(org,'case.read.full',
--     'student_case',id) by definition -- the exact call the task asks for,
--     through its existing wrapper rather than a second hand-written copy.
--     awaiting_ack/overdue reuse platform_private.admissions_attention_flags
--     (137/182) verbatim -- the SAME predicate staff_student_case_page/182
--     already compute for the 'awaiting_ack'/'overdue' attention chips, not a
--     second hand-rolled copy that could drift from it.
--     This is a NEW RPC; platform.staff_student_case_page (078/137/182) is
--     untouched -- zero degradation of the existing directory read.
BEGIN;

-- ---------------------------------------------------------------------------
-- a) platform.student_cases: pipeline_stage + pipeline_hidden_at
-- ---------------------------------------------------------------------------
ALTER TABLE platform.student_cases
  ADD COLUMN pipeline_stage TEXT NOT NULL DEFAULT 'new' CHECK (pipeline_stage IN (
    'new','shortlist','documents','ready_to_submit','awaiting_decision',
    'confirmed','visa','predeparture','arrived'
  )),
  ADD COLUMN pipeline_hidden_at TIMESTAMPTZ NULL;

-- Trigger-safety proof (read before trusting this migration's UPDATEs):
-- platform_private.admissions_guard_case (137:212-227) only demands an
-- admissions_version bump, on a playbook-configured case
-- (OLD.admissions_playbook_version_id IS NOT NULL), when
-- ROW(operational_stage,state,admissions_facts,admissions_outcome,
-- next_action,next_action_due_on,route_approval_status,target_country,
-- target_degree,program_direction,intake,language_assumption,
-- funding_assumption) changes. pipeline_stage and pipeline_hidden_at are NOT
-- members of that tuple, so an UPDATE that touches only those two columns
-- (plus updated_at, also outside the tuple) can never trip the "use
-- versioned admissions command" exception -- for CN/MY playbook cases or any
-- other case -- and therefore never needs an admissions_version bump. The
-- backfill below, and platform.move_case_pipeline_v1's own UPDATE (section
-- c), both rely on exactly this.
COMMENT ON COLUMN platform.student_cases.pipeline_stage IS
  'Kanban column of the curator board «Воронка поступления» — curator-owned, decoupled from operational_stage/admissions_version/admissions_facts (137). Not part of the admissions_case_command_guard-guarded tuple; see 187''s header comment.';
COMMENT ON COLUMN platform.student_cases.pipeline_hidden_at IS
  '«Убрать из воронки»: manual, reversible hide from the board. The case, its documents and history stay in «Студенты» — this is not platform.change_student_case_state (archiving stays a separate action).';

CREATE INDEX student_cases_pipeline_board_idx
  ON platform.student_cases (organization_id, updated_at DESC, id DESC)
  WHERE state = 'active' AND pipeline_hidden_at IS NULL;

-- Backfill: only rows whose mapped stage differs from the 'new' default, to
-- keep the UPDATE surface (and any trigger evaluation, even though
-- pipeline_stage itself is unguarded per the note above) minimal. Priority
-- order matches the plan: arrival first (an OR across two source columns),
-- then each single-valued operational_stage mapping -- operational_stage is
-- one TEXT value per row, so these conditions are mutually exclusive by
-- construction and the statement order below does not change the outcome.
UPDATE platform.student_cases
  SET pipeline_stage = 'arrived'
  WHERE pipeline_stage <> 'arrived'
    AND (operational_stage = 'arrival_and_adaptation' OR admissions_outcome = 'arrived');

UPDATE platform.student_cases
  SET pipeline_stage = 'visa'
  WHERE pipeline_stage <> 'visa'
    AND operational_stage = 'visa_and_predeparture';

UPDATE platform.student_cases
  SET pipeline_stage = 'awaiting_decision'
  WHERE pipeline_stage <> 'awaiting_decision'
    AND operational_stage IN ('decisions', 'applications');

UPDATE platform.student_cases
  SET pipeline_stage = 'documents'
  WHERE pipeline_stage <> 'documents'
    AND operational_stage = 'documents';

UPDATE platform.student_cases
  SET pipeline_stage = 'shortlist'
  WHERE pipeline_stage <> 'shortlist'
    AND operational_stage IN ('intake', 'profile_and_route');

-- ---------------------------------------------------------------------------
-- b) platform_private.case_pipeline_requests: request-id replay receipts
--    (same append-only-receipt shape as 181's lead_sale_conditions_requests)
-- ---------------------------------------------------------------------------
CREATE TABLE platform_private.case_pipeline_requests (
  organization_id UUID NOT NULL REFERENCES platform.organizations(id), request_id UUID NOT NULL,
  actor_membership_id UUID NOT NULL, fingerprint TEXT NOT NULL, receipt JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (organization_id, request_id)
);
ALTER TABLE platform_private.case_pipeline_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.case_pipeline_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform_private.case_pipeline_requests FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
CREATE TRIGGER case_pipeline_requests_append_only BEFORE UPDATE OR DELETE
  ON platform_private.case_pipeline_requests FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();

-- ---------------------------------------------------------------------------
-- c) platform.move_case_pipeline_v1: drag-and-drop / «Переместить в…» / «Убрать из воронки»
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.move_case_pipeline_v1(
  p_organization_id UUID, p_student_case_id UUID, p_stage TEXT, p_remove BOOLEAN, p_request_id UUID
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD; fingerprint TEXT; prior platform_private.case_pipeline_requests%ROWTYPE;
  case_row platform.student_cases%ROWTYPE; before_state JSONB; after_state JSONB; receipt JSONB;
BEGIN
  SELECT a.* INTO actor FROM platform.current_actor_authority() a
    WHERE a.organization_id = p_organization_id AND a.platform_role IN ('admin', 'curator');
  IF NOT FOUND THEN RAISE EXCEPTION 'case_pipeline_forbidden' USING ERRCODE = '42501'; END IF;
  IF p_request_id IS NULL OR p_student_case_id IS NULL OR p_remove IS NULL
    OR (p_stage IS NOT NULL) = p_remove
    OR (p_stage IS NOT NULL AND p_stage <> ALL (ARRAY[
      'new','shortlist','documents','ready_to_submit','awaiting_decision',
      'confirmed','visa','predeparture','arrived'
    ])) THEN
    RAISE EXCEPTION 'case_pipeline_invalid_command' USING ERRCODE = '22023';
  END IF;
  -- Resource lock, same shape as 181's lead_sale_conditions (locked by the
  -- resource itself, org+case — not by request id, which is 146's shape for
  -- a different domain): serializes two concurrent moves of the SAME card.
  -- Deliberately no optimistic version check on the row otherwise — last-
  -- write-wins is the owner's decision for a single kanban position field
  -- (unlike admissions_version-gated facts, there is no correctness reason to
  -- reject a concurrent write here; the lock only prevents the two UPDATEs
  -- from interleaving, it does not make either one fail).
  PERFORM pg_advisory_xact_lock(hashtextextended('case-pipeline:' || p_organization_id::TEXT || ':' || p_student_case_id::TEXT, 0));
  fingerprint := md5(jsonb_build_object(
    'actor', actor.membership_id, 'case', p_student_case_id, 'stage', p_stage, 'remove', p_remove
  )::TEXT);
  SELECT * INTO prior FROM platform_private.case_pipeline_requests r
    WHERE r.organization_id = p_organization_id AND r.request_id = p_request_id;
  IF FOUND THEN
    IF prior.actor_membership_id <> actor.membership_id OR prior.fingerprint <> fingerprint THEN
      RAISE EXCEPTION 'case_pipeline_request_id_conflict' USING ERRCODE = '22023';
    END IF;
    RETURN prior.receipt;
  END IF;
  IF NOT platform_private.staff_can_access(p_organization_id, actor.membership_id, 'case.update.append', 'student_case', p_student_case_id) THEN
    RAISE EXCEPTION 'case_pipeline_forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO case_row FROM platform.student_cases c
    WHERE c.organization_id = p_organization_id AND c.id = p_student_case_id FOR UPDATE;
  IF NOT FOUND OR case_row.state <> 'active' THEN
    RAISE EXCEPTION 'Case is not active in this pipeline' USING ERRCODE = '22023';
  END IF;
  before_state := jsonb_build_object('pipeline_stage', case_row.pipeline_stage, 'pipeline_hidden', case_row.pipeline_hidden_at IS NOT NULL);
  -- pipeline_stage/pipeline_hidden_at sit outside the ROW(...) tuple
  -- platform_private.admissions_guard_case (137:212-227) compares — see this
  -- migration's header/section (a) note — so this UPDATE never requires an
  -- admissions_version bump, even for a playbook-configured (CN/MY) case.
  IF p_remove THEN
    UPDATE platform.student_cases SET pipeline_hidden_at = clock_timestamp(), updated_at = clock_timestamp()
      WHERE organization_id = p_organization_id AND id = p_student_case_id RETURNING * INTO case_row;
  ELSE
    UPDATE platform.student_cases SET pipeline_stage = p_stage, pipeline_hidden_at = NULL, updated_at = clock_timestamp()
      WHERE organization_id = p_organization_id AND id = p_student_case_id RETURNING * INTO case_row;
  END IF;
  after_state := jsonb_build_object('pipeline_stage', case_row.pipeline_stage, 'pipeline_hidden', case_row.pipeline_hidden_at IS NOT NULL);
  receipt := jsonb_build_object(
    'student_case_id', case_row.id, 'pipeline_stage', case_row.pipeline_stage,
    'pipeline_hidden', case_row.pipeline_hidden_at IS NOT NULL, 'request_id', p_request_id
  );
  INSERT INTO platform_private.case_pipeline_requests(organization_id, request_id, actor_membership_id, fingerprint, receipt)
    VALUES (p_organization_id, p_request_id, actor.membership_id, fingerprint, receipt);
  INSERT INTO platform.audit_events(organization_id, actor_kind, actor_profile_id, actor_principal, action, resource_type, resource_id, before_state, after_state, reason, request_id)
    VALUES (
      p_organization_id, 'user', actor.profile_id, 'auth:' || actor.auth_user_id::TEXT, 'case.pipeline.move', 'student_case', case_row.id,
      before_state, after_state,
      CASE WHEN p_remove THEN 'Case removed from the admissions pipeline board' ELSE 'Case moved on the admissions pipeline board' END,
      p_request_id
    );
  RETURN receipt;
END $$;

REVOKE ALL ON FUNCTION platform.move_case_pipeline_v1(UUID, UUID, TEXT, BOOLEAN, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.move_case_pipeline_v1(UUID, UUID, TEXT, BOOLEAN, UUID)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- d) platform.staff_admissions_pipeline_board_v1: board read
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.staff_admissions_pipeline_board_v1(
  p_curator_membership_id UUID DEFAULT NULL, p_direction TEXT DEFAULT NULL,
  p_country TEXT DEFAULT NULL, p_query TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a RECORD; result JSONB;
BEGIN
  SELECT * INTO a FROM platform.current_actor_authority();
  IF a.membership_id IS NULL OR a.platform_role NOT IN ('admin', 'curator')
    OR NOT private.platform_has_permission(a.organization_id, 'case.read.full') THEN
    RAISE EXCEPTION 'Staff admissions authority required' USING ERRCODE = '42501';
  END IF;
  IF p_direction IS NOT NULL AND p_direction NOT IN ('CN', 'MY', 'EUROPE', 'AE', 'TR', 'unknown') THEN
    RAISE EXCEPTION 'Invalid pipeline board direction filter' USING ERRCODE = '22023';
  END IF;
  IF p_country IS NOT NULL AND length(btrim(p_country)) NOT BETWEEN 1 AND 8 THEN
    RAISE EXCEPTION 'Invalid pipeline board country filter' USING ERRCODE = '22023';
  END IF;
  IF p_query IS NOT NULL AND length(p_query) > 200 THEN
    RAISE EXCEPTION 'Invalid pipeline board search text' USING ERRCODE = '22023';
  END IF;

  WITH visible AS MATERIALIZED (
    SELECT
      c.id AS student_case_id, c.student_display_name, c.target_country,
      c.current_curator_membership_id, curator_profile.display_name AS current_curator_display_name,
      c.pipeline_stage, c.updated_at,
      platform_private.admissions_attention_flags(c.id) AS flags,
      (
        SELECT app.institution_name FROM platform.university_applications app
        WHERE app.organization_id = c.organization_id AND app.student_case_id = c.id
        ORDER BY app.is_primary DESC, app.created_at DESC LIMIT 1
      ) AS primary_institution_name
    FROM platform.student_cases c
    LEFT JOIN platform.organization_memberships curator_membership
      ON curator_membership.organization_id = c.organization_id AND curator_membership.id = c.current_curator_membership_id
    LEFT JOIN platform.profiles curator_profile ON curator_profile.id = curator_membership.profile_id
    WHERE c.organization_id = a.organization_id
      AND c.state = 'active'
      AND c.pipeline_hidden_at IS NULL
      -- This is exactly platform_private.staff_can_access_for_actor(org,
      -- 'case.read.full','student_case',id) — see 156's own definition —
      -- reused through its existing wrapper, not re-implemented here.
      AND private.platform_can_read_student_case(c.organization_id, c.id)
      AND (p_curator_membership_id IS NULL OR c.current_curator_membership_id = p_curator_membership_id)
      AND (p_direction IS NULL OR COALESCE(c.admissions_direction, 'unknown') = p_direction)
      AND (p_country IS NULL OR c.target_country = p_country)
      AND (p_query IS NULL OR btrim(p_query) = '' OR strpos(lower(c.student_display_name), lower(btrim(p_query))) > 0)
    ORDER BY c.updated_at DESC, c.id DESC
    LIMIT 401
  ), page AS (
    SELECT * FROM visible ORDER BY updated_at DESC, student_case_id DESC LIMIT 400
  )
  SELECT jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'student_case_id', page.student_case_id,
      'student_display_name', page.student_display_name,
      'target_country', page.target_country,
      'primary_institution_name', page.primary_institution_name,
      'current_curator_membership_id', page.current_curator_membership_id,
      'current_curator_display_name', page.current_curator_display_name,
      'pipeline_stage', page.pipeline_stage,
      'awaiting_ack', 'awaiting_ack' = ANY (page.flags),
      'overdue', 'overdue' = ANY (page.flags)
    ) ORDER BY page.updated_at DESC, page.student_case_id DESC) FROM page), '[]'::JSONB),
    'truncated', (SELECT count(*) FROM visible) > 400
  ) INTO result;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION platform.staff_admissions_pipeline_board_v1(UUID, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_admissions_pipeline_board_v1(UUID, TEXT, TEXT, TEXT)
  TO authenticated;

-- Admin audit journal allowlist: expose the new action, same rename-and-
-- replace pattern 179/181 use.
ALTER FUNCTION platform_private.p7a_safe_audit_actions()
  RENAME TO p7a_safe_audit_actions_pre_admissions_pipeline_board;
CREATE FUNCTION platform_private.p7a_safe_audit_actions()
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.array_agg(DISTINCT allowed.action ORDER BY allowed.action)
  FROM pg_catalog.unnest(
    platform_private.p7a_safe_audit_actions_pre_admissions_pipeline_board()
      || ARRAY['case.pipeline.move']::TEXT[]
  ) AS allowed(action)
$$;
REVOKE ALL ON FUNCTION
  platform_private.p7a_safe_audit_actions_pre_admissions_pipeline_board(),
  platform_private.p7a_safe_audit_actions()
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

COMMIT;
