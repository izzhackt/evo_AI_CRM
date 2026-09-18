-- Shared business roles; no people, credentials, assignments or historical sales.
-- Owner-approved contract: docs/design/v3/staff-sales-handoff-run-plan.md.
-- Published assignments already advance together in staff_role_publish (155).
-- Keep replacements atomic and preserve function identity/EXECUTE grants:
-- https://www.postgresql.org/docs/current/tutorial-transactions.html
-- https://www.postgresql.org/docs/current/sql-createfunction.html
BEGIN;

ALTER TABLE platform.permission_definitions DISABLE TRIGGER permission_definitions_append_only_rows;
UPDATE platform.permission_definitions SET
 staff_sensitive=FALSE,staff_system_only=FALSE,
 staff_scope_kinds=ARRAY['own','organization','department','direction','record'],
 staff_resource_kinds=ARRAY['lead','student_case','finance_record'],
 staff_label=CASE permission_key
  WHEN 'contract.evidence.confirm' THEN 'Подтверждение договора'
  WHEN 'finance.first.payment.confirm' THEN 'Подтверждение первого платежа'
  ELSE 'Подтверждение платежа' END
WHERE permission_key IN ('contract.evidence.confirm','finance.event.confirm','finance.first.payment.confirm');
ALTER TABLE platform.permission_definitions ENABLE TRIGGER permission_definitions_append_only_rows;

-- Fail closed if a previous migration changed a consumer. CREATE OR REPLACE
-- retains existing grants; the helper itself disappears with the connection.
CREATE FUNCTION pg_temp.evo173_replace(p_signature TEXT,p_old TEXT,p_new TEXT,p_count INTEGER DEFAULT 1)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE body TEXT; matches INTEGER;
BEGIN
 body:=pg_get_functiondef(to_regprocedure(p_signature));
 matches:=(length(body)-length(replace(body,p_old,'')))/length(p_old);
 IF body IS NULL OR matches IS DISTINCT FROM p_count THEN
  RAISE EXCEPTION 'staff_business_roles_source_drift: % expected %, found %',p_signature,p_count,matches;
 END IF;
 EXECUTE replace(body,p_old,p_new);
END $$;

-- A confirmation follows the sales owner even after the curator takes over.
-- Other case/resource owners and every Student path remain unchanged.
SELECT pg_temp.evo173_replace(
 'platform_private.staff_resource_context(uuid,text,text,uuid)',
 $$('case.read.summary','document.read.sales','communication.read.summary')$$,
 $$('case.read.summary','document.read.sales','communication.read.summary',
    'contract.evidence.confirm','finance.event.confirm','finance.first.payment.confirm')$$);

CREATE OR REPLACE FUNCTION platform_private.require_case_operator(
 p_organization_id UUID,p_student_case_id UUID,p_permission_key TEXT
) RETURNS TABLE(actor_profile_id UUID,actor_membership_id UUID,actor_auth_user_id UUID,actor_role platform.business_role)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor RECORD;
BEGIN
 SELECT * INTO actor FROM platform_private.require_domain_actor(p_organization_id,p_permission_key);
 IF NOT platform_private.staff_can_access(p_organization_id,actor.actor_membership_id,
   p_permission_key,'student_case',p_student_case_id)
 OR (p_permission_key IN ('contract.evidence.confirm','finance.event.confirm','finance.first.payment.confirm')
   AND NOT platform_private.staff_can_access(p_organization_id,actor.actor_membership_id,
     'case.read.summary','student_case',p_student_case_id))
 OR (p_permission_key='admissions.handoff.gate.override'
   AND NOT platform_private.staff_can_access(p_organization_id,actor.actor_membership_id,
     'case.read.full','student_case',p_student_case_id)) THEN
  RAISE EXCEPTION 'Student case is unavailable' USING ERRCODE='42501';
 END IF;
 RETURN QUERY SELECT actor.actor_profile_id,actor.actor_membership_id,actor.actor_auth_user_id,actor.actor_role;
END $$;

