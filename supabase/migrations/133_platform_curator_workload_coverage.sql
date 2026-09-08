-- UX-6: explicit Admin coverage, one canonical case owner, no scheduler.
-- Every task command and assignment shares migration 117's transaction lock.
-- This closes task-create/return races before actor and task rows are inspected.
-- https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS
BEGIN;

CREATE TABLE platform_private.case_curator_coverages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations(id),
  student_case_id UUID NOT NULL,
  original_curator_membership_id UUID NOT NULL,
  substitute_curator_membership_id UUID NOT NULL,
  planned_end_on DATE NOT NULL,
  started_scope_version BIGINT NOT NULL,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_membership_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  returned_at TIMESTAMPTZ,
  start_request_id UUID NOT NULL UNIQUE,
  return_request_id UUID UNIQUE,
  UNIQUE (organization_id, id),
  CHECK (original_curator_membership_id <> substitute_curator_membership_id),
  CHECK ((returned_at IS NULL) = (return_request_id IS NULL)),
  FOREIGN KEY (organization_id, student_case_id) REFERENCES platform.student_cases(organization_id, id),
  FOREIGN KEY (organization_id, original_curator_membership_id) REFERENCES platform.organization_memberships(organization_id, id),
  FOREIGN KEY (organization_id, substitute_curator_membership_id) REFERENCES platform.organization_memberships(organization_id, id),
  FOREIGN KEY (organization_id, created_by_membership_id) REFERENCES platform.organization_memberships(organization_id, id)
);
CREATE UNIQUE INDEX case_curator_coverages_one_active_case
  ON platform_private.case_curator_coverages (organization_id, student_case_id)
  WHERE returned_at IS NULL;
CREATE INDEX case_curator_coverages_case_history_idx
  ON platform_private.case_curator_coverages (organization_id, student_case_id);
CREATE TABLE platform_private.case_coverage_tasks (
  organization_id UUID NOT NULL,
  coverage_id UUID NOT NULL,
  case_task_id UUID NOT NULL,
  original_assignee_membership_id UUID NOT NULL,
  transferred_version BIGINT NOT NULL,
  PRIMARY KEY (coverage_id, case_task_id),
  FOREIGN KEY (organization_id, coverage_id) REFERENCES platform_private.case_curator_coverages(organization_id, id),
  FOREIGN KEY (organization_id, case_task_id) REFERENCES platform.case_tasks(organization_id, id),
  FOREIGN KEY (organization_id, original_assignee_membership_id) REFERENCES platform.organization_memberships(organization_id, id)
);
ALTER TABLE platform_private.case_curator_coverages ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.case_curator_coverages FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.case_coverage_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.case_coverage_tasks FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform_private.case_curator_coverages, platform_private.case_coverage_tasks
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Move, don't copy: the existing bodies remain the only task implementations.
ALTER FUNCTION platform.create_case_task(UUID, UUID, TEXT, TEXT, UUID,
  platform.case_task_priority, TIMESTAMPTZ, DATE, platform.case_task_status, BOOLEAN, BIGINT, UUID)
  SET SCHEMA platform_private;
ALTER FUNCTION platform_private.create_case_task(UUID, UUID, TEXT, TEXT, UUID,
  platform.case_task_priority, TIMESTAMPTZ, DATE, platform.case_task_status, BOOLEAN, BIGINT, UUID)
  RENAME TO coverage_create_task_body;
ALTER FUNCTION platform.change_case_task(UUID, UUID, platform.case_task_status, UUID,
  platform.case_task_priority, TIMESTAMPTZ, DATE, BOOLEAN, BIGINT, UUID, TEXT)
  SET SCHEMA platform_private;
ALTER FUNCTION platform_private.change_case_task(UUID, UUID, platform.case_task_status, UUID,
  platform.case_task_priority, TIMESTAMPTZ, DATE, BOOLEAN, BIGINT, UUID, TEXT)
  RENAME TO coverage_change_task_body;
