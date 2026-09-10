\set ON_ERROR_STOP on
-- Isolated SQL authorization fixtures only; the entire scenario rolls back.
-- No Auth invitation, real customer, financial event or provider action.
BEGIN;
CREATE FUNCTION pg_temp.u147_entry_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('59947000-0000-4000-8000-'||lpad(n::TEXT,12,'0'))::UUID
$$;
CREATE FUNCTION pg_temp.u147_entry_assert(ok BOOLEAN,message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
  BEGIN IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'U143/U147: %',message; END IF; END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.u147_entry_id(INTEGER),pg_temp.u147_entry_assert(BOOLEAN,TEXT) TO authenticated;
CREATE TEMP TABLE u147_entry_actors(n INTEGER,role platform.business_role,claims TEXT);
INSERT INTO u147_entry_actors VALUES(1,'admin',NULL),(2,'sales',NULL);
INSERT INTO platform.organizations(id,name) VALUES(pg_temp.u147_entry_id(1),'U143/U147 isolated SQL fixture');
INSERT INTO auth.users(id,email,raw_user_meta_data)
  SELECT pg_temp.u147_entry_id(100+n),'u147-entry-'||n||'@example.invalid','{}'::JSONB FROM u147_entry_actors;
INSERT INTO platform.profiles(id,auth_user_id,display_name,status,access_version)
  SELECT pg_temp.u147_entry_id(200+n),pg_temp.u147_entry_id(100+n),'U147 entry actor '||n,'active',1 FROM u147_entry_actors;
INSERT INTO platform.organization_memberships(id,organization_id,profile_id,status,"current_role",current_bundle_id)
  SELECT pg_temp.u147_entry_id(300+n),pg_temp.u147_entry_id(1),pg_temp.u147_entry_id(200+n),'active',a.role,
    (SELECT id FROM platform.role_bundle_versions WHERE role=a.role AND status='published' ORDER BY version DESC LIMIT 1)
  FROM u147_entry_actors a;
INSERT INTO platform.record_scopes(id,organization_id,scope_kind,scope_key,scope_version)
  VALUES(pg_temp.u147_entry_id(401),pg_temp.u147_entry_id(1),'organization',pg_temp.u147_entry_id(1),1);
INSERT INTO platform.membership_scope_assignments(organization_id,membership_id,scope_id,scope_version,assignment_version,granted,actor_kind,reason,request_id)
  SELECT pg_temp.u147_entry_id(1),pg_temp.u147_entry_id(300+n),pg_temp.u147_entry_id(401),1,1,TRUE,'system',
    'U143/U147 synthetic scope',pg_temp.u147_entry_id(600+n) FROM u147_entry_actors;
UPDATE u147_entry_actors actor SET claims=jsonb_build_object('sub',profile.auth_user_id,'role','authenticated',
  'platform_role',actor.role,'platform_access_version',profile.access_version,'platform_organization_id',membership.organization_id,
  'platform_membership_id',membership.id,'platform_bundle_id',bundle.id,'platform_bundle_version',bundle.version)::TEXT
  FROM platform.profiles profile JOIN platform.organization_memberships membership ON membership.profile_id=profile.id
    JOIN platform.role_bundle_versions bundle ON bundle.id=membership.current_bundle_id
  WHERE profile.id=pg_temp.u147_entry_id(200+actor.n);
SELECT claims AS u147_entry_claims FROM u147_entry_actors WHERE n=1 \gset
SET LOCAL request.jwt.claims TO :'u147_entry_claims';
SET LOCAL ROLE authenticated;

SELECT platform.create_manual_sales_lead(pg_temp.u147_entry_id(1),pg_temp.u147_entry_id(801),
  'U143 synthetic applicant',NULL,'u143-applicant@example.invalid','office',pg_temp.u147_entry_id(302),
  'CN','Confirm next step',DATE '2026-10-01')::TEXT AS u147_entry_lead_receipt \gset
SELECT (:'u147_entry_lead_receipt'::JSONB->>'lead_id') AS u147_entry_lead \gset
SELECT pg_temp.u147_entry_assert(:'u147_entry_lead_receipt'::JSONB->>'status'='saved','manual lead saved');
SELECT pg_temp.u147_entry_assert(platform.create_manual_sales_lead(pg_temp.u147_entry_id(1),pg_temp.u147_entry_id(801),
  'U143 synthetic applicant',NULL,'u143-applicant@example.invalid','office',pg_temp.u147_entry_id(302),
  'CN','Confirm next step',DATE '2026-10-01')=:'u147_entry_lead_receipt'::JSONB,'exact manual creation replay is stable');
SELECT platform.create_manual_sales_lead(pg_temp.u147_entry_id(1),pg_temp.u147_entry_id(802),
  'U143 duplicate submission',NULL,'u143-applicant@example.invalid','office',pg_temp.u147_entry_id(302))::TEXT AS u147_entry_duplicate \gset
SELECT pg_temp.u147_entry_assert(:'u147_entry_duplicate'::JSONB->>'status'='duplicate'
  AND :'u147_entry_duplicate'::JSONB->>'lead_id'=:'u147_entry_lead','same contact returns the existing visible lead');
SELECT platform.staff_task_lead_context(pg_temp.u147_entry_id(1),:'u147_entry_lead')::TEXT AS u147_entry_lead_context \gset
SELECT (:'u147_entry_lead_context'::JSONB->>'workflow_version') AS u147_entry_lead_version \gset
SELECT pg_temp.u147_entry_assert(:'u147_entry_lead_context'::JSONB->>'next_action'='Confirm next step','canonical next action retained');

SELECT platform.create_staff_task_from_lead(pg_temp.u147_entry_id(1),pg_temp.u147_entry_id(803),:'u147_entry_lead',
  :'u147_entry_lead_version','U147 linked follow-up',pg_temp.u147_entry_id(302))::TEXT AS u147_entry_task_receipt \gset
SELECT (:'u147_entry_task_receipt'::JSONB->>'staff_task_id') AS u147_entry_task \gset
SELECT pg_temp.u147_entry_assert(platform.create_staff_task_from_lead(pg_temp.u147_entry_id(1),pg_temp.u147_entry_id(803),
  :'u147_entry_lead',:'u147_entry_lead_version','U147 linked follow-up',pg_temp.u147_entry_id(302))=:'u147_entry_task_receipt'::JSONB,
  'exact linked-task creation replay is stable');
SELECT platform.complete_staff_task_with_result(pg_temp.u147_entry_id(1),pg_temp.u147_entry_id(804),:'u147_entry_task',
  (:'u147_entry_task_receipt'::JSONB->>'version')::BIGINT,'U147 work completed; next action remains separate')::TEXT AS u147_entry_completion \gset
SELECT pg_temp.u147_entry_assert(platform.complete_staff_task_with_result(pg_temp.u147_entry_id(1),pg_temp.u147_entry_id(804),
  :'u147_entry_task',(:'u147_entry_task_receipt'::JSONB->>'version')::BIGINT,'U147 work completed; next action remains separate')=:'u147_entry_completion'::JSONB,
  'exact completion replay is stable');
SELECT platform.staff_task_context(pg_temp.u147_entry_id(1),:'u147_entry_task')::TEXT AS u147_entry_context \gset
SELECT pg_temp.u147_entry_assert(:'u147_entry_context'::JSONB->>'lead_id'=:'u147_entry_lead'
  AND jsonb_array_length(:'u147_entry_context'::JSONB->'outcomes')=1
  AND :'u147_entry_context'::JSONB#>>'{outcomes,0,note}'='U147 work completed; next action remains separate',
  'task context contains the linked lead and exactly one completion result');
SELECT pg_temp.u147_entry_assert(platform.lead_staff_task_links(pg_temp.u147_entry_id(1),:'u147_entry_lead')#>>'{0,status}'='done',
  'lead task projection reflects completion');
SELECT pg_temp.u147_entry_assert(platform.staff_task_lead_context(pg_temp.u147_entry_id(1),:'u147_entry_lead')=:'u147_entry_lead_context'::JSONB,
  'task completion never mutates the canonical lead workflow');
RESET ROLE;
SELECT pg_temp.u147_entry_assert((SELECT count(*)=1 AND bool_and(stage_key='new') FROM platform.leads WHERE organization_id=pg_temp.u147_entry_id(1)),
  'one canonical new-stage lead remains after replay and contact duplicate');
SELECT pg_temp.u147_entry_assert((SELECT count(*)=1 FROM platform_private.manual_lead_receipts WHERE organization_id=pg_temp.u147_entry_id(1)),
  'manual receipt is recorded exactly once');
SELECT pg_temp.u147_entry_assert((SELECT count(*)=1 AND bool_and(status='done' AND version=2) FROM platform.staff_tasks WHERE organization_id=pg_temp.u147_entry_id(1)),
  'one canonical task is completed at version two');
SELECT pg_temp.u147_entry_assert((SELECT count(*)=2 FROM platform_private.staff_task_receipts WHERE organization_id=pg_temp.u147_entry_id(1)),
  'create and complete have exactly two underlying task receipts');
SELECT pg_temp.u147_entry_assert((SELECT count(*)=1 FROM platform_private.staff_task_outcomes WHERE organization_id=pg_temp.u147_entry_id(1)),
  'completion replay creates no duplicate outcome');
ROLLBACK;