DO $consumers$
DECLARE permission TEXT; signature TEXT; object_alias TEXT;
BEGIN
 -- The gate mutation and read/receipt capabilities must check the selected lead,
 -- not merely possession of a permission somewhere in the organization.
 FOREACH permission IN ARRAY ARRAY['contract.evidence.confirm','finance.first.payment.confirm'] LOOP
  PERFORM pg_temp.evo173_replace(
   'platform.mutate_lead_admissions_gate(uuid,bigint,uuid,text,numeric,text,date,date,text,text)',
   'private.platform_has_permission('||E'\n      actor.organization_id,\n      '||quote_literal(permission)||E'\n    )',
   'platform_private.staff_can_access(actor.organization_id,actor.membership_id,'||quote_literal(permission)||',''lead'',p_lead_id)');
  FOR signature,object_alias IN SELECT * FROM (VALUES
   ('platform.staff_lead_admissions_gate(uuid)','gate'),
   ('platform.mutate_lead_admissions_gate(uuid,bigint,uuid,text,numeric,text,date,date,text,text)','gate_record')
  ) AS consumers(signature,object_alias) LOOP
   PERFORM pg_temp.evo173_replace(signature,
    'private.platform_has_permission('||CASE WHEN object_alias='gate' THEN E'\n      ' ELSE E'\n        ' END||object_alias||'.organization_id,'
     ||CASE WHEN object_alias='gate' THEN E'\n      ' ELSE E'\n        ' END||quote_literal(permission)
     ||CASE WHEN object_alias='gate' THEN E'\n    )' ELSE E'\n      )' END,
    'platform_private.staff_can_access('||object_alias||'.organization_id,actor.membership_id,'||quote_literal(permission)||',''lead'',p_lead_id)');
  END LOOP;
 END LOOP;
 PERFORM pg_temp.evo173_replace('platform.staff_finance_entry_workspace(uuid)',
  $$NOT platform_private.staff_can_access(actor.organization_id, actor.membership_id,
      'case.read.full', 'student_case', p_student_case_id)$$,
  $$NOT (platform_private.staff_can_access(actor.organization_id, actor.membership_id,
      'case.read.full', 'student_case', p_student_case_id)
    OR platform_private.staff_can_access(actor.organization_id, actor.membership_id,
      'finance.event.confirm', 'student_case', p_student_case_id))$$);
 PERFORM pg_temp.evo173_replace('platform.staff_case_finance_control(uuid,integer)',
  $$      platform_private.staff_can_access_for_actor(
        student_case.organization_id, 'finance.read.full', 'student_case', student_case.id
      )$$,
  $$      platform_private.staff_can_access_for_actor(
        student_case.organization_id, 'finance.read.full', 'student_case', student_case.id
      )
      OR platform_private.staff_can_access_for_actor(
        student_case.organization_id, 'finance.event.confirm', 'student_case', student_case.id
      )$$);
 -- Retain the historical ledger, but new personal changes are only for the
 -- protected Admin handoff override. Old contract/payment grants give no rights.
 PERFORM pg_temp.evo173_replace('platform.change_membership_permission(uuid,uuid,text,boolean,text,uuid)',
  $$p_permission_key NOT IN (
      'contract.evidence.confirm',
      'finance.first.payment.confirm',
      'admissions.handoff.gate.override'
    )$$,
  $$p_permission_key <> 'admissions.handoff.gate.override'$$);
END $consumers$;

