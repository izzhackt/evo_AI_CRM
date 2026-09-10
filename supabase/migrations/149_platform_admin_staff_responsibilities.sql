-- A1: Admin performs staff responsibilities under the same real identity.
-- Assignment eligibility is not actor authorization: all existing permission,
-- business-state, scope, request/replay and row-lock checks remain in place.
-- Official references (2026-09-10; Context7 quota unavailable):
-- https://supabase.com/docs/guides/database/functions
-- https://supabase.com/docs/guides/database/postgres/row-level-security
BEGIN;

CREATE FUNCTION platform_private.is_eligible_staff_responsibility(
  p_organization_id UUID,
  p_membership_id UUID,
  p_required_role TEXT
)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM platform.organization_memberships AS membership
    JOIN platform.profiles AS profile ON profile.id = membership.profile_id
    JOIN platform.organizations AS organization
      ON organization.id = membership.organization_id
    JOIN platform.role_bundle_versions AS bundle
      ON bundle.id = membership.current_bundle_id
      AND bundle.role = membership."current_role"
    WHERE membership.organization_id = p_organization_id
      AND membership.id = p_membership_id
      AND membership.status = 'active'
      AND profile.status = 'active'
      AND organization.status = 'active'
      AND bundle.status = 'published'
      AND p_required_role IN ('sales', 'curator')
      AND (
        membership."current_role" = 'admin'
        OR membership."current_role"::TEXT = p_required_role
      )
  )
$function$;
REVOKE ALL ON FUNCTION platform_private.is_eligible_staff_responsibility(UUID,UUID,TEXT)
  FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;

COMMENT ON FUNCTION platform_private.is_eligible_staff_responsibility(UUID,UUID,TEXT)
  IS 'Active same-tenant staff target eligibility. Actual Admin can own Sales/Curator work; never grants actor permissions or Student access.';

-- Existing Sales option/claim/reassignment/manual-intake/register commands keep
-- their public API and actor restrictions, now sharing the same target rule.
CREATE OR REPLACE FUNCTION platform_private.is_eligible_sales_owner(
  p_organization_id UUID, p_membership_id UUID
) RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT platform_private.is_eligible_staff_responsibility(
    p_organization_id, p_membership_id, 'sales')
$function$;
REVOKE ALL ON FUNCTION platform_private.is_eligible_sales_owner(UUID,UUID)
  FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;

-- Amend only named predicates in the current authoritative functions. Using
-- their installed definitions retains 117's wrappers, 126's assignment body,
-- 137's nine-argument directory, later extensions and existing function ACLs.
-- Each exact anchor must occur once; unexpected schema drift aborts the whole
-- migration. This is intentionally not a schema-wide role-literal replacement.
-- Workload includes inactive former owners for history/return conflicts; its
-- active flag and all commands use the central live-eligibility predicate.
DO $migration$
DECLARE
  patch RECORD;
  original TEXT;
  revised TEXT;
