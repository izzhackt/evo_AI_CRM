-- Доступ по правам роли для приглашённых сотрудников (аудит доступа 26.09.2026).
-- docs/PLAN_CHANGES.md «2026-09-26 — Доступ по правам роли для приглашённых
-- сотрудников (миграция 243)» and «2026-09-26 — Доступ по правам роли: номер
-- миграции 243 → 244»: written as 243, renumbered to 244 on the rebase onto
-- #1064, which took 243 (243_platform_case_baseline_options_read_gate.sql,
-- a disjoint function). The content is unchanged.
--
-- Why: since 155 the coarse role (organization_memberships.current_role) is
-- frozen. Every staff member invited through «Сотрудники» has it NULL, so
-- platform.current_actor_authority().platform_role is NULL for them; only the
-- system Admin carries 'admin'. Permissions come from scoped role assignments
-- (staff_has_permission / staff_can_access). Six functions still decided on
-- the coarse role, found by the 26.09 read-only audit and reproduced on a
-- disposable 001-242 database with members shaped like production:
--   * move_case_pipeline_v1 (187:152) refused Admissions and Admissions
--     Manager although the role holds case.update.append;
--   * private.assign_case_curator_v1 (182:499) called
--     platform_private.require_case_assignment_admin_locked, which 156:1616
--     dropped, so it failed with 42883 for everyone, the Admin included;
--   * staff_save_application_requirements_v1 (226:768-769) resolved a NULL
--     organization for a NULL-role actor and refused document.manage holders;
--   * prepare_lead_cabinet_v1 (184:324-325) refused the Sales Manager although
--     the role holds lead.sales.workflow.manage on the lead;
--   * staff_account_deletion_requests_v1 (196:203) let a NULL role PASS
--     `platform_role <> 'admin'` (NULL is not TRUE), so any staff member with
--     organization.read could list students' deletion requests;
--   * the board, «Студенты» queue, its counts and the direction summary
--     (191:653, 241:276/445 with 242, 183:52) let staff pass
--     `NOT IN ('admin','curator')` only through the same NULL semantics.
--
-- Forward-only. CREATE OR REPLACE over the LATEST definition of each function
-- (187, 182, 226, 184, 196, 191, 241+242, 183 — nothing later patches them);
-- SECURITY DEFINER, search_path = '', signatures, owner, grants and error
-- codes/messages are unchanged:
--  a) platform.move_case_pipeline_v1: the actor is staff, not a student, and
--     the role holds case.update.append; the per-case
--     staff_can_access(..., 'case.update.append', 'student_case', ...) check
--     still decides, after the request-id replay exactly as in 187.
--  b) private.assign_case_curator_v1: the dropped helper is replaced by the
--     existing platform_private.require_case_assignment_operator_locked(org,
--     case) (156:977): require_case_operator -> require_domain_actor locks the
--     organization, profile and membership rows and re-reads the actor, then
--     checks case.curator.assign on this case — the same post-lock recheck
--     156 already put into private.assign_student_case_curator. Authority stays
--     Admin-only: require_admin_actor before and after the locks is unchanged.
--     Letting Admissions Manager assign is an open owner decision (B).
--  c) platform.staff_save_application_requirements_v1: actor lookup
--     `IS DISTINCT FROM 'student'` (self-verifying anchor replace of the one
--     line in the 244-line 226 body, the 182/241/242 pattern).
--  d) platform.prepare_lead_cabinet_v1: the coarse predicate is dropped; the
--     actor must be staff (not a student) and
--     staff_can_access(..., 'lead.sales.workflow.manage', 'lead', ...) decides
--     as before. The function only creates the pending lead-cabinet case; it
--     never calls portal provisioning. The invite/provisioning functions
--     (require_student_portal_cabinet_actor_e1,
--     assert_student_portal_cabinet_membership_e1,
--     prepare_student_portal_provisioning) are NOT touched — owner decision C.
--  e) platform.staff_account_deletion_requests_v1: `IS DISTINCT FROM 'admin'`
--     — Admin only, as the UI (platform-account-deletion.ts).
--  f) board, queue, counts and direction summary reads: students and anon are
--     refused explicitly (`membership_id IS NULL OR platform_role IS NOT
--     DISTINCT FROM 'student'`); staff pass through their existing
--     case.read.full check and per-row private.platform_can_read_student_case.
--     Production has no active coarse sales/curator members (26.09 audit), so
--     the set of readers is unchanged.
-- Deliberately unchanged: save_lead_sale_conditions_v1 (the UI uses the
-- permission-based _group_v1), kb_require_admin (Admin only by design, owner
-- decision E), staff_student_portal_curator_options (owner decision B).
BEGIN;

