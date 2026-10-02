-- A sale saved into an already open cabinet is a completed handoff (issue #1075,
-- owner decision 01.10.2026: option 1 of the issue; docs/PLAN_CHANGES.md
-- «2026-10-01 — исправления по сверке с планами»).
--
-- Why: platform.create_sales_report_handoff (208/215) has two creation
-- branches. The ordinary one calls handoff_lead_to_admissions, which writes the
-- completed platform.sales_admissions_handoffs row (088), three starter tasks
-- and the audit. The `pending_case` branch (a lead whose cabinet is already open
-- as a curator-less pending case) activates THAT case, assigns the curator and
-- inserts the report record, but writes no 088 row. 182's
-- private.respond_student_case_handoff then stops at
-- 42501 'Completed handoff is required' and
-- platform.student_case_handoff_acknowledgements.handoff_id (NOT NULL, FK to
-- 088) has nothing to point at, so the assigned curator can never accept,
-- clarify or decline. 247 only made Lead 360 say so in words
-- (acceptance_recordable = false).
--
-- Contract (option 1): the `pending_case` branch writes the same completed
-- 088 row, in the same transaction, for the activated case. 182 and 130 stay
-- byte-identical and work unchanged.
--
--  a) platform_private.record_pending_case_sales_handoff: everything
--     handoff_lead_to_admissions (088) writes after it activates a case, for a
--     case that is already active — the completed 088 row (mode 'sales_report',
--     the lead's gate and workflow versions, the same sales_context /
--     client_context / provenance / conversation_links shapes), the three
--     'u6.*' starter tasks with their task events, and the audit rows
--     'task.create' x3 and 'lead.admissions.handoff.completed'. The starter
--     tasks are not optional: the staff case page reads the handoff context
--     (staff_student_case_handoff_context -> getPlatformStudentCaseHandoffContext)
--     and refuses a 088 row without exactly its three starter tasks, which
--     would break Student 360 for every case this migration gives a row.
--     The case itself (operational stage, next action) is not touched: the
--     curator assignment helper the 208 branch already runs activated it.
--     The 088 request-replay receipt (platform_private.sales_admissions_
--     handoff_receipts) is handoff_lead_to_admissions' own idempotency record
--     and is read nowhere else; the sale command replays from its own receipt
--     (sales_report_handoff_requests), so none is written here.
--  b) platform.create_sales_report_handoff: a self-verifying anchor replace on
--     the LIVE definition (215's body, md5 below; the 230/249 pattern, never a
--     blind CREATE OR REPLACE of a released function). One call is added right
--     after the report record is inserted. The report record comes FIRST on
--     purpose: 134's AFTER INSERT trigger on the new 088 row finds it and
--     returns, so no second report record is ever created (UNIQUE
--     (organization_id, lead_id) on the register would refuse one anyway).
--     Signature, owner, SECURITY DEFINER, search_path, ACL, locks, replay,
--     errors and the receipt are unchanged. The new write is in the sale's own
--     transaction: if it cannot be written, the sale is not saved either.
--  c) platform_private.restore_pending_case_sales_handoffs + one idempotent
--     backfill: every case that already went through the 208 `pending_case`
--     path — proven by BOTH the pipeline record's `activation = 'pending_case'`
--     snapshot and its immutable create receipt (the proof 247's
--     sales_lead_handoffs uses) — and has no 088 row gets one, dated by the
--     receipt, owned by the receipt's actor and curator, with the same starter
--     tasks (open; assigned to the case's current curator, or to the receipt's
--     curator when the case has none). The restored row's reason says it was
--     restored here; the gate and workflow versions are the lead's current
--     ones (the originals were never recorded). No audit rows are written by
--     the backfill (no signed-in actor). A candidate whose lead has no gate row
--     stops the migration loudly (0 such leads in production; every lead gets
--     its gate from 087's trigger) rather than being skipped silently.
--     Read-only production check on 2026-10-02: 0 such cases (1 pipeline
--     record, which is the ordinary 088 path; 1 report receipt; 1 handoff row;
--     0 leads without a gate; create_sales_report_handoff md5 as below), so the
--     backfill is a no-op there. The same function is proven on a case created
--     by the real command by supabase/tests/platform_pending_case_handoff.sql.
--
-- Not changed: 182/130 (the response commands), 247/254 (Lead 360 strip: its
-- 'acceptance_recordable' is EXISTS(088 row for the case) and is now true for
-- these cases, so the strip shows the normal «ждёт ответа»), the report
-- trigger, the case row, and every released signature. What does change for
-- such a case, as for any case with a 088 row: it can be configured for
-- admissions (137 requires the 088 row), Sales sees the curator's answer
-- (130), its handoff context shows in Student 360, and it counts in the
-- «Передача» facts of Settings like every other handoff.
--
-- Release: apply through evo-schema-ledger.yml after 254 (and 255-257 when they
-- merge first); no application code changes are required for it to take effect.
BEGIN;

-- ---------------------------------------------------------------------------
-- a) The completed handoff record of a sale saved into an open cabinet
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.record_pending_case_sales_handoff(
  p_organization_id UUID,
  p_lead_id UUID,
  p_student_case_id UUID,
  p_actor_membership_id UUID,
  p_actor_profile_id UUID,
  p_actor_auth_user_id UUID,
  p_curator_membership_id UUID,
  p_reason TEXT,
  p_request_id UUID,
  p_handed_off_at TIMESTAMPTZ DEFAULT NULL,
  p_task_assignee_membership_id UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  lead_record RECORD;
  created_handoff_id UUID := gen_random_uuid();
  changed_at TIMESTAMPTZ := COALESCE(p_handed_off_at, pg_catalog.statement_timestamp());
  task_assignee UUID := COALESCE(p_task_assignee_membership_id, p_curator_membership_id);
  provenance_snapshot JSONB;
  conversation_snapshot JSONB;
  task_spec RECORD;
  created_task_id UUID;
BEGIN
  -- p_actor_auth_user_id IS NULL means "restored by a migration": no audit rows.
  SELECT lead.client_id, lead.stage_key, lead.source_key, lead.current_owner_membership_id,
    lead.next_action_text, lead.next_action_due_date, lead.workflow_version,
    client.display_name AS client_display_name, gate.gate_state, gate.gate_version
  INTO lead_record
  FROM platform.leads AS lead
  JOIN platform.clients AS client
    ON client.organization_id = lead.organization_id AND client.id = lead.client_id
  LEFT JOIN platform.lead_admissions_gates AS gate
    ON gate.organization_id = lead.organization_id AND gate.lead_id = lead.id
  WHERE lead.organization_id = p_organization_id AND lead.id = p_lead_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE = '42501';
  END IF;
  IF lead_record.gate_version IS NULL THEN
    RAISE EXCEPTION 'sales_register_gate_missing' USING ERRCODE = '22023';
  END IF;
  -- The report record must exist first: 134's AFTER INSERT trigger on the new
  -- 088 row returns when it finds it, and would otherwise write its own.
  IF NOT EXISTS (
    SELECT 1 FROM platform_private.sales_register AS r
    WHERE r.organization_id = p_organization_id AND r.lead_id = p_lead_id
  ) THEN
    RAISE EXCEPTION 'pending_case_handoff_requires_sale_record' USING ERRCODE = '22023';
  END IF;
  -- The case must be this lead's own canonical case.
  PERFORM 1 FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id AND student_case.id = p_student_case_id
    AND student_case.canonical_lead_id = p_lead_id
    AND student_case.canonical_client_id = lead_record.client_id
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pending_case_handoff_case_mismatch' USING ERRCODE = '22023';
  END IF;

  -- The same two bounded snapshots as handoff_lead_to_admissions (088).
  SELECT COALESCE(
    pg_catalog.jsonb_agg(item.payload ORDER BY item.observed_at DESC, item.id DESC),
    '[]'::JSONB
  )
  INTO provenance_snapshot
  FROM (
    SELECT
      provenance.id,
      provenance.observed_at,
      pg_catalog.jsonb_build_object(
        'provenance_id', provenance.id,
        'subject_type', CASE
          WHEN provenance.lead_id IS NOT NULL THEN 'lead'
          ELSE 'client'
        END,
        'source_system', provenance.source_system,
        'evidence_type', provenance.evidence_type,
        'observed_at', provenance.observed_at,
        'imported_at', provenance.imported_at,
        'source_ref', provenance.source_ref
      ) AS payload
    FROM platform.subject_provenance AS provenance
    WHERE provenance.organization_id = p_organization_id
      AND (
        provenance.lead_id = p_lead_id
        OR provenance.client_id = lead_record.client_id
      )
    ORDER BY provenance.observed_at DESC, provenance.id DESC
    LIMIT 50
  ) AS item;

  SELECT COALESCE(
    pg_catalog.jsonb_agg(item.payload ORDER BY item.updated_at DESC, item.id DESC),
    '[]'::JSONB
  )
  INTO conversation_snapshot
  FROM (
    SELECT
      conversation.id,
      conversation.updated_at,
      pg_catalog.jsonb_build_object(
        'conversation_id', conversation.id,
        'subject', conversation.subject,
        'queue', conversation.queue,
        'status', conversation.status,
        'updated_at', conversation.updated_at
      ) AS payload
    FROM platform.communication_conversations AS conversation
    WHERE conversation.organization_id = p_organization_id
      AND (
        conversation.canonical_lead_id = p_lead_id
        OR conversation.canonical_client_id = lead_record.client_id
      )
    ORDER BY conversation.updated_at DESC, conversation.id DESC
    LIMIT 50
  ) AS item;

  INSERT INTO platform.sales_admissions_handoffs (
    id, organization_id, lead_id, client_id, student_case_id, source_key,
    handoff_mode, handoff_state, handoff_source, reason,
    actor_membership_id, actor_profile_id, admissions_owner_membership_id,
    gate_version, gate_state, workflow_version,
    sales_context, client_context, provenance, conversation_links, handed_off_at
  ) VALUES (
    created_handoff_id, p_organization_id, p_lead_id, lead_record.client_id, p_student_case_id,
    'canonical-lead:' || p_lead_id::TEXT,
    'sales_report', 'completed', 'canonical_sales', p_reason,
    p_actor_membership_id, p_actor_profile_id, p_curator_membership_id,
    lead_record.gate_version, lead_record.gate_state, lead_record.workflow_version,
    pg_catalog.jsonb_build_object(
      'lead_id', p_lead_id,
      'stage_key', lead_record.stage_key,
      'source_key', lead_record.source_key,
      'current_owner_membership_id', lead_record.current_owner_membership_id,
      'next_action_text', lead_record.next_action_text,
      'next_action_due_date', lead_record.next_action_due_date,
      'workflow_version', lead_record.workflow_version
    ),
    pg_catalog.jsonb_build_object(
      'client_id', lead_record.client_id,
      'display_name', lead_record.client_display_name
    ),
    provenance_snapshot, conversation_snapshot, changed_at
  );

  FOR task_spec IN
    SELECT *
    FROM (
      VALUES
        ('u6.sales-context-review'::TEXT, 'Проверить унаследованный контекст Sales'::TEXT,
          'high'::platform.case_task_priority),
        ('u6.study-route-confirmation', 'Подтвердить маршрут обучения и недостающие данные',
          'normal'),
        ('u6.document-request-plan', 'Подготовить первичный план запроса документов',
          'normal')
    ) AS starter(source_key, title, priority)
  LOOP
    created_task_id := gen_random_uuid();
    INSERT INTO platform.case_tasks (
      id, organization_id, student_case_id, task_type, title, assignee_membership_id,
      priority, due_at, status, student_visible, created_by_membership_id, source_key
    ) VALUES (
      created_task_id, p_organization_id, p_student_case_id, 'admissions_starter', task_spec.title,
      task_assignee, task_spec.priority, NULL, 'open', FALSE, p_actor_membership_id,
      task_spec.source_key
    )
    ON CONFLICT (organization_id, student_case_id, source_key) WHERE source_key IS NOT NULL DO NOTHING;
    -- A starter task that already exists is kept as it is: no second task, no event.
    CONTINUE WHEN NOT FOUND;

    INSERT INTO platform.case_task_events (
      organization_id, case_task_id, student_case_id, previous_status, new_status,
      previous_assignee_membership_id, new_assignee_membership_id, actor_membership_id, request_id
    ) VALUES (
      p_organization_id, created_task_id, p_student_case_id, NULL, 'open',
      NULL, task_assignee, p_actor_membership_id,
      public.uuid_generate_v5(p_request_id, 'sales-report:starter-task-event:' || task_spec.source_key)
    );

    IF p_actor_auth_user_id IS NOT NULL THEN
      INSERT INTO platform.audit_events (
        organization_id, actor_kind, actor_profile_id, actor_principal, action, resource_type,
        resource_id, before_state, after_state, reason, request_id, actor_membership_id
      ) VALUES (
        p_organization_id, 'user', p_actor_profile_id, 'auth:' || p_actor_auth_user_id::TEXT,
        'task.create', 'case_task', created_task_id, NULL,
        pg_catalog.jsonb_build_object(
          'student_case_id', p_student_case_id,
          'source_key', task_spec.source_key,
          'title', task_spec.title,
          'assignee_membership_id', task_assignee,
          'status', 'open'
        ),
        'U6 Admissions starter task',
        public.uuid_generate_v5(p_request_id, 'sales-report:starter-task-audit:' || task_spec.source_key),
        p_actor_membership_id
      );
    END IF;
  END LOOP;

  IF p_actor_auth_user_id IS NOT NULL THEN
    INSERT INTO platform.audit_events (
      organization_id, actor_kind, actor_profile_id, actor_principal, action, resource_type,
      resource_id, before_state, after_state, reason, request_id, actor_membership_id,
      resulting_version
    ) VALUES (
      p_organization_id, 'user', p_actor_profile_id, 'auth:' || p_actor_auth_user_id::TEXT,
      'lead.admissions.handoff.completed', 'student_case', p_student_case_id, NULL,
      pg_catalog.jsonb_build_object(
        'lead_id', p_lead_id,
        'client_id', lead_record.client_id,
        'student_case_id', p_student_case_id,
        'admissions_owner_membership_id', p_curator_membership_id,
        'handoff_mode', 'sales_report',
        'handoff_state', 'completed',
        'gate_state', lead_record.gate_state,
        'gate_version', lead_record.gate_version,
        'starter_task_count', 3,
        'created_case', FALSE
      ),
      p_reason,
      public.uuid_generate_v5(p_request_id, 'sales-report:handoff-completed-audit'),
      p_actor_membership_id, lead_record.gate_version
    );
  END IF;

  RETURN created_handoff_id;
END
$$;

-- ---------------------------------------------------------------------------
-- c) The backfill function (idempotent; also what the migration calls once)
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.restore_pending_case_sales_handoffs()
RETURNS INTEGER
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  candidate RECORD;
  restored INTEGER := 0;