REVOKE ALL ON FUNCTION platform_private.coverage_create_task_body(UUID, UUID, TEXT, TEXT, UUID,
  platform.case_task_priority, TIMESTAMPTZ, DATE, platform.case_task_status, BOOLEAN, BIGINT, UUID),
  platform_private.coverage_change_task_body(UUID, UUID, platform.case_task_status, UUID,
  platform.case_task_priority, TIMESTAMPTZ, DATE, BOOLEAN, BIGINT, UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- A stale Admin form must not recreate open work for a departed Curator after
-- coverage returns. This applies only to cases that entered coverage, only to
-- open work and only Curator assignees. Existing Admin/terminal/uncovered paths
-- retain their canonical policy. The callers hold the shared assignment lock.
CREATE FUNCTION platform_private.coverage_require_current_task_assignee(
  p_organization_id UUID, p_student_case_id UUID, p_assignee_membership_id UUID,
  p_status platform.case_task_status
) RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_status IN ('open','in_progress','blocked') AND EXISTS(
    SELECT 1 FROM platform_private.case_curator_coverages
    WHERE organization_id=p_organization_id AND student_case_id=p_student_case_id
  ) AND EXISTS(
    SELECT 1 FROM platform.organization_memberships AS member
    JOIN platform.student_cases AS sc ON sc.organization_id=member.organization_id AND sc.id=p_student_case_id
    WHERE member.organization_id=p_organization_id AND member.id=p_assignee_membership_id
      AND member."current_role"='curator' AND sc.current_curator_membership_id IS DISTINCT FROM member.id
  ) THEN
    RAISE EXCEPTION 'Open coverage work requires the current Curator' USING ERRCODE='42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION platform_private.coverage_require_current_task_assignee(UUID,UUID,UUID,platform.case_task_status)
  FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;

CREATE FUNCTION private.create_case_task(
  p_organization_id UUID, p_student_case_id UUID, p_task_type TEXT, p_title TEXT,
  p_assignee_membership_id UUID, p_priority platform.case_task_priority,
  p_due_at TIMESTAMPTZ, p_due_on DATE, p_status platform.case_task_status,
  p_student_visible BOOLEAN, p_expected_version BIGINT, p_request_id UUID
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_organization_id IS NULL OR auth.uid() IS NULL OR NOT private.platform_has_permission(p_organization_id,'task.manage') THEN
    RAISE EXCEPTION 'Active task permission is required' USING ERRCODE='42501';
  END IF;
  PERFORM platform_private.lock_student_case_note_assignment_domain(p_organization_id);
  PERFORM platform_private.coverage_require_current_task_assignee(p_organization_id,p_student_case_id,p_assignee_membership_id,p_status);
  RETURN platform_private.coverage_create_task_body(p_organization_id, p_student_case_id,
    p_task_type, p_title, p_assignee_membership_id, p_priority, p_due_at, p_due_on,
    p_status, p_student_visible, p_expected_version, p_request_id);
END $$;
CREATE FUNCTION private.change_case_task(
  p_organization_id UUID, p_case_task_id UUID, p_new_status platform.case_task_status,
  p_new_assignee_membership_id UUID, p_priority platform.case_task_priority,
  p_due_at TIMESTAMPTZ, p_due_on DATE, p_student_visible BOOLEAN,
  p_expected_version BIGINT, p_request_id UUID, p_reason TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE task_case_id UUID;
BEGIN
  IF p_organization_id IS NULL OR auth.uid() IS NULL OR NOT private.platform_has_permission(p_organization_id,'task.manage') THEN
    RAISE EXCEPTION 'Active task permission is required' USING ERRCODE='42501';
  END IF;
  PERFORM platform_private.lock_student_case_note_assignment_domain(p_organization_id);
  SELECT student_case_id INTO task_case_id FROM platform.case_tasks
    WHERE organization_id=p_organization_id AND id=p_case_task_id;
  PERFORM platform_private.coverage_require_current_task_assignee(p_organization_id,task_case_id,p_new_assignee_membership_id,p_new_status);
  RETURN platform_private.coverage_change_task_body(p_organization_id, p_case_task_id,
    p_new_status, p_new_assignee_membership_id, p_priority, p_due_at, p_due_on,
    p_student_visible, p_expected_version, p_request_id, p_reason);
END $$;
CREATE FUNCTION platform.create_case_task(
  p_organization_id UUID, p_student_case_id UUID, p_task_type TEXT, p_title TEXT,
  p_assignee_membership_id UUID, p_priority platform.case_task_priority,
  p_due_at TIMESTAMPTZ, p_due_on DATE, p_status platform.case_task_status,
  p_student_visible BOOLEAN, p_expected_version BIGINT, p_request_id UUID
) RETURNS JSONB LANGUAGE SQL VOLATILE SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.create_case_task(p_organization_id, p_student_case_id, p_task_type,
    p_title, p_assignee_membership_id, p_priority, p_due_at, p_due_on, p_status,
    p_student_visible, p_expected_version, p_request_id)
$$;
CREATE FUNCTION platform.change_case_task(
  p_organization_id UUID, p_case_task_id UUID, p_new_status platform.case_task_status,
  p_new_assignee_membership_id UUID, p_priority platform.case_task_priority,
  p_due_at TIMESTAMPTZ, p_due_on DATE, p_student_visible BOOLEAN,
  p_expected_version BIGINT, p_request_id UUID, p_reason TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE SQL VOLATILE SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.change_case_task(p_organization_id, p_case_task_id, p_new_status,
    p_new_assignee_membership_id, p_priority, p_due_at, p_due_on, p_student_visible,
    p_expected_version, p_request_id, p_reason)
$$;

REVOKE ALL ON FUNCTION
  private.create_case_task(UUID, UUID, TEXT, TEXT, UUID, platform.case_task_priority, TIMESTAMPTZ, DATE, platform.case_task_status, BOOLEAN, BIGINT, UUID),
  platform.create_case_task(UUID, UUID, TEXT, TEXT, UUID, platform.case_task_priority, TIMESTAMPTZ, DATE, platform.case_task_status, BOOLEAN, BIGINT, UUID),
  private.change_case_task(UUID, UUID, platform.case_task_status, UUID, platform.case_task_priority, TIMESTAMPTZ, DATE, BOOLEAN, BIGINT, UUID, TEXT),
  platform.change_case_task(UUID, UUID, platform.case_task_status, UUID, platform.case_task_priority, TIMESTAMPTZ, DATE, BOOLEAN, BIGINT, UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION
  private.create_case_task(UUID, UUID, TEXT, TEXT, UUID, platform.case_task_priority, TIMESTAMPTZ, DATE, platform.case_task_status, BOOLEAN, BIGINT, UUID),
  platform.create_case_task(UUID, UUID, TEXT, TEXT, UUID, platform.case_task_priority, TIMESTAMPTZ, DATE, platform.case_task_status, BOOLEAN, BIGINT, UUID),
  private.change_case_task(UUID, UUID, platform.case_task_status, UUID, platform.case_task_priority, TIMESTAMPTZ, DATE, BOOLEAN, BIGINT, UUID, TEXT),
  platform.change_case_task(UUID, UUID, platform.case_task_status, UUID, platform.case_task_priority, TIMESTAMPTZ, DATE, BOOLEAN, BIGINT, UUID, TEXT)
  TO authenticated;

-- Snapshot every open task, not only selected rows: new/changed work invalidates
-- a submitted preview. Commands hold the shared domain lock before this helper.
CREATE FUNCTION platform_private.coverage_checked_tasks(
  p_organization_id UUID, p_student_case_id UUID, p_tasks JSONB
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE item JSONB; expected JSONB; actual JSONB;
BEGIN
  IF p_tasks IS NULL OR jsonb_typeof(p_tasks) <> 'array' OR jsonb_array_length(p_tasks) > 1000 THEN
    RAISE EXCEPTION 'Invalid coverage task snapshot' USING ERRCODE = '22023';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_tasks) LOOP
    IF jsonb_typeof(item) <> 'object' THEN
      RAISE EXCEPTION 'Invalid coverage task snapshot' USING ERRCODE = '22023';
    END IF;
    IF (SELECT count(*) FROM jsonb_object_keys(item)) <> 3
      OR jsonb_typeof(item->'id') IS DISTINCT FROM 'string'
      OR (item->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR jsonb_typeof(item->'version') IS DISTINCT FROM 'string'
      OR (item->>'version') !~ '^[1-9][0-9]{0,18}$'
      OR jsonb_typeof(item->'selected') IS DISTINCT FROM 'boolean'
    THEN RAISE EXCEPTION 'Invalid coverage task snapshot' USING ERRCODE = '22023'; END IF;
    IF (item->>'version')::NUMERIC > 9223372036854775807 THEN
      RAISE EXCEPTION 'Invalid coverage task snapshot' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_tasks)) <> jsonb_array_length(p_tasks) THEN
    RAISE EXCEPTION 'Duplicate coverage task' USING ERRCODE = '22023';
  END IF;
  PERFORM task.id FROM platform.case_tasks AS task
    WHERE task.organization_id = p_organization_id AND task.student_case_id = p_student_case_id
      AND task.status IN ('open','in_progress','blocked') ORDER BY task.id FOR UPDATE;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',task.id,'version',task.version::TEXT) ORDER BY task.id),'[]'::JSONB)
    INTO actual FROM platform.case_tasks AS task
    WHERE task.organization_id = p_organization_id AND task.student_case_id = p_student_case_id
      AND task.status IN ('open','in_progress','blocked');
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',value->>'id','version',value->>'version') ORDER BY value->>'id'),'[]'::JSONB)
    INTO expected FROM jsonb_array_elements(p_tasks);
  IF actual <> expected THEN
    RAISE EXCEPTION 'case_coverage_version_conflict' USING ERRCODE = 'PT409';
  END IF;
  RETURN p_tasks;
END $$;
REVOKE ALL ON FUNCTION platform_private.coverage_checked_tasks(UUID,UUID,JSONB)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE FUNCTION private.manage_case_coverage(
  p_operation TEXT, p_organization_id UUID, p_student_case_id UUID,
  p_expected_owner UUID, p_expected_scope_version BIGINT,
  p_substitute_membership_id UUID, p_planned_end_on DATE,
  p_coverage_id UUID, p_expected_coverage_version BIGINT,
  p_tasks JSONB, p_reason TEXT, p_request_id UUID
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD; target_case platform.student_cases%ROWTYPE;
  coverage platform_private.case_curator_coverages%ROWTYPE;
  task RECORD; binding RECORD; selected_ids UUID[];
  next_owner UUID; restore_assignee UUID; new_coverage_id UUID;
  assignment JSONB; task_result JSONB; result JSONB; replayed JSONB;
  fingerprint TEXT; action_key TEXT; transfer_count INTEGER := 0;
BEGIN
  IF p_operation IS NULL OR p_operation NOT IN ('start','return') OR p_request_id IS NULL
    OR p_student_case_id IS NULL OR p_expected_owner IS NULL
    OR p_expected_scope_version IS NULL OR p_expected_scope_version < 1
    OR p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 1000
    OR p_tasks IS NULL OR jsonb_typeof(p_tasks) <> 'array'
    OR jsonb_array_length(p_tasks) > 1000 OR octet_length(p_tasks::TEXT) > 200000
  THEN RAISE EXCEPTION 'Invalid coverage command' USING ERRCODE = '22023'; END IF;
  IF p_operation = 'start' AND (p_substitute_membership_id IS NULL OR p_planned_end_on IS NULL
    -- PostgreSQL DATE accepts infinity and >4-digit years; the UI contract does not.
    -- https://www.postgresql.org/docs/current/functions-datetime.html
    OR NOT isfinite(p_planned_end_on) OR p_planned_end_on > DATE '9999-12-31'
    OR p_coverage_id IS NOT NULL OR p_expected_coverage_version IS DISTINCT FROM 0)
  THEN RAISE EXCEPTION 'Invalid coverage start' USING ERRCODE = '22023'; END IF;
  IF p_operation = 'return' AND (p_coverage_id IS NULL OR p_expected_coverage_version IS NULL
    OR p_expected_coverage_version < 1 OR p_substitute_membership_id IS NOT NULL OR p_planned_end_on IS NOT NULL)
  THEN RAISE EXCEPTION 'Invalid coverage return' USING ERRCODE = '22023'; END IF;

  PERFORM platform_private.require_admin_actor(p_organization_id, 'case.curator.assign');
  PERFORM platform_private.lock_student_case_note_assignment_domain(p_organization_id);
  PERFORM platform_private.lock_p2d_request(p_request_id);
  PERFORM platform_private.require_case_assignment_admin_locked(p_organization_id);
  SELECT * INTO actor FROM platform_private.require_admin_actor(p_organization_id, 'case.curator.assign');
  action_key := 'case.coverage.' || p_operation;
  fingerprint := md5(jsonb_build_object('operation',p_operation,'organization_id',p_organization_id,
    'case',p_student_case_id,'owner',p_expected_owner,'scope_version',p_expected_scope_version::TEXT,
    'substitute',p_substitute_membership_id,'end_on',p_planned_end_on,'coverage',p_coverage_id,
    'coverage_version',p_expected_coverage_version::TEXT,'tasks',p_tasks,'actor',actor.actor_membership_id)::TEXT);
  replayed := platform_private.replay_audit(p_request_id,action_key,'student_case',p_student_case_id,
    btrim(p_reason),jsonb_build_object('organization_id',p_organization_id,'request_fingerprint',fingerprint));
  IF replayed IS NOT NULL THEN RETURN replayed; END IF;

  SELECT * INTO target_case FROM platform.student_cases
    WHERE organization_id=p_organization_id AND id=p_student_case_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Student case is unavailable' USING ERRCODE='42501'; END IF;
  IF target_case.state <> 'active' OR target_case.current_curator_membership_id IS DISTINCT FROM p_expected_owner
    OR target_case.current_scope_version IS DISTINCT FROM p_expected_scope_version
  THEN RAISE EXCEPTION 'case_coverage_version_conflict' USING ERRCODE='PT409'; END IF;
  SELECT * INTO coverage FROM platform_private.case_curator_coverages
    WHERE organization_id=p_organization_id AND student_case_id=p_student_case_id AND returned_at IS NULL FOR UPDATE;
  IF p_operation = 'start' THEN
    IF FOUND THEN RAISE EXCEPTION 'case_coverage_version_conflict' USING ERRCODE='PT409'; END IF;
    IF p_planned_end_on < (statement_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE
      OR p_substitute_membership_id = p_expected_owner
    THEN RAISE EXCEPTION 'Invalid substitute or planned return date' USING ERRCODE='22023'; END IF;
    next_owner := p_substitute_membership_id;
    new_coverage_id := gen_random_uuid();
  ELSE
    IF NOT FOUND OR coverage.id <> p_coverage_id OR coverage.version <> p_expected_coverage_version
      OR coverage.substitute_curator_membership_id <> p_expected_owner
      OR coverage.started_scope_version <> p_expected_scope_version
    THEN RAISE EXCEPTION 'case_coverage_version_conflict' USING ERRCODE='PT409'; END IF;
    next_owner := coverage.original_curator_membership_id;
    new_coverage_id := coverage.id;
  END IF;

  -- Lock target identity before assignment; the existing wrapper also verifies
  -- published role/scope and increments access versions in the same transaction.
  PERFORM membership.id FROM platform.organization_memberships AS membership
    JOIN platform.profiles AS profile ON profile.id=membership.profile_id
    JOIN platform.role_bundle_versions AS bundle ON bundle.id=membership.current_bundle_id
      AND bundle.role=membership."current_role" AND bundle.status='published'
    WHERE membership.organization_id=p_organization_id AND membership.id=next_owner
      AND membership.status='active' AND membership."current_role"='curator' AND profile.status='active'
    FOR UPDATE OF membership,profile;
  IF NOT FOUND THEN RAISE EXCEPTION 'Coverage requires an active Curator' USING ERRCODE='42501'; END IF;
  PERFORM platform_private.coverage_checked_tasks(p_organization_id,p_student_case_id,p_tasks);
  SELECT COALESCE(array_agg((value->>'id')::UUID ORDER BY value->>'id'),'{}'::UUID[]) INTO selected_ids
    FROM jsonb_array_elements(p_tasks) WHERE (value->>'selected')::BOOLEAN;

  FOR task IN SELECT task_row.*,member."current_role" AS assignee_role
    FROM platform.case_tasks AS task_row JOIN platform.organization_memberships AS member
      ON member.organization_id=task_row.organization_id AND member.id=task_row.assignee_membership_id
    WHERE task_row.organization_id=p_organization_id AND task_row.student_case_id=p_student_case_id
      AND task_row.status IN ('open','in_progress','blocked') ORDER BY task_row.id
  LOOP
    IF task.assignee_membership_id=p_expected_owner AND NOT task.id=ANY(selected_ids) THEN
      RAISE EXCEPTION 'All outgoing Curator open tasks must be selected' USING ERRCODE='22023';
    END IF;
    IF p_operation='start' THEN
      IF task.assignee_membership_id<>p_expected_owner AND task.assignee_role<>'admin' THEN
        RAISE EXCEPTION 'Open task has an unrelated assignee' USING ERRCODE='PT409';
      END IF;
    ELSE
      SELECT * INTO binding FROM platform_private.case_coverage_tasks
        WHERE coverage_id=coverage.id AND case_task_id=task.id;
      IF FOUND THEN
        IF task.assignee_membership_id<>p_expected_owner OR NOT task.id=ANY(selected_ids)
          OR EXISTS(SELECT 1 FROM platform.audit_events AS event
            WHERE event.organization_id=p_organization_id AND event.resource_type='case_task' AND event.resource_id=task.id
              AND event.action='task.change' AND (event.after_state->>'version')::BIGINT>binding.transferred_version
              AND event.before_state->>'assignee_membership_id' IS DISTINCT FROM event.after_state->>'assignee_membership_id') THEN
          RAISE EXCEPTION 'Coverage task was manually reassigned' USING ERRCODE='PT409';
        END IF;
        IF binding.original_assignee_membership_id<>next_owner THEN
          PERFORM 1 FROM platform.organization_memberships
            WHERE organization_id=p_organization_id AND id=binding.original_assignee_membership_id
              AND "current_role"='admin' AND status='active' FOR UPDATE;
          IF NOT FOUND THEN RAISE EXCEPTION 'Original task assignee is unavailable' USING ERRCODE='42501'; END IF;
        END IF;
        PERFORM platform_private.require_live_task_assignee(p_organization_id,binding.original_assignee_membership_id);
      ELSIF task.assignee_membership_id<>p_expected_owner AND task.id=ANY(selected_ids) THEN
        RAISE EXCEPTION 'Unrelated task must not be transferred on return' USING ERRCODE='22023';
      ELSIF task.assignee_membership_id<>p_expected_owner AND task.assignee_role<>'admin' THEN
        RAISE EXCEPTION 'Open task has an unrelated assignee' USING ERRCODE='PT409';
      END IF;
    END IF;
  END LOOP;

  assignment := platform.assign_student_case_curator(p_organization_id,p_student_case_id,next_owner,
    btrim(p_reason),public.uuid_generate_v5(p_request_id,'coverage:assignment'));
  IF p_operation='start' THEN
    INSERT INTO platform_private.case_curator_coverages(id,organization_id,student_case_id,
      original_curator_membership_id,substitute_curator_membership_id,planned_end_on,
      started_scope_version,created_by_membership_id,start_request_id)
    VALUES(new_coverage_id,p_organization_id,p_student_case_id,p_expected_owner,next_owner,p_planned_end_on,
      (assignment->>'scope_version')::BIGINT,actor.actor_membership_id,p_request_id)
    RETURNING * INTO coverage;
  END IF;

  FOR task IN SELECT * FROM platform.case_tasks
    WHERE organization_id=p_organization_id AND student_case_id=p_student_case_id AND id=ANY(selected_ids)
    ORDER BY id
  LOOP
    restore_assignee := next_owner;
    IF p_operation='return' THEN
      SELECT * INTO binding FROM platform_private.case_coverage_tasks
        WHERE coverage_id=coverage.id AND case_task_id=task.id;
      IF FOUND THEN restore_assignee := binding.original_assignee_membership_id; END IF;
    END IF;
    task_result := platform.change_case_task(p_organization_id,task.id,task.status,restore_assignee,
      task.priority,task.due_at,task.due_on,task.student_visible,task.version,
      public.uuid_generate_v5(p_request_id,'coverage:task:'||task.id::TEXT),btrim(p_reason));
    IF p_operation='start' THEN
      INSERT INTO platform_private.case_coverage_tasks(organization_id,coverage_id,case_task_id,
        original_assignee_membership_id,transferred_version)
      VALUES(p_organization_id,coverage.id,task.id,task.assignee_membership_id,(task_result->>'version')::BIGINT);
    END IF;
    transfer_count := transfer_count+1;
  END LOOP;
  IF EXISTS(SELECT 1 FROM platform.case_tasks WHERE organization_id=p_organization_id
    AND student_case_id=p_student_case_id AND assignee_membership_id=p_expected_owner
    AND status IN ('open','in_progress','blocked'))
  THEN RAISE EXCEPTION 'Outgoing Curator still owns open work' USING ERRCODE='PT409'; END IF;
  IF p_operation='return' THEN
    UPDATE platform_private.case_curator_coverages SET returned_at=statement_timestamp(),
      return_request_id=p_request_id,version=version+1 WHERE id=coverage.id RETURNING * INTO coverage;
  END IF;
  result := jsonb_build_object('organization_id',p_organization_id,'student_case_id',p_student_case_id,
    'coverage_id',coverage.id,'coverage_version',coverage.version::TEXT,
    'original_curator_membership_id',coverage.original_curator_membership_id,
    'substitute_curator_membership_id',coverage.substitute_curator_membership_id,
    'planned_end_on',coverage.planned_end_on,'transferred_task_count',transfer_count,
    'current_scope_version',assignment->>'scope_version','operation',p_operation,
    'request_fingerprint',fingerprint,'changed_at',COALESCE(coverage.returned_at,coverage.created_at));
  INSERT INTO platform.audit_events(organization_id,actor_kind,actor_profile_id,actor_principal,
    action,resource_type,resource_id,before_state,after_state,reason,request_id)
  VALUES(p_organization_id,'user',actor.actor_profile_id,'auth:'||actor.actor_auth_user_id::TEXT,
    action_key,'student_case',p_student_case_id,jsonb_build_object('curator_membership_id',p_expected_owner,
      'scope_version',p_expected_scope_version::TEXT),result,btrim(p_reason),p_request_id);
  RETURN result;
END $$;
CREATE FUNCTION platform.manage_case_coverage(
  p_operation TEXT, p_organization_id UUID, p_student_case_id UUID,
  p_expected_owner UUID, p_expected_scope_version BIGINT,
  p_substitute_membership_id UUID, p_planned_end_on DATE,
  p_coverage_id UUID, p_expected_coverage_version BIGINT,
  p_tasks JSONB, p_reason TEXT, p_request_id UUID
) RETURNS JSONB LANGUAGE SQL VOLATILE SECURITY INVOKER SET search_path='' AS $$
  SELECT private.manage_case_coverage(p_operation,p_organization_id,p_student_case_id,
    p_expected_owner,p_expected_scope_version,p_substitute_membership_id,p_planned_end_on,
    p_coverage_id,p_expected_coverage_version,p_tasks,p_reason,p_request_id)
$$;
REVOKE ALL ON FUNCTION private.manage_case_coverage(TEXT,UUID,UUID,UUID,BIGINT,UUID,DATE,UUID,BIGINT,JSONB,TEXT,UUID),
  platform.manage_case_coverage(TEXT,UUID,UUID,UUID,BIGINT,UUID,DATE,UUID,BIGINT,JSONB,TEXT,UUID)
  FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.manage_case_coverage(TEXT,UUID,UUID,UUID,BIGINT,UUID,DATE,UUID,BIGINT,JSONB,TEXT,UUID),
  platform.manage_case_coverage(TEXT,UUID,UUID,UUID,BIGINT,UUID,DATE,UUID,BIGINT,JSONB,TEXT,UUID) TO authenticated;

-- A single guarded statement returns a consistent read snapshot. Counts are
-- work, not performance rankings; date-only deadlines retain their own kind.
CREATE FUNCTION private.read_curator_coverage_workspace(
  p_organization_id UUID, p_curator_membership_id UUID DEFAULT NULL,
  p_student_case_id UUID DEFAULT NULL, p_after_case_id UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
  workload JSONB; cases JSONB; preview JSONB := NULL; task_rows JSONB;
  target_case platform.student_cases%ROWTYPE;
  coverage platform_private.case_curator_coverages%ROWTYPE;
  conflicts TEXT[] := '{}'::TEXT[]; next_case UUID; total_tasks BIGINT;
BEGIN
  PERFORM platform_private.require_admin_actor(p_organization_id,'case.curator.assign');
  IF (p_student_case_id IS NOT NULL OR p_after_case_id IS NOT NULL) AND p_curator_membership_id IS NULL THEN
    RAISE EXCEPTION 'Select a curator first' USING ERRCODE='22023';
  END IF;
  IF (SELECT count(*) FROM platform.organization_memberships
    WHERE organization_id=p_organization_id AND "current_role"='curator') > 500 THEN
    RAISE EXCEPTION 'Curator directory exceeds supported bound' USING ERRCODE='54000';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',member.id,'name',profile.display_name,
    'active',COALESCE(member.status='active' AND profile.status='active' AND bundle.status='published',false),
    'active_case_count',(SELECT count(*) FROM platform.student_cases AS sc
      WHERE sc.organization_id=p_organization_id AND sc.current_curator_membership_id=member.id AND sc.state='active'),
    'open_task_count',(SELECT count(*) FROM platform.case_tasks AS task
      JOIN platform.student_cases AS sc ON sc.organization_id=task.organization_id AND sc.id=task.student_case_id
      WHERE task.organization_id=p_organization_id AND task.assignee_membership_id=member.id
        AND task.status IN ('open','in_progress','blocked') AND sc.state='active'),
    'nearest_due',(SELECT jsonb_build_object('due_on',task.due_on,'due_at',task.due_at)
      FROM platform.case_tasks AS task JOIN platform.student_cases AS sc
        ON sc.organization_id=task.organization_id AND sc.id=task.student_case_id
      WHERE task.organization_id=p_organization_id AND task.assignee_membership_id=member.id
        AND task.status IN ('open','in_progress','blocked') AND sc.state='active'
        AND (task.due_on IS NOT NULL OR task.due_at IS NOT NULL)
      ORDER BY COALESCE(task.due_at,task.due_on::TIMESTAMP AT TIME ZONE 'Asia/Bishkek'),task.id LIMIT 1)
    ) ORDER BY profile.display_name,member.id),'[]'::JSONB) INTO workload
  FROM platform.organization_memberships AS member
  JOIN platform.profiles AS profile ON profile.id=member.profile_id
  LEFT JOIN platform.role_bundle_versions AS bundle ON bundle.id=member.current_bundle_id AND bundle.role=member."current_role"
  WHERE member.organization_id=p_organization_id AND member."current_role"='curator';
  IF p_curator_membership_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(workload)
    WHERE value->>'id'=p_curator_membership_id::TEXT) THEN
    RAISE EXCEPTION 'Curator unavailable' USING ERRCODE='42501';
  END IF;
  WITH page AS (
    SELECT sc.* FROM platform.student_cases AS sc WHERE sc.organization_id=p_organization_id
      AND sc.current_curator_membership_id=p_curator_membership_id AND sc.state='active'
      AND (p_after_case_id IS NULL OR sc.id>p_after_case_id) ORDER BY sc.id LIMIT 51
  ), visible AS (SELECT * FROM page ORDER BY id LIMIT 50)
  SELECT COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'name',student_display_name) ORDER BY id) FROM visible),'[]'::JSONB),
    CASE WHEN (SELECT count(*) FROM page)>50 THEN (SELECT id FROM visible ORDER BY id DESC LIMIT 1) ELSE NULL END
    INTO cases,next_case;
  IF p_student_case_id IS NOT NULL THEN
    SELECT * INTO target_case FROM platform.student_cases WHERE organization_id=p_organization_id
      AND id=p_student_case_id AND state='active';
    IF NOT FOUND THEN RAISE EXCEPTION 'Student case unavailable' USING ERRCODE='42501'; END IF;
    IF target_case.current_curator_membership_id IS DISTINCT FROM p_curator_membership_id THEN
      conflicts:=array_append(conflicts,'assignment_changed');
    END IF;
    SELECT * INTO coverage FROM platform_private.case_curator_coverages
      WHERE organization_id=p_organization_id AND student_case_id=p_student_case_id AND returned_at IS NULL;
    IF FOUND AND (coverage.substitute_curator_membership_id<>target_case.current_curator_membership_id
      OR coverage.started_scope_version<>target_case.current_scope_version) THEN
      IF NOT 'assignment_changed'=ANY(conflicts) THEN conflicts:=array_append(conflicts,'assignment_changed'); END IF;
    END IF;
    IF coverage.id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(workload)
      WHERE value->>'id'=coverage.original_curator_membership_id::TEXT AND value->>'active'='true') THEN
      conflicts:=array_append(conflicts,'original_curator_unavailable');
    END IF;
    SELECT count(*) INTO total_tasks FROM platform.case_tasks WHERE organization_id=p_organization_id
      AND student_case_id=p_student_case_id AND status IN ('open','in_progress','blocked');
    IF total_tasks>1000 THEN RAISE EXCEPTION 'Coverage task preview exceeds supported bound' USING ERRCODE='54000'; END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',task.id,'version',task.version::TEXT,'title',task.title,'status',task.status,
      'due_on',task.due_on,'due_at',task.due_at,
      'assignee_id',task.assignee_membership_id,'assignee_name',profile.display_name,
      'tracked',binding.case_task_id IS NOT NULL,
      'required',task.assignee_membership_id=target_case.current_curator_membership_id OR binding.case_task_id IS NOT NULL,
      'can_transfer',CASE WHEN coverage.id IS NULL THEN task.assignee_membership_id=target_case.current_curator_membership_id OR member."current_role"='admin'
        ELSE task.assignee_membership_id=target_case.current_curator_membership_id END,
      'return_assignee_id',CASE WHEN coverage.id IS NULL THEN NULL ELSE COALESCE(binding.original_assignee_membership_id,coverage.original_curator_membership_id) END,
      'return_assignee_name',CASE WHEN coverage.id IS NULL THEN NULL ELSE return_profile.display_name END,
      'conflict',CASE
        WHEN binding.case_task_id IS NOT NULL AND (task.assignee_membership_id<>target_case.current_curator_membership_id
          OR EXISTS(SELECT 1 FROM platform.audit_events AS event
            WHERE event.organization_id=p_organization_id AND event.resource_type='case_task' AND event.resource_id=task.id
              AND event.action='task.change' AND (event.after_state->>'version')::BIGINT>binding.transferred_version
              AND event.before_state->>'assignee_membership_id' IS DISTINCT FROM event.after_state->>'assignee_membership_id')) THEN 'task_reassigned'
        WHEN binding.case_task_id IS NOT NULL AND (return_member.status<>'active' OR return_profile.status<>'active'
          OR return_bundle.status IS DISTINCT FROM 'published' OR (return_member.id<>coverage.original_curator_membership_id AND return_member."current_role"<>'admin')) THEN 'original_assignee_unavailable'
        WHEN task.assignee_membership_id<>target_case.current_curator_membership_id AND member."current_role"<>'admin' THEN 'unrelated_assignee'
        ELSE NULL END
      ) ORDER BY task.id),'[]'::JSONB) INTO task_rows
    FROM platform.case_tasks AS task JOIN platform.organization_memberships AS member
      ON member.organization_id=task.organization_id AND member.id=task.assignee_membership_id
    JOIN platform.profiles AS profile ON profile.id=member.profile_id
    LEFT JOIN platform_private.case_coverage_tasks AS binding ON binding.coverage_id=coverage.id AND binding.case_task_id=task.id
    LEFT JOIN platform.organization_memberships AS return_member ON return_member.organization_id=p_organization_id
      AND return_member.id=COALESCE(binding.original_assignee_membership_id,coverage.original_curator_membership_id)
    LEFT JOIN platform.profiles AS return_profile ON return_profile.id=return_member.profile_id
    LEFT JOIN platform.role_bundle_versions AS return_bundle ON return_bundle.id=return_member.current_bundle_id AND return_bundle.role=return_member."current_role"
    WHERE task.organization_id=p_organization_id AND task.student_case_id=p_student_case_id AND task.status IN ('open','in_progress','blocked');
    preview:=jsonb_build_object('id',target_case.id,'name',target_case.student_display_name,
      'owner_id',target_case.current_curator_membership_id,'scope_version',target_case.current_scope_version::TEXT,
      'tasks',task_rows,'conflicts',to_jsonb(conflicts),'coverage',CASE WHEN coverage.id IS NULL THEN NULL ELSE
        jsonb_build_object('id',coverage.id,'version',coverage.version::TEXT,'original_curator_id',coverage.original_curator_membership_id,
          'substitute_curator_id',coverage.substitute_curator_membership_id,'planned_end_on',coverage.planned_end_on) END);
  END IF;
  RETURN jsonb_build_object('organization_id',p_organization_id,'curators',workload,'cases',cases,
    'next_case_id',next_case,'preview',preview);
END $$;
CREATE FUNCTION platform.read_curator_coverage_workspace(
  p_organization_id UUID, p_curator_membership_id UUID DEFAULT NULL,
  p_student_case_id UUID DEFAULT NULL, p_after_case_id UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE SQL STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT private.read_curator_coverage_workspace(p_organization_id,p_curator_membership_id,p_student_case_id,p_after_case_id)
$$;
REVOKE ALL ON FUNCTION private.read_curator_coverage_workspace(UUID,UUID,UUID,UUID),
  platform.read_curator_coverage_workspace(UUID,UUID,UUID,UUID) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.read_curator_coverage_workspace(UUID,UUID,UUID,UUID),
  platform.read_curator_coverage_workspace(UUID,UUID,UUID,UUID) TO authenticated;

COMMIT;