-- ---------------------------------------------------------------------------
-- a) platform.move_case_pipeline_v1 (187): staff with case.update.append
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION platform.move_case_pipeline_v1(
  p_organization_id UUID, p_student_case_id UUID, p_stage TEXT, p_remove BOOLEAN, p_request_id UUID
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD; fingerprint TEXT; prior platform_private.case_pipeline_requests%ROWTYPE;
  case_row platform.student_cases%ROWTYPE; before_state JSONB; after_state JSONB; receipt JSONB;
BEGIN
  -- 244: staff (never a student) whose role holds case.update.append; the
  -- coarse role is frozen since 155 and NULL for every invited member.
  SELECT a.* INTO actor FROM platform.current_actor_authority() a
    WHERE a.organization_id = p_organization_id AND a.platform_role IS DISTINCT FROM 'student'
      AND platform_private.staff_has_permission(a.organization_id, a.membership_id, 'case.update.append');
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

-- ---------------------------------------------------------------------------
-- b) private.assign_case_curator_v1 (182): the post-lock recheck that exists
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.assign_case_curator_v1(
  p_organization_id UUID, p_request_id UUID, p_student_case_id UUID,
  p_curator_membership_id UUID, p_reason TEXT
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  target_case platform.student_cases%ROWTYPE;
  replayed JSONB;
BEGIN
  IF p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 1000
    OR p_student_case_id IS NULL OR p_curator_membership_id IS NULL OR p_request_id IS NULL
  THEN
    RAISE EXCEPTION 'Assignment reason of 1 to 1000 characters is required' USING ERRCODE = '22023';
  END IF;

  -- Read-only preflight before the shared assignment-domain lock, exactly
  -- like 117's private.assign_student_case_curator.
  PERFORM 1 FROM platform_private.require_admin_actor(p_organization_id, 'case.curator.assign');
  PERFORM platform_private.lock_student_case_note_assignment_domain(p_organization_id);
  PERFORM platform_private.lock_p2d_request(p_request_id);
  -- 244: 156 dropped the Admin-only locked recheck this body used to call
  -- and moved 117's assign path to this helper (row locks +
  -- case.curator.assign on the case). require_admin_actor around it keeps
  -- this RPC Admin-only.
  PERFORM platform_private.require_case_assignment_operator_locked(p_organization_id, p_student_case_id);
  SELECT * INTO actor FROM platform_private.require_admin_actor(p_organization_id, 'case.curator.assign');

  -- A successful call moves the case out of 'pending', so a retried request
  -- (same request_id) must replay the cached result BEFORE the needs-curator
  -- shape check below — otherwise a network retry after a real success would
  -- fail closed on "Case does not need a curator assignment" instead of
  -- returning the original receipt. Same action/shape
  -- assign_student_case_curator_authorized_e1 itself checks again internally.
  replayed := platform_private.replay_audit(
    p_request_id, 'case.curator.set', 'student_case', p_student_case_id, btrim(p_reason),
    jsonb_build_object(
      'organization_id', p_organization_id, 'student_case_id', p_student_case_id,
      'curator_membership_id', p_curator_membership_id
    )
  );
  IF replayed IS NOT NULL THEN RETURN replayed; END IF;

  SELECT * INTO target_case FROM platform.student_cases
  WHERE organization_id = p_organization_id AND id = p_student_case_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student case is unavailable' USING ERRCODE = '42501';
  END IF;
  -- Scoped to the needs-curator shape only: a pending case with sale/handoff
  -- evidence (declined-assignment revert today). A bare S1 cabinet-before-sale
  -- case is not assignable through this entry point — plan §7 only covers
  -- reassigning an existing sale's case, never a manual early assignment.
  IF target_case.state <> 'pending'
    OR NOT platform_private.case_sale_or_handoff_evidence(p_organization_id, p_student_case_id)
  THEN
    RAISE EXCEPTION 'Case does not need a curator assignment' USING ERRCODE = '55000';
  END IF;

  RETURN platform_private.assign_student_case_curator_authorized_e1(
    p_organization_id, p_student_case_id, p_curator_membership_id, p_reason, p_request_id,
    actor.actor_profile_id, actor.actor_membership_id, actor.actor_auth_user_id
  );
END
$$;