-- Directory booleans describe effective role authority, not stale personal grants.
CREATE OR REPLACE FUNCTION platform.staff_directory(p_organization_id UUID)
RETURNS TABLE(auth_user_id UUID,profile_id UUID,membership_id UUID,display_name TEXT,
 platform_role platform.business_role,membership_status platform.membership_status,access_version BIGINT,
 contract_confirmation_granted BOOLEAN,first_payment_confirmation_granted BOOLEAN,admissions_gate_override_granted BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM platform_private.require_admin_actor(p_organization_id,'membership.read');
 RETURN QUERY SELECT p.auth_user_id,p.id,m.id,p.display_name,
  CASE WHEN m.is_system_admin THEN 'admin'::platform.business_role
   WHEN m."current_role"='admin' THEN NULL::platform.business_role ELSE m."current_role" END,
  m.status,p.access_version,
  platform_private.staff_has_permission(m.organization_id,m.id,'contract.evidence.confirm'),
  platform_private.staff_has_permission(m.organization_id,m.id,'finance.first.payment.confirm'),
  platform_private.staff_has_permission(m.organization_id,m.id,'admissions.handoff.gate.override')
 FROM platform.organization_memberships m JOIN platform.profiles p ON p.id=m.profile_id
 WHERE m.organization_id=p_organization_id AND m."current_role" IS DISTINCT FROM 'student'
 ORDER BY lower(p.display_name),m.id;
END $$;

-- These are reusable role definitions only. The operator assigns existing real
-- employees after reviewing organization, department and current role versions.
-- Common organization features are separate because a scoped role must bind
-- every permission to the SAME scope. Country responsibilities already live in
-- staff_direction_assignments and never imply access to every country record.
-- Both department heads use their department scope plus the matching common
-- role. Admissions covers all directions through case curators in its department,
-- without reading unrelated Sales leads, conversations or tasks organization-wide.
DO $templates$
DECLARE org RECORD; spec RECORD; role_id UUID; bundle_id UUID; keys TEXT[]; invalid_keys TEXT[]; expected_scope TEXT;
 sales_keys CONSTANT TEXT[]:=ARRAY[
  'lead.read','lead.sales.workflow.manage','client.read','case.read.summary',
  'document.read.sales','finance.read.summary','communication.read.summary',
  'communication.read.full','communication.manual.send',
  'ai.draft.request','ai.draft.review','case.workflow.read','contract.draft.manage',
  'task.create','staff.task.read','staff.task.edit','staff.task.complete',
  'sales.register.read','sales.register.manage'];
 admissions_keys CONSTANT TEXT[]:=ARRAY[
  'lead.read','client.read','case.read.full','case.read.summary','case.lifecycle.change',
  'case.route.manage','case.update.append','case.workflow.read','application.manage','visa.manage',
  'profile.manage','profile.read.full','document.read.full','document.upload','document.download',
  'document.manage','document.review','document.extract','finance.read.summary','finance.stop.create',
  'communication.read.full','communication.manual.send',
  'ai.draft.request','ai.draft.review','task.create','task.manage','task.assign','task.visibility.manage',
  'post.contract.manage','decision.read','decision.manage','notification.create',
  'staff.task.read','staff.task.edit','staff.task.complete'];
 common_keys CONSTANT TEXT[]:=ARRAY['organization.read','catalog.read','contract.template.read',
  'workflow.contract.read','knowledge.read.approved','team.chat.general','staff.task.create','staff.assistant.use'];
BEGIN
 FOR org IN SELECT id FROM platform.organizations WHERE status='active' LOOP
  INSERT INTO platform.staff_departments(organization_id,name,description)
  VALUES(org.id,'Отдел продаж','Продажи и подтверждение договоров и платежей.'),
        (org.id,'Отдел сопровождения','Поступление и сопровождение студентов по направлениям.')
  ON CONFLICT DO NOTHING;
  FOR spec IN SELECT * FROM (VALUES
   ('sales','Sales','Сотрудник продаж: собственные записи.',sales_keys),
   ('sales-manager','Sales Manager','Руководитель: записи отдела продаж, подтверждение договоров и платежей.',
     sales_keys||ARRAY['lead.sales.owner.assign','contract.evidence.confirm','finance.event.confirm','finance.first.payment.confirm']),
   ('sales-common','Продажи — общие разделы','Общие рабочие разделы для Sales и Sales Manager.',
     common_keys||ARRAY['team.chat.sales','reply.snippet.all','reply.snippet.sales','reply.snippet.manage']),
   ('admissions','Admissions','Сотрудник сопровождения: собственные дела; направления задаются отдельно.',admissions_keys),
   ('admissions-manager','Admissions Manager','Руководитель: все направления отдела сопровождения.',
     admissions_keys||ARRAY['case.curator.assign']),
   ('admissions-common','Сопровождение — общие разделы','Общие рабочие разделы сотрудников Admissions.',
     common_keys||ARRAY['team.chat.admissions','reply.snippet.all','reply.snippet.admissions','reply.snippet.manage',
      'company.file.read','company.file.download','company.file.upload','company.file.manage']),
   ('marketing','Marketing','Не активирована; рабочих разрешений нет.','{}'::TEXT[]),
   ('accountant','Accountant','Не активирована; рабочих разрешений нет.','{}'::TEXT[])
  ) AS templates(slug,label,description,permissions) LOOP
   SELECT COALESCE(array_agg(DISTINCT k ORDER BY k),'{}'::TEXT[]) INTO keys FROM unnest(spec.permissions) k;
   -- Fail if a template names an unknown, protected or unsupported permission.
   SELECT array_agg(k ORDER BY k) INTO invalid_keys FROM unnest(keys) k
    LEFT JOIN platform.permission_definitions d ON d.permission_key=k
    WHERE d.permission_key IS NULL OR d.staff_system_only OR d.staff_sensitive OR cardinality(d.staff_scope_kinds)=0;
   IF invalid_keys IS NOT NULL THEN
    RAISE EXCEPTION 'staff_business_template_permission_invalid: %',spec.slug
     USING DETAIL=array_to_string(invalid_keys,',');
   END IF;
   PERFORM platform_private.staff_validate_permission_keys(to_jsonb(keys));
   expected_scope:=CASE WHEN spec.slug IN ('sales-manager','admissions-manager') THEN 'department'
     WHEN spec.slug IN ('sales-common','admissions-common') THEN 'organization' ELSE 'own' END;
   IF EXISTS(SELECT 1 FROM unnest(keys) k JOIN platform.permission_definitions d ON d.permission_key=k
     WHERE NOT(expected_scope=ANY(d.staff_scope_kinds))) THEN
    RAISE EXCEPTION 'staff_business_template_scope_invalid: %',spec.slug;
   END IF;
   role_id:=gen_random_uuid();
   INSERT INTO platform.staff_role_definitions(id,organization_id,label,description,status,draft_permission_keys)
   VALUES(role_id,org.id,spec.label,spec.description,
     CASE WHEN cardinality(keys)=0 THEN 'archived' ELSE 'active' END,keys);
   IF cardinality(keys)>0 THEN
    bundle_id:=gen_random_uuid();
    INSERT INTO platform.role_bundle_versions(id,role,version,label) VALUES(bundle_id,NULL,1,spec.label);
    INSERT INTO platform.role_bundle_permissions(bundle_id,bundle_role,permission_key)
     SELECT bundle_id,NULL,k FROM unnest(keys) k;
    UPDATE platform.role_bundle_versions SET status='published',published_at=statement_timestamp() WHERE id=bundle_id;
    INSERT INTO platform.staff_role_bundle_bindings VALUES(org.id,role_id,bundle_id,1);
    UPDATE platform.staff_role_definitions SET current_bundle_id=bundle_id WHERE id=role_id;
   END IF;
  END LOOP;
 END LOOP;
END $templates$;

-- Active sessions re-read these permissions. Bump staff versions for reviewed
-- forms/commands; changing a role later retains 155's all-assignee publication.
DO $versions$
DECLARE org RECORD; memberships UUID[];
BEGIN
 FOR org IN SELECT id FROM platform.organizations WHERE status='active' LOOP
  SELECT array_agg(id ORDER BY id) INTO memberships FROM platform.organization_memberships
   WHERE organization_id=org.id AND "current_role" IS DISTINCT FROM 'student';
  PERFORM platform_private.staff_lock_memberships(org.id,memberships);
  PERFORM platform_private.staff_bump_memberships(org.id,memberships);
 END LOOP;
END $versions$;

NOTIFY pgrst,'reload schema';
COMMIT;
