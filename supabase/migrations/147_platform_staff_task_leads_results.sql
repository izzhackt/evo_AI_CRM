-- O4: task provenance and completion evidence extend canonical staff tasks.
-- Existing status/edit commands remain canonical; no sales stage is changed here.
BEGIN;

CREATE TABLE platform_private.staff_lead_task_links (
  request_id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  actor_membership_id UUID NOT NULL,
  staff_task_id UUID NOT NULL,
  lead_id UUID NOT NULL,
  input JSONB NOT NULL,
  result JSONB NOT NULL,
  UNIQUE (organization_id, staff_task_id),
  FOREIGN KEY (organization_id, staff_task_id) REFERENCES platform.staff_tasks(organization_id,id),
  FOREIGN KEY (organization_id, lead_id) REFERENCES platform.leads(organization_id,id),
  FOREIGN KEY (organization_id, actor_membership_id) REFERENCES platform.organization_memberships(organization_id,id)
);
CREATE INDEX staff_lead_task_links_lead_idx ON platform_private.staff_lead_task_links(organization_id,lead_id);
CREATE INDEX staff_lead_task_links_actor_idx ON platform_private.staff_lead_task_links(organization_id,actor_membership_id);
CREATE TABLE platform_private.staff_task_outcomes (
  request_id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  staff_task_id UUID NOT NULL,
  task_version BIGINT NOT NULL,
  actor_membership_id UUID NOT NULL,
  note TEXT NOT NULL CHECK (char_length(btrim(note)) BETWEEN 1 AND 4000
    AND regexp_replace(note,E'[\n\r\t]','','g') !~ '[[:cntrl:]]'),
  input JSONB NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (organization_id,staff_task_id,task_version)
    REFERENCES platform.staff_task_events(organization_id,staff_task_id,version),
  FOREIGN KEY (organization_id,actor_membership_id)
    REFERENCES platform.organization_memberships(organization_id,id)
);
CREATE INDEX staff_task_outcomes_task_idx ON platform_private.staff_task_outcomes(organization_id,staff_task_id,task_version DESC);
CREATE INDEX staff_task_outcomes_actor_idx ON platform_private.staff_task_outcomes(organization_id,actor_membership_id);
ALTER TABLE platform_private.staff_lead_task_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.staff_lead_task_links FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.staff_task_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.staff_task_outcomes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform_private.staff_lead_task_links,platform_private.staff_task_outcomes FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER staff_lead_task_links_append_only BEFORE UPDATE OR DELETE ON platform_private.staff_lead_task_links
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER staff_task_outcomes_append_only BEFORE UPDATE OR DELETE ON platform_private.staff_task_outcomes
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE FUNCTION platform.create_staff_task_from_lead(
  p_organization_id UUID,p_request_id UUID,p_lead_id UUID,p_lead_version BIGINT,
  p_title TEXT,p_assignee_membership_id UUID,p_description TEXT DEFAULT NULL,
  p_priority platform.case_task_priority DEFAULT 'normal',p_due_on DATE DEFAULT NULL,p_due_at TIMESTAMPTZ DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor RECORD; lead_row platform.leads%ROWTYPE; prior platform_private.staff_lead_task_links%ROWTYPE;
  payload JSONB; receipt JSONB; task_id UUID;
BEGIN
  SELECT * INTO actor FROM platform.current_actor_authority() a
    WHERE a.organization_id=p_organization_id AND a.platform_role IN ('admin','sales','curator');
  IF NOT FOUND THEN RAISE EXCEPTION 'staff_task_source_forbidden' USING ERRCODE='42501'; END IF;
  IF p_request_id IS NULL OR p_lead_id IS NULL OR p_lead_version IS NULL OR p_lead_version<1
  THEN RAISE EXCEPTION 'staff_task_source_invalid' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('staff-task:'||p_request_id::TEXT,0));
  SELECT * INTO lead_row FROM platform.leads l
    WHERE l.organization_id=p_organization_id AND l.id=p_lead_id FOR SHARE;
  IF NOT FOUND OR NOT private.platform_can_read_canonical_lead(p_organization_id,p_lead_id)
  THEN RAISE EXCEPTION 'staff_task_source_forbidden' USING ERRCODE='42501'; END IF;
  payload:=jsonb_build_object('lead_id',p_lead_id,'lead_version',p_lead_version::TEXT,
    'title',btrim(p_title),'assignee_membership_id',p_assignee_membership_id,
    'description',NULLIF(btrim(p_description),''),'priority',p_priority,'due_on',p_due_on,'due_at',p_due_at);
  SELECT * INTO prior FROM platform_private.staff_lead_task_links WHERE request_id=p_request_id;
  IF FOUND THEN
    IF prior.organization_id IS DISTINCT FROM p_organization_id OR prior.actor_membership_id IS DISTINCT FROM actor.membership_id
      OR prior.input IS DISTINCT FROM payload
    THEN RAISE EXCEPTION 'staff_task_request_id_conflict' USING ERRCODE='23505'; END IF;
    IF NOT EXISTS(SELECT 1 FROM platform.staff_tasks t WHERE t.organization_id=p_organization_id AND t.id=prior.staff_task_id
      AND (actor.platform_role='admin' OR actor.membership_id IN(t.creator_membership_id,t.assignee_membership_id)))
    THEN RAISE EXCEPTION 'staff_task_source_forbidden' USING ERRCODE='42501'; END IF;
    RETURN prior.result;
  END IF;
  IF EXISTS(SELECT 1 FROM platform_private.staff_task_receipts WHERE request_id=p_request_id)
  THEN RAISE EXCEPTION 'staff_task_request_id_conflict' USING ERRCODE='23505'; END IF;
  IF lead_row.workflow_version<>p_lead_version
  THEN RAISE EXCEPTION 'staff_task_source_changed' USING ERRCODE='PT409'; END IF;
  receipt:=platform.mutate_staff_task(p_organization_id,'create',p_request_id,0,NULL,p_title,
    p_assignee_membership_id,p_description,'open',p_priority,p_due_on,p_due_at);
  task_id:=(receipt->>'staff_task_id')::UUID;
  INSERT INTO platform_private.staff_lead_task_links VALUES
    (p_request_id,p_organization_id,actor.membership_id,task_id,p_lead_id,payload,receipt);
  RETURN receipt;