-- ---------------------------------------------------------------------------
-- c) platform.staff_save_application_requirements_v1 (226): staff actor row
-- ---------------------------------------------------------------------------
DO $a244_requirements$
DECLARE
  original TEXT;
  body TEXT;
  old_lookup CONSTANT TEXT := $q$WHERE authority.platform_role<>'student';$q$;
  new_lookup CONSTANT TEXT := $q$WHERE authority.platform_role IS DISTINCT FROM 'student';$q$;
BEGIN
  original := pg_get_functiondef('platform.staff_save_application_requirements_v1(uuid,uuid,uuid,jsonb)'::regprocedure);
  body := replace(original, old_lookup, new_lookup);
  IF (length(original) - length(replace(original, old_lookup, ''))) / length(old_lookup) <> 1
    OR (length(original) - length(replace(original, new_lookup, ''))) / length(new_lookup) <> 0
    OR (length(body) - length(replace(body, new_lookup, ''))) / length(new_lookup) <> 1
  THEN
    RAISE EXCEPTION 'application_requirements_actor_lookup_anchor_drift';
  END IF;
  EXECUTE body;
END
$a244_requirements$;

-- ---------------------------------------------------------------------------
-- d) platform.prepare_lead_cabinet_v1 (184): staff with the lead permission
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION platform.prepare_lead_cabinet_v1(p_organization_id UUID,p_request_id UUID,p_lead_id UUID) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor RECORD; owner_id UUID; client_id_value UUID; client_name TEXT; client_email TEXT;
  new_case UUID:=gen_random_uuid(); scope_id UUID:=gen_random_uuid();
  replay_shape JSONB; replayed JSONB; changed platform.student_cases%ROWTYPE; result JSONB;
BEGIN
  PERFORM platform_private.lock_p2d_request(p_request_id);
  IF p_lead_id IS NULL THEN RAISE EXCEPTION 'lead_cabinet_invalid_command' USING ERRCODE='22023'; END IF;
  -- 244: staff (never a student); the lead permission below decides, not the
  -- coarse role frozen since 155.
  SELECT a.* INTO actor FROM platform.current_actor_authority() a
    WHERE a.organization_id=p_organization_id AND a.platform_role IS DISTINCT FROM 'student';
  IF NOT FOUND THEN RAISE EXCEPTION 'lead_cabinet_forbidden' USING ERRCODE='42501'; END IF;
  IF NOT platform_private.staff_can_access(p_organization_id,actor.membership_id,'lead.sales.workflow.manage','lead',p_lead_id) THEN
    RAISE EXCEPTION 'lead_cabinet_forbidden' USING ERRCODE='42501'; END IF;

  replay_shape:=jsonb_build_object('organization_id',p_organization_id,'lead_id',p_lead_id,'actor_membership_id',actor.membership_id);
  replayed:=platform_private.replay_audit(p_request_id,'lead.cabinet.prepare','lead',p_lead_id,
    'Кабинет подготовлен для лида без связанного дела',replay_shape);
  IF replayed IS NOT NULL THEN RETURN replayed; END IF;

  SELECT l.current_owner_membership_id,l.client_id,c.display_name,c.normalized_email
    INTO owner_id,client_id_value,client_name,client_email
    FROM platform.leads l JOIN platform.clients c ON c.organization_id=l.organization_id AND c.id=l.client_id
    WHERE l.organization_id=p_organization_id AND l.id=p_lead_id AND l.lifecycle_state='open' AND c.lifecycle_state='active'
    FOR UPDATE OF l,c;
  IF NOT FOUND THEN RAISE EXCEPTION 'lead_cabinet_forbidden' USING ERRCODE='42501'; END IF;

  -- One person — one card (plan §1): the guard is CLIENT-scoped, not
  -- lead-scoped — the same person may own several leads (site + WhatsApp),
  -- and a cabinet prepared from any of them must block the rest. The
  -- clients-row FOR UPDATE above serializes concurrent prepares.
  IF EXISTS(SELECT 1 FROM platform.student_cases sc
      WHERE sc.organization_id=p_organization_id AND sc.state IN ('pending','active')
        AND (sc.canonical_client_id=client_id_value
          OR sc.canonical_lead_id IN (
            SELECT l2.id FROM platform.leads l2
            WHERE l2.organization_id=p_organization_id AND l2.client_id=client_id_value))) THEN
    RAISE EXCEPTION 'lead_cabinet_case_exists' USING ERRCODE='PT409'; END IF;
  IF client_email IS NOT NULL AND EXISTS(
      SELECT 1 FROM auth.users u JOIN platform.profiles p ON p.auth_user_id=u.id
        JOIN platform.organization_memberships m ON m.profile_id=p.id
      WHERE lower(btrim(u.email))=client_email AND m.organization_id=p_organization_id AND m."current_role"='student') THEN
    RAISE EXCEPTION 'lead_cabinet_membership_exists' USING ERRCODE='PT409'; END IF;

  INSERT INTO platform.record_scopes(id,organization_id,scope_kind,scope_key,scope_version)
    VALUES(scope_id,p_organization_id,'student_case',new_case,1);
  INSERT INTO platform.student_cases(id,organization_id,responsible_sales_membership_id,source_key,student_display_name,
    operational_stage,state,current_scope_id,current_scope_version,canonical_lead_id,canonical_client_id)
  VALUES(new_case,p_organization_id,owner_id,'lead-cabinet:'||p_lead_id::TEXT,client_name,
    'intake_review','pending',scope_id,1,p_lead_id,client_id_value)
  RETURNING * INTO changed;

  result:=replay_shape||jsonb_build_object('student_case_id',changed.id,'state',changed.state::TEXT);
  INSERT INTO platform.audit_events(organization_id,actor_kind,actor_profile_id,actor_principal,action,resource_type,resource_id,after_state,reason,request_id)
    VALUES(p_organization_id,'user',actor.profile_id,'auth:'||actor.auth_user_id::TEXT,'lead.cabinet.prepare','lead',p_lead_id,result,
      'Кабинет подготовлен для лида без связанного дела',p_request_id);
  RETURN result;