BEGIN
  FOR patch IN SELECT * FROM (VALUES
    ('platform_private.create_or_link_lead(uuid,uuid,uuid,text,text,text,text,text,text,timestamptz,timestamptz,text)',
      'membership."current_role" = ''sales''',
      'platform_private.is_eligible_staff_responsibility(membership.organization_id, membership.id, ''sales'')'),
    ('platform_private.create_or_link_lead(uuid,uuid,uuid,text,text,text,text,text,text,timestamptz,timestamptz,text)',
      'Canonical lead owner must be an active Sales membership',
      'Canonical lead owner must be an active Sales or Admin membership'),
    ('platform_private.u6_eligible_admissions_owners(uuid)',
      'membership."current_role" = ''curator''',
      'platform_private.is_eligible_staff_responsibility(membership.organization_id, membership.id, ''curator'')'),
    ('platform.handoff_lead_to_admissions(uuid,bigint,uuid,text,text,uuid)',
      'sales_owner."current_role" = ''sales''',
      'platform_private.is_eligible_staff_responsibility(sales_owner.organization_id, sales_owner.id, ''sales'')'),
    ('platform.handoff_lead_to_admissions(uuid,bigint,uuid,text,text,uuid)',
      'membership."current_role" = ''curator''',
      'platform_private.is_eligible_staff_responsibility(membership.organization_id, membership.id, ''curator'')'),
    ('platform_private.assign_student_case_curator_authorized_e1(uuid,uuid,uuid,text,uuid,uuid,uuid,uuid)',
      'membership."current_role" = ''curator''',
      'platform_private.is_eligible_staff_responsibility(membership.organization_id, membership.id, ''curator'')'),
    ('platform_private.assign_student_case_curator_authorized_e1(uuid,uuid,uuid,text,uuid,uuid,uuid,uuid)',
      'Live Curator membership is required',
      'Live Curator or Admin membership is required'),
    ('private.staff_student_case_handoff_acknowledgement(uuid)',
      'actor.platform_role = ''curator''',
      'platform_private.is_eligible_staff_responsibility(actor.organization_id, actor.membership_id, ''curator'')'),
    ('private.respond_student_case_handoff(uuid,uuid,uuid,uuid,text,text,date,uuid)',
      'actor.actor_role <> ''curator''',
      'NOT platform_private.is_eligible_staff_responsibility(p_organization_id, actor.actor_membership_id, ''curator'')'),
    ('private.manage_case_coverage(text,uuid,uuid,uuid,bigint,uuid,date,uuid,bigint,jsonb,text,uuid)',
      'membership."current_role"=''curator''',
      'platform_private.is_eligible_staff_responsibility(membership.organization_id, membership.id, ''curator'')'),
    ('private.manage_case_coverage(text,uuid,uuid,uuid,bigint,uuid,date,uuid,bigint,jsonb,text,uuid)',
      'Coverage requires an active Curator',
      'Coverage requires an active Curator or Admin'),
    ('private.read_curator_coverage_workspace(uuid,uuid,uuid,uuid)',
      'organization_id=p_organization_id AND "current_role"=''curator''',
      'organization_id=p_organization_id AND "current_role" IN (''admin'',''curator'')'),
    ('private.read_curator_coverage_workspace(uuid,uuid,uuid,uuid)',
      'member.organization_id=p_organization_id AND member."current_role"=''curator''',
      'member.organization_id=p_organization_id AND member."current_role" IN (''admin'',''curator'')'),
    ('private.read_curator_coverage_workspace(uuid,uuid,uuid,uuid)',
      'COALESCE(member.status=''active'' AND profile.status=''active'' AND bundle.status=''published'',false)',
      'platform_private.is_eligible_staff_responsibility(member.organization_id, member.id, ''curator'')'),
    ('platform.assert_case_finance_stop_factor(uuid,uuid,text,text,text,text,bigint,uuid)',
      'owner_membership."current_role" = ''curator''',
      'platform_private.is_eligible_staff_responsibility(owner_membership.organization_id, owner_membership.id, ''curator'')'),
    ('platform.prepare_student_portal_provisioning(uuid,uuid,text,text,text,uuid,text,uuid)',
      'membership."current_role" = ''curator''',
      'platform_private.is_eligible_staff_responsibility(membership.organization_id, membership.id, ''curator'')'),
    ('platform.finalize_student_portal_authority(uuid,bigint,bigint)',
      'membership."current_role" = ''curator''',
      'platform_private.is_eligible_staff_responsibility(membership.organization_id, membership.id, ''curator'')'),
    ('platform.student_portal_overview_v2()',
      'curator_membership."current_role" = ''curator''',
      'platform_private.is_eligible_staff_responsibility(curator_membership.organization_id, curator_membership.id, ''curator'')'),
    ('platform.student_portal_overview_v1()',
      'curator_membership."current_role" = ''curator''',
      'platform_private.is_eligible_staff_responsibility(curator_membership.organization_id, curator_membership.id, ''curator'')'),
    ('platform.staff_student_case_page(integer,timestamptz,uuid,platform.student_case_state,text,uuid,text,uuid,text)',
      'curator_membership."current_role" = ''curator''',
      'platform_private.is_eligible_staff_responsibility(curator_membership.organization_id, curator_membership.id, ''curator'')'),
    ('platform.staff_student_case_page(integer,timestamptz,uuid,platform.student_case_state,text,uuid,text,uuid,text)',
      'sales_membership."current_role" = ''sales''',
      'platform_private.is_eligible_staff_responsibility(sales_membership.organization_id, sales_membership.id, ''sales'')'),
    ('platform.create_pending_student_case(uuid,uuid,uuid,text,text,timestamptz,text,text,text,text,text,text,text,text,text,uuid)',
      'membership."current_role" = ''sales''',
      'platform_private.is_eligible_staff_responsibility(membership.organization_id, membership.id, ''sales'')'),
    ('platform.create_pending_student_case(uuid,uuid,uuid,text,text,timestamptz,text,text,text,text,text,text,text,text,text,uuid)',
      'Live Sales membership is required',
      'Live Sales or Admin membership is required')
  ) AS patches(signature, anchor, replacement)
  LOOP
    original := pg_catalog.pg_get_functiondef(patch.signature::regprocedure);
    IF (pg_catalog.length(original) -
        pg_catalog.length(pg_catalog.replace(original, patch.anchor, '')))
        / pg_catalog.length(patch.anchor) <> 1
    THEN
      RAISE EXCEPTION 'Admin responsibility source anchor drift: %', patch.signature;
    END IF;
    revised := pg_catalog.replace(original, patch.anchor, patch.replacement);
    EXECUTE revised;
  END LOOP;
END $migration$;

-- Narrow authenticated staff DTO for the existing legacy-pending provisioning
-- picker. Do not query raw membership/profile tables or invent roles in the UI.
-- Reuse the handoff owner reader so both pickers and commands agree. Its bound
-- is explicit here: never silently present a partial provisioning directory.
CREATE FUNCTION platform.staff_student_portal_curator_options(p_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM platform_private.require_admin_actor(p_organization_id, 'membership.provision');
  PERFORM platform_private.require_admin_actor(p_organization_id, 'case.curator.assign');
  IF (SELECT count(*) FROM platform.organization_memberships AS membership
    WHERE membership.organization_id = p_organization_id
      AND platform_private.is_eligible_staff_responsibility(
        membership.organization_id, membership.id, 'curator')) > 100
  THEN
    RAISE EXCEPTION 'Curator options exceed supported bound' USING ERRCODE = '54000';
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'organization_id', p_organization_id,
    'owners', platform_private.u6_eligible_admissions_owners(p_organization_id)
  );
END $function$;
REVOKE ALL ON FUNCTION platform.staff_student_portal_curator_options(UUID)
  FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_student_portal_curator_options(UUID)
  TO authenticated;

-- No membership/role rewrite, scope bypass, business data, provider calls or
-- assessment access are introduced. Acknowledgement still belongs solely to
-- the actual current recipient and its exact assignment event.
NOTIFY pgrst, 'reload schema';
COMMIT;
