-- Э7 «Отменить» на доске поступления с проверкой версии (план редизайна
-- 25.09, docs/EVO_CRM_REDESIGN_PLAN_2026-09-25.md, этап Э7;
-- docs/PLAN_CHANGES.md «2026-09-27 — Э7: «Отменить» на доске поступления с
-- проверкой версии (миграция 251)»).
--
-- Why: platform.move_case_pipeline_v1 (187, gate rewritten by 244) has no
-- expected-version guard — last write wins, the owner's decision for an
-- ordinary kanban move (187). An undo sent through it could overwrite a later
-- move of the same case by someone else. Neither updated_at (any case edit —
-- next step, curator, deadline — bumps it: false refusals) nor the stage alone
-- (blind to a move away and back) is a sound expected position, so the row
-- gets a position counter.
--
-- Forward-only and additive; v1 is NOT touched (the running release keeps
-- calling it until the new one is accepted):
--  a) platform.student_cases.pipeline_version BIGINT NOT NULL DEFAULT 1,
--     CHECK >= 1. The constant default IS the backfill: every existing row
--     reads version 1 (a catalog-only default since PostgreSQL 11 — no table
--     rewrite, no case data changed).
--  b) platform_private.bump_case_pipeline_version() and the BEFORE UPDATE
--     trigger student_cases_pipeline_version, fired only WHEN the board
--     position (pipeline_stage, or hidden / not hidden) or the version itself
--     changed: +1 on a position change, a direct write of the version is put
--     back. The server owns the counter, so v1 of the running release bumps it
--     as well. pipeline_version sits outside the ROW(...) tuple of 137's
--     platform_private.admissions_guard_case, like pipeline_stage (187 section
--     a): it never needs an admissions_version bump.
--  c) platform.move_case_pipeline_v2(..., p_expected_version BIGINT DEFAULT
--     NULL): a NEW function beside v1. Gate = v1 after 244 (staff, never a
--     student, whose role holds case.update.append; then per case
--     staff_can_access(..., 'case.update.append', 'student_case', ...)). The
--     same advisory lock key and the same receipts table as v1, with the
--     request-id replay BEFORE the resource check exactly as 187. Without an
--     expected version the fingerprint equals v1's and the move is v1's (last
--     write wins). With one, a different current version refuses with
--     case_pipeline_moved (PT409) and the current position as JSON in DETAIL
--     (pipeline_stage, pipeline_hidden, pipeline_version) — only after the
--     per-case check, so a refused caller learns nothing; nothing is written.
--     The receipt adds pipeline_version; the audit row keeps v1's shape.
--  d) Grants as v1: EXECUTE authenticated only; self-check.
BEGIN;

-- The compatibility claims of (c) rest on v1's latest body (244): the same
-- lock key, fingerprint members, receipts table and gate. Fail closed on drift.
DO $a251_source$
DECLARE v1 TEXT := pg_get_functiondef('platform.move_case_pipeline_v1(uuid,uuid,text,boolean,uuid)'::regprocedure);
BEGIN
  IF strpos(v1, $q$hashtextextended('case-pipeline:' || p_organization_id::TEXT || ':' || p_student_case_id::TEXT, 0)$q$) = 0
    OR strpos(v1, $q$'actor', actor.membership_id, 'case', p_student_case_id, 'stage', p_stage, 'remove', p_remove$q$) = 0
    OR strpos(v1, 'platform_private.case_pipeline_requests') = 0
    OR strpos(v1, $q$staff_has_permission(a.organization_id, a.membership_id, 'case.update.append')$q$) = 0
    OR strpos(v1, 'pipeline_version') <> 0
  THEN
    RAISE EXCEPTION 'a251_pipeline_move_source_drift';
  END IF;
END
$a251_source$;

-- ---------------------------------------------------------------------------
-- a) platform.student_cases.pipeline_version
-- ---------------------------------------------------------------------------
ALTER TABLE platform.student_cases
  ADD COLUMN pipeline_version BIGINT NOT NULL DEFAULT 1
    CONSTRAINT student_cases_pipeline_version_check CHECK (pipeline_version >= 1);