END $$;

-- ---------------------------------------------------------------------------
-- e) platform.staff_account_deletion_requests_v1 (196): Admin only
-- ---------------------------------------------------------------------------
-- Staff-чтение запросов удаления: только admin своей организации (план §6:
-- «Удаление аккаунта» — процесс команды; sales/curator доступа не имеют).
-- 244: `<> 'admin'` пропускал NULL-роль; IS DISTINCT FROM отказывает ей.
CREATE OR REPLACE FUNCTION platform.staff_account_deletion_requests_v1()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a RECORD;
BEGIN
  SELECT * INTO a FROM platform.current_actor_authority();
  IF a.membership_id IS NULL OR a.platform_role IS DISTINCT FROM 'admin'
    OR NOT private.platform_has_permission(a.organization_id, 'organization.read') THEN
    RAISE EXCEPTION 'Deletion requests unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'requestId', r.request_id,
      'membershipId', r.membership_id,
      'displayName', p.display_name,
      'status', r.status,
      'requestedAt', r.created_at,
      'studentCaseId', (
        SELECT sc.id FROM platform.student_cases sc
        WHERE sc.organization_id = r.organization_id
          AND sc.student_membership_id = r.membership_id
        ORDER BY sc.created_at, sc.id LIMIT 1
      )
    ) ORDER BY r.created_at DESC, r.request_id)
    FROM platform_private.account_deletion_requests r
    JOIN platform.organization_memberships m
      ON m.organization_id = r.organization_id AND m.id = r.membership_id
    JOIN platform.profiles p ON p.id = m.profile_id
    WHERE r.organization_id = a.organization_id
  ), '[]'::JSONB);
END $$;

-- ---------------------------------------------------------------------------
-- f) Board, queue, counts and direction summary: refuse students and anon
-- explicitly; staff pass by case.read.full as before
-- ---------------------------------------------------------------------------
DO $a244_reads$
DECLARE
  target RECORD;
  original TEXT;
  body TEXT;
BEGIN
  FOR target IN SELECT * FROM (VALUES
    ('platform.staff_admissions_pipeline_board_v1(uuid,text,text,text)',
      $q$a.platform_role NOT IN ('admin', 'curator')$q$),
    ('platform.staff_student_case_queue_v1(text,integer,text,text,text,uuid,text,text)',
      $q$a.platform_role NOT IN ('admin', 'curator')$q$),
    ('platform.staff_student_case_queue_counts_v1(text,text,uuid,text,text)',
      $q$a.platform_role NOT IN ('admin', 'curator')$q$),
    ('platform.admissions_direction_summary_v1(text,uuid,date,date)',
      $q$a.platform_role NOT IN ('admin','curator')$q$)
  ) AS t(signature, old_gate) LOOP
    original := pg_get_functiondef(target.signature::regprocedure);
    body := replace(original, target.old_gate, $q$a.platform_role IS NOT DISTINCT FROM 'student'$q$);
    IF (length(original) - length(replace(original, target.old_gate, ''))) / length(target.old_gate) <> 1
      OR strpos(original, $q$a.membership_id IS NULL OR $q$ || target.old_gate) = 0
      OR strpos(original, 'platform_role IS NOT DISTINCT FROM') <> 0
      OR (length(body) - length(replace(body, $q$a.platform_role IS NOT DISTINCT FROM 'student'$q$, '')))
        / length($q$a.platform_role IS NOT DISTINCT FROM 'student'$q$) <> 1
    THEN
      RAISE EXCEPTION 'staff_admissions_read_gate_anchor_drift: %', target.signature;
    END IF;
    EXECUTE body;
  END LOOP;