END $$;

CREATE FUNCTION platform.complete_staff_task_with_result(
  p_organization_id UUID,p_request_id UUID,p_staff_task_id UUID,p_expected_version BIGINT,p_note TEXT
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor RECORD; prior platform_private.staff_task_outcomes%ROWTYPE; payload JSONB; receipt JSONB;
BEGIN
  SELECT * INTO actor FROM platform.current_actor_authority() a
    WHERE a.organization_id=p_organization_id AND a.platform_role IN('admin','sales','curator');
  IF NOT FOUND THEN RAISE EXCEPTION 'staff_task_forbidden' USING ERRCODE='42501'; END IF;
  IF p_request_id IS NULL OR p_staff_task_id IS NULL OR p_expected_version IS NULL OR p_expected_version<1
    OR p_note IS NULL OR char_length(btrim(p_note)) NOT BETWEEN 1 AND 4000
    OR regexp_replace(p_note,E'[\n\r\t]','','g') ~ '[[:cntrl:]]'
  THEN RAISE EXCEPTION 'staff_task_invalid' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('staff-task:'||p_request_id::TEXT,0));
  PERFORM 1 FROM platform.staff_tasks t WHERE t.organization_id=p_organization_id AND t.id=p_staff_task_id
    AND (actor.platform_role='admin' OR actor.membership_id IN(t.creator_membership_id,t.assignee_membership_id));
  IF NOT FOUND THEN RAISE EXCEPTION 'staff_task_forbidden' USING ERRCODE='42501'; END IF;
  payload:=jsonb_build_object('task_id',p_staff_task_id,'expected_version',p_expected_version::TEXT,'note',btrim(p_note));
  SELECT * INTO prior FROM platform_private.staff_task_outcomes WHERE request_id=p_request_id;
  IF FOUND THEN
    IF prior.organization_id IS DISTINCT FROM p_organization_id OR prior.actor_membership_id IS DISTINCT FROM actor.membership_id
      OR prior.input IS DISTINCT FROM payload
    THEN RAISE EXCEPTION 'staff_task_request_id_conflict' USING ERRCODE='23505'; END IF;
    RETURN prior.result;
  END IF;
  IF EXISTS(SELECT 1 FROM platform_private.staff_task_receipts WHERE request_id=p_request_id)
  THEN RAISE EXCEPTION 'staff_task_request_id_conflict' USING ERRCODE='23505'; END IF;
  receipt:=platform.mutate_staff_task(p_organization_id,'status',p_request_id,p_expected_version,
    p_staff_task_id,NULL,NULL,NULL,'done',NULL,NULL,NULL);
  INSERT INTO platform_private.staff_task_outcomes(request_id,organization_id,staff_task_id,task_version,
    actor_membership_id,note,input,result)
    VALUES(p_request_id,p_organization_id,p_staff_task_id,(receipt->>'version')::BIGINT,actor.membership_id,btrim(p_note),payload,receipt);
  RETURN receipt;
END $$;