COMMENT ON COLUMN platform.student_cases.pipeline_version IS
  'Version of the board position (pipeline_stage, pipeline_hidden_at) of «Воронка поступления»: +1 on every position change, kept by the trigger student_cases_pipeline_version (251). platform.move_case_pipeline_v2 refuses a stale expected version (undo). Not part of the admissions_case_command_guard tuple (137).';

-- ---------------------------------------------------------------------------
-- b) The server owns the counter
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.bump_case_pipeline_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.pipeline_stage IS DISTINCT FROM OLD.pipeline_stage
    OR (NEW.pipeline_hidden_at IS NULL) IS DISTINCT FROM (OLD.pipeline_hidden_at IS NULL)
  THEN
    NEW.pipeline_version := OLD.pipeline_version + 1;
  ELSE
    -- Only the version itself was written: put it back.
    NEW.pipeline_version := OLD.pipeline_version;
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION platform_private.bump_case_pipeline_version()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE TRIGGER student_cases_pipeline_version
  BEFORE UPDATE ON platform.student_cases
  FOR EACH ROW
  WHEN (
    OLD.pipeline_stage IS DISTINCT FROM NEW.pipeline_stage
    OR (OLD.pipeline_hidden_at IS NULL) IS DISTINCT FROM (NEW.pipeline_hidden_at IS NULL)
    OR OLD.pipeline_version IS DISTINCT FROM NEW.pipeline_version
  )
  EXECUTE FUNCTION platform_private.bump_case_pipeline_version();