BEGIN
  -- Same proof of the 208 pending-case path as platform_private.sales_lead_handoffs
  -- (247): the pipeline record's activation snapshot AND its immutable create receipt.
  FOR candidate IN
    SELECT r.organization_id, r.lead_id, c.id AS student_case_id, request.request_id,
      c.current_curator_membership_id AS case_curator_membership_id,
      request.created_at AS handed_off_at, request.actor_membership_id,
      actor_membership.profile_id AS actor_profile_id,
      (request.receipt->>'curator_membership_id')::UUID AS curator_membership_id
    FROM platform_private.sales_register AS r
    JOIN platform.student_cases AS c
      ON c.organization_id = r.organization_id AND c.canonical_lead_id = r.lead_id
      AND c.canonical_client_id = r.client_id AND c.id::TEXT = r.source_snapshot->>'student_case_id'
    JOIN platform_private.sales_report_handoff_requests AS request
      ON request.organization_id = r.organization_id
      AND request.receipt->>'organization_id' = r.organization_id::TEXT
      AND request.receipt->>'operation' = 'create'
      AND request.receipt->>'record_id' = r.id::TEXT
      AND request.receipt->>'student_case_id' = c.id::TEXT
      AND request.receipt->>'request_id' = request.request_id::TEXT
    JOIN platform.organization_memberships AS actor_membership
      ON actor_membership.organization_id = request.organization_id
      AND actor_membership.id = request.actor_membership_id
    WHERE r.source_kind = 'pipeline' AND r.source_snapshot->>'activation' = 'pending_case'
      AND NOT EXISTS (
        SELECT 1 FROM platform.sales_admissions_handoffs AS h
        WHERE h.organization_id = r.organization_id
          AND (h.student_case_id = c.id OR h.lead_id = r.lead_id)
      )
    ORDER BY request.created_at, request.request_id
  LOOP
    -- The same lead lock the sale command takes, then the proof again: a
    -- concurrent restore or sale cannot make this write a second row.
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      candidate.organization_id::TEXT || ':u6:' || candidate.lead_id::TEXT, 0));
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM platform.sales_admissions_handoffs AS h
      WHERE h.organization_id = candidate.organization_id
        AND (h.student_case_id = candidate.student_case_id OR h.lead_id = candidate.lead_id)
    );
    PERFORM platform_private.record_pending_case_sales_handoff(
      candidate.organization_id, candidate.lead_id, candidate.student_case_id,
      candidate.actor_membership_id, candidate.actor_profile_id, NULL,
      candidate.curator_membership_id,
      'Sale saved from the report; handoff record restored by migration 258',
      candidate.request_id, candidate.handed_off_at, candidate.case_curator_membership_id);
    restored := restored + 1;
  END LOOP;
  RETURN restored;