END
$a244_reads$;

-- ---------------------------------------------------------------------------
-- g) Same grants as their origin migrations, restated; self-check
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  platform.move_case_pipeline_v1(UUID, UUID, TEXT, BOOLEAN, UUID),
  private.assign_case_curator_v1(UUID, UUID, UUID, UUID, TEXT),
  platform.staff_save_application_requirements_v1(UUID, UUID, UUID, JSONB),
  platform.prepare_lead_cabinet_v1(UUID, UUID, UUID),
  platform.staff_account_deletion_requests_v1(),
  platform.staff_admissions_pipeline_board_v1(UUID, TEXT, TEXT, TEXT),
  platform.staff_student_case_queue_v1(TEXT, INTEGER, TEXT, TEXT, TEXT, UUID, TEXT, TEXT),
  platform.staff_student_case_queue_counts_v1(TEXT, TEXT, UUID, TEXT, TEXT),
  platform.admissions_direction_summary_v1(TEXT, UUID, DATE, DATE)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION
  platform.move_case_pipeline_v1(UUID, UUID, TEXT, BOOLEAN, UUID),
  private.assign_case_curator_v1(UUID, UUID, UUID, UUID, TEXT),
  platform.staff_save_application_requirements_v1(UUID, UUID, UUID, JSONB),
  platform.prepare_lead_cabinet_v1(UUID, UUID, UUID),
  platform.staff_account_deletion_requests_v1(),
  platform.staff_admissions_pipeline_board_v1(UUID, TEXT, TEXT, TEXT),
  platform.staff_student_case_queue_v1(TEXT, INTEGER, TEXT, TEXT, TEXT, UUID, TEXT, TEXT),
  platform.staff_student_case_queue_counts_v1(TEXT, TEXT, UUID, TEXT, TEXT),
  platform.admissions_direction_summary_v1(TEXT, UUID, DATE, DATE)
  TO authenticated;

-- No coarse-role gate and no call to the dropped helper remain in the nine
-- bodies; each stays SECURITY DEFINER with the empty search_path.
DO $a244_verify$
DECLARE routine RECORD;
BEGIN
  FOR routine IN SELECT p.oid::REGPROCEDURE AS signature, p.prosrc, p.prosecdef, p.proconfig
    FROM pg_catalog.pg_proc AS p
    WHERE p.oid IN (
      'platform.move_case_pipeline_v1(uuid,uuid,text,boolean,uuid)'::regprocedure,
      'private.assign_case_curator_v1(uuid,uuid,uuid,uuid,text)'::regprocedure,
      'platform.staff_save_application_requirements_v1(uuid,uuid,uuid,jsonb)'::regprocedure,
      'platform.prepare_lead_cabinet_v1(uuid,uuid,uuid)'::regprocedure,
      'platform.staff_account_deletion_requests_v1()'::regprocedure,
      'platform.staff_admissions_pipeline_board_v1(uuid,text,text,text)'::regprocedure,
      'platform.staff_student_case_queue_v1(text,integer,text,text,text,uuid,text,text)'::regprocedure,
      'platform.staff_student_case_queue_counts_v1(text,text,uuid,text,text)'::regprocedure,
      'platform.admissions_direction_summary_v1(text,uuid,date,date)'::regprocedure)
  LOOP
    IF routine.prosrc ~ 'platform_role\s*(NOT\s+)?IN\s*\(' OR routine.prosrc ~ 'platform_role\s*<>'
      OR strpos(routine.prosrc, 'require_case_assignment_admin_locked') <> 0
      OR NOT routine.prosecdef OR routine.proconfig IS DISTINCT FROM ARRAY['search_path=""']
    THEN
      RAISE EXCEPTION 'a244_access_by_permissions_verification_failed: %', routine.signature;
    END IF;
  END LOOP;
  IF to_regprocedure('platform_private.require_case_assignment_operator_locked(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'a244_access_by_permissions_verification_failed: operator helper missing';
  END IF;
END
$a244_verify$;

COMMIT;