-- ---------------------------------------------------------------------------
-- c) platform.move_case_pipeline_v2: v1 plus an optional expected version
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.move_case_pipeline_v2(
  p_organization_id UUID, p_student_case_id UUID, p_stage TEXT, p_remove BOOLEAN, p_request_id UUID,
  p_expected_version BIGINT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD; fingerprint TEXT; prior platform_private.case_pipeline_requests%ROWTYPE;
  case_row platform.student_cases%ROWTYPE; before_state JSONB; after_state JSONB; receipt JSONB;
BEGIN
  -- The gate of v1 after 244: staff (never a student) whose role holds
  -- case.update.append; the coarse role is frozen since 155 and NULL for
  -- every invited member.
  SELECT a.* INTO actor FROM platform.current_actor_authority() a
    WHERE a.organization_id = p_organization_id AND a.platform_role IS DISTINCT FROM 'student'
      AND platform_private.staff_has_permission(a.organization_id, a.membership_id, 'case.update.append');
  IF NOT FOUND THEN RAISE EXCEPTION 'case_pipeline_forbidden' USING ERRCODE = '42501'; END IF;
  IF p_request_id IS NULL OR p_student_case_id IS NULL OR p_remove IS NULL
    OR (p_stage IS NOT NULL) = p_remove
    OR (p_stage IS NOT NULL AND p_stage <> ALL (ARRAY[
      'new','shortlist','documents','ready_to_submit','awaiting_decision',
      'confirmed','visa','predeparture','arrived'
    ]))
    OR (p_expected_version IS NOT NULL AND p_expected_version < 1)
  THEN
    RAISE EXCEPTION 'case_pipeline_invalid_command' USING ERRCODE = '22023';
  END IF;
  -- The same resource lock as v1: a v1 move of the running release and a v2
  -- move or undo of the same card never interleave.
  PERFORM pg_advisory_xact_lock(hashtextextended('case-pipeline:' || p_organization_id::TEXT || ':' || p_student_case_id::TEXT, 0));
  -- Without an expected version the fingerprint is v1's, byte for byte; the
  -- receipts table is shared, so a request id means one command in both.
  fingerprint := md5((jsonb_build_object(
    'actor', actor.membership_id, 'case', p_student_case_id, 'stage', p_stage, 'remove', p_remove
  ) || CASE WHEN p_expected_version IS NULL THEN '{}'::JSONB
       ELSE jsonb_build_object('expected_version', p_expected_version) END)::TEXT);
  SELECT * INTO prior FROM platform_private.case_pipeline_requests r
    WHERE r.organization_id = p_organization_id AND r.request_id = p_request_id;
  IF FOUND THEN
    IF prior.actor_membership_id <> actor.membership_id OR prior.fingerprint <> fingerprint THEN
      RAISE EXCEPTION 'case_pipeline_request_id_conflict' USING ERRCODE = '22023';
    END IF;
    -- An accepted command replays its receipt, even though its own move has
    -- since changed the version (187's replay-first semantics).
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
  -- Undo: nobody moved the case since the caller's own move. The current
  -- position goes back in DETAIL, so the board can show the card where it is.
  IF p_expected_version IS NOT NULL AND case_row.pipeline_version <> p_expected_version THEN
    RAISE EXCEPTION 'case_pipeline_moved' USING ERRCODE = 'PT409',
      DETAIL = jsonb_build_object(
        'pipeline_stage', case_row.pipeline_stage,
        'pipeline_hidden', case_row.pipeline_hidden_at IS NOT NULL,
        'pipeline_version', case_row.pipeline_version
      )::TEXT;
  END IF;
  before_state := jsonb_build_object('pipeline_stage', case_row.pipeline_stage, 'pipeline_hidden', case_row.pipeline_hidden_at IS NOT NULL);
  -- pipeline_stage, pipeline_hidden_at and pipeline_version sit outside the
  -- ROW(...) tuple platform_private.admissions_guard_case (137) compares, so
  -- this UPDATE never requires an admissions_version bump (187, 251 a/b).
  -- RETURNING reads the version the trigger has just set.
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
    'pipeline_hidden', case_row.pipeline_hidden_at IS NOT NULL,
    'pipeline_version', case_row.pipeline_version, 'request_id', p_request_id
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

-- ---------------------------------------------------------------------------
-- d) Grants as v1; self-check
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION platform.move_case_pipeline_v2(UUID, UUID, TEXT, BOOLEAN, UUID, BIGINT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.move_case_pipeline_v2(UUID, UUID, TEXT, BOOLEAN, UUID, BIGINT)
  TO authenticated;

DO $a251_verify$
DECLARE routine RECORD;
BEGIN
  SELECT p.prosrc, p.prosecdef, p.proconfig INTO routine FROM pg_catalog.pg_proc AS p
    WHERE p.oid = 'platform.move_case_pipeline_v2(uuid,uuid,text,boolean,uuid,bigint)'::regprocedure;
  IF NOT routine.prosecdef OR routine.proconfig IS DISTINCT FROM ARRAY['search_path=""']
    OR routine.prosrc ~ 'platform_role\s*(NOT\s+)?IN\s*\(' OR routine.prosrc ~ 'platform_role\s*<>'
    OR NOT has_function_privilege('authenticated', 'platform.move_case_pipeline_v2(uuid,uuid,text,boolean,uuid,bigint)', 'EXECUTE')
    OR has_function_privilege('anon', 'platform.move_case_pipeline_v2(uuid,uuid,text,boolean,uuid,bigint)', 'EXECUTE')
    OR has_function_privilege('service_role', 'platform.move_case_pipeline_v2(uuid,uuid,text,boolean,uuid,bigint)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'a251_pipeline_move_undo_verification_failed: move_case_pipeline_v2';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS t
      WHERE t.tgrelid = 'platform.student_cases'::regclass AND t.tgname = 'student_cases_pipeline_version'
        AND NOT t.tgisinternal AND t.tgenabled = 'O')
    OR to_regprocedure('platform.move_case_pipeline_v1(uuid,uuid,text,boolean,uuid)') IS NULL
  THEN
    RAISE EXCEPTION 'a251_pipeline_move_undo_verification_failed: trigger or v1';
  END IF;
END
$a251_verify$;

COMMIT;