END
$$;

REVOKE ALL ON FUNCTION
  platform_private.record_pending_case_sales_handoff(UUID, UUID, UUID, UUID, UUID, UUID, UUID, TEXT, UUID, TIMESTAMPTZ, UUID),
  platform_private.restore_pending_case_sales_handoffs()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- b) platform.create_sales_report_handoff: one call after the report record
-- ---------------------------------------------------------------------------
-- Self-verifying anchor replace on the LIVE definition (pg_get_functiondef):
-- the body must be exactly 215's (md5 verified read-only against production on
-- 2026-10-01), the anchor must occur exactly once, and the result must be
-- exactly the old body with that one replacement, with every attribute (owner,
-- SECURITY DEFINER, search_path, ACL) unchanged.
DO $a258_patch$
DECLARE
  signature CONSTANT TEXT := 'platform.create_sales_report_handoff(uuid,uuid,uuid,uuid,date)';
  old_anchor CONSTANT TEXT := $old$      RETURNING * INTO sale;
  ELSE
    SELECT g.gate_version INTO selected_gate_version FROM platform.lead_admissions_gates g
$old$;
  new_anchor CONSTANT TEXT := $new$      RETURNING * INTO sale;
    -- 258 (issue #1075): the completed 088 handoff, starter tasks and audit that
    -- handoff_lead_to_admissions writes, so 182's respond_student_case_handoff can
    -- record the curator's answer. The report record above exists first: 134's
    -- AFTER INSERT trigger on the new 088 row finds it and writes no second one.
    PERFORM platform_private.record_pending_case_sales_handoff(p_organization_id,p_lead_id,case_id,
      actor.membership_id,actor.profile_id,actor.auth_user_id,p_curator_membership_id,command_reason,p_request_id);
  ELSE
    SELECT g.gate_version INTO selected_gate_version FROM platform.lead_admissions_gates g
$new$;
  target_oid OID;
  old_source TEXT;
  new_source TEXT;
  definition TEXT;
  old_attributes JSONB;
  new_attributes JSONB;
BEGIN
  target_oid := signature::pg_catalog.regprocedure;
  SELECT p.prosrc, pg_catalog.to_jsonb(p) - 'prosrc'
    INTO STRICT old_source, old_attributes
    FROM pg_catalog.pg_proc p WHERE p.oid = target_oid;
  IF pg_catalog.md5(old_source) <> 'efa824316e4ca3675c2cb2e9331db74c' THEN
    RAISE EXCEPTION 'a258_create_sales_report_handoff_body_drift: not the 215 definition';
  END IF;
  definition := pg_catalog.pg_get_functiondef(target_oid);
  IF (pg_catalog.length(definition) - pg_catalog.length(pg_catalog.replace(definition, old_anchor, '')))
       / pg_catalog.length(old_anchor) <> 1
    OR pg_catalog.strpos(definition, new_anchor) <> 0 THEN
    RAISE EXCEPTION 'a258_create_sales_report_handoff_anchor_drift';
  END IF;
  EXECUTE pg_catalog.replace(definition, old_anchor, new_anchor);
  SELECT p.prosrc, pg_catalog.to_jsonb(p) - 'prosrc'
    INTO STRICT new_source, new_attributes
    FROM pg_catalog.pg_proc p WHERE p.oid = target_oid;
  IF new_source IS DISTINCT FROM pg_catalog.replace(old_source, old_anchor, new_anchor)
    OR pg_catalog.md5(new_source) <> '2151ceb8f28993beefb471af86af5a0a'
    OR new_attributes IS DISTINCT FROM old_attributes THEN
    RAISE EXCEPTION 'a258_create_sales_report_handoff_verification_failed: body or attributes';
  END IF;
END
$a258_patch$;

-- ---------------------------------------------------------------------------
-- c) The backfill, once; a second pass in the same transaction must find nothing
-- ---------------------------------------------------------------------------
DO $a258_backfill$
DECLARE restored INTEGER;
BEGIN
  restored := platform_private.restore_pending_case_sales_handoffs();
  RAISE NOTICE 'a258: restored % pending-case sales handoff(s)', restored;
  IF platform_private.restore_pending_case_sales_handoffs() <> 0 THEN
    RAISE EXCEPTION 'a258_pending_case_handoff_backfill_not_idempotent';
  END IF;