CREATE FUNCTION platform.staff_task_context(p_organization_id UUID,p_task_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor RECORD; source UUID; outcomes JSONB;
BEGIN
  SELECT * INTO actor FROM platform.current_actor_authority() a
    WHERE a.organization_id=p_organization_id AND a.platform_role IN('admin','sales','curator');
  IF NOT FOUND THEN RAISE EXCEPTION 'staff_task_forbidden' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM platform.staff_tasks t WHERE t.organization_id=p_organization_id AND t.id=p_task_id
    AND (actor.platform_role='admin' OR actor.membership_id IN(t.creator_membership_id,t.assignee_membership_id)))
  THEN RAISE EXCEPTION 'staff_task_forbidden' USING ERRCODE='42501'; END IF;
  SELECT l.lead_id INTO source FROM platform_private.staff_lead_task_links l
    WHERE l.organization_id=p_organization_id AND l.staff_task_id=p_task_id
      AND private.platform_can_read_canonical_lead(p_organization_id,l.lead_id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('request_id',o.request_id,'version',o.task_version::TEXT,
    'note',o.note,'created_at',o.created_at,'author',p.display_name) ORDER BY o.task_version DESC),'[]') INTO outcomes
  FROM (SELECT * FROM platform_private.staff_task_outcomes n WHERE n.organization_id=p_organization_id
    AND n.staff_task_id=p_task_id ORDER BY n.task_version DESC LIMIT 30) o
    JOIN platform.organization_memberships m ON m.organization_id=o.organization_id AND m.id=o.actor_membership_id
    JOIN platform.profiles p ON p.id=m.profile_id;
  RETURN jsonb_build_object('lead_id',source,'outcomes',outcomes,'outcomes_truncated',
    (SELECT count(*)>30 FROM platform_private.staff_task_outcomes n WHERE n.organization_id=p_organization_id AND n.staff_task_id=p_task_id));
END $$;

CREATE FUNCTION platform.staff_task_lead_context(p_organization_id UUID,p_lead_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor RECORD; result JSONB;
BEGIN
  SELECT * INTO actor FROM platform.current_actor_authority() a
    WHERE a.organization_id=p_organization_id AND a.platform_role IN('admin','sales','curator');
  IF NOT FOUND OR NOT private.platform_can_read_canonical_lead(p_organization_id,p_lead_id)
  THEN RAISE EXCEPTION 'staff_task_source_forbidden' USING ERRCODE='42501'; END IF;
  SELECT jsonb_build_object('lead_id',l.id,'client_name',coalesce(c.display_name,'Имя клиента не указано'),'workflow_version',l.workflow_version::TEXT,
    'next_action',l.next_action_text,'next_action_due_date',l.next_action_due_date,
    'can_open_pipeline',actor.platform_role IN('admin','sales') AND l.lifecycle_state='open') INTO result
  FROM platform.leads l LEFT JOIN platform.clients c ON c.organization_id=l.organization_id AND c.id=l.client_id
  WHERE l.organization_id=p_organization_id AND l.id=p_lead_id;
  IF result IS NULL THEN RAISE EXCEPTION 'staff_task_source_forbidden' USING ERRCODE='42501'; END IF;
  RETURN result;
END $$;

CREATE FUNCTION platform.lead_staff_task_links(p_organization_id UUID,p_lead_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor RECORD; result JSONB;
BEGIN
  SELECT * INTO actor FROM platform.current_actor_authority() a
    WHERE a.organization_id=p_organization_id AND a.platform_role IN('admin','sales','curator');
  IF NOT FOUND OR NOT private.platform_can_read_canonical_lead(p_organization_id,p_lead_id)
  THEN RAISE EXCEPTION 'staff_task_source_forbidden' USING ERRCODE='42501'; END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.updated_at DESC,q.id DESC),'[]') INTO result FROM (
    SELECT t.id,t.title,t.status,t.updated_at FROM platform_private.staff_lead_task_links l
    JOIN platform.staff_tasks t ON t.organization_id=l.organization_id AND t.id=l.staff_task_id
    WHERE l.organization_id=p_organization_id AND l.lead_id=p_lead_id
      AND (actor.platform_role='admin' OR actor.membership_id IN(t.creator_membership_id,t.assignee_membership_id))
    ORDER BY t.updated_at DESC,t.id DESC LIMIT 51
  ) q;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION platform.create_staff_task_from_lead(UUID,UUID,UUID,BIGINT,TEXT,UUID,TEXT,platform.case_task_priority,DATE,TIMESTAMPTZ),
  platform.complete_staff_task_with_result(UUID,UUID,UUID,BIGINT,TEXT),platform.staff_task_context(UUID,UUID),
  platform.lead_staff_task_links(UUID,UUID),platform.staff_task_lead_context(UUID,UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION platform.create_staff_task_from_lead(UUID,UUID,UUID,BIGINT,TEXT,UUID,TEXT,platform.case_task_priority,DATE,TIMESTAMPTZ),
  platform.complete_staff_task_with_result(UUID,UUID,UUID,BIGINT,TEXT),platform.staff_task_context(UUID,UUID),
  platform.lead_staff_task_links(UUID,UUID),platform.staff_task_lead_context(UUID,UUID) TO authenticated;
COMMIT;