END
$a258_backfill$;

DO $a258_verify$
DECLARE
  fn REGPROCEDURE;
  client_role TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'platform_private.record_pending_case_sales_handoff(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,timestamptz,uuid)'::REGPROCEDURE,
    'platform_private.restore_pending_case_sales_handoffs()'::REGPROCEDURE
  ] LOOP
    IF NOT (SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""'] AND pg_get_userbyid(p.proowner) = 'postgres'
        FROM pg_proc p WHERE p.oid = fn) THEN
      RAISE EXCEPTION 'a258_verification_failed: % must be SECURITY DEFINER, empty search_path, owner postgres', fn;
    END IF;
    FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'supabase_auth_admin'] LOOP
      IF has_function_privilege(client_role, fn, 'EXECUTE') THEN
        RAISE EXCEPTION 'a258_verification_failed: % is executable by %', fn, client_role;
      END IF;
    END LOOP;
  END LOOP;
  -- The released command keeps its ACL: authenticated only.
  fn := 'platform.create_sales_report_handoff(uuid,uuid,uuid,uuid,date)'::REGPROCEDURE;
  IF NOT has_function_privilege('authenticated', fn, 'EXECUTE')
    OR has_function_privilege('anon', fn, 'EXECUTE')
    OR has_function_privilege('service_role', fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'a258_verification_failed: create_sales_report_handoff grants changed';
  END IF;
END
$a258_verify$;

NOTIFY pgrst, 'reload schema';
COMMIT;
