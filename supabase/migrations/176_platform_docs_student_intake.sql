-- Direct staff Docs intake: one canonical client/case, no Sales or Auth fiction.
-- Existing lifecycle/scope guards remain active. New functions use private
-- authorization and a transaction-scoped request lock, not browser authority.
-- https://www.postgresql.org/docs/current/sql-createfunction.html
-- https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS
BEGIN;

ALTER TABLE platform.student_cases
  ALTER COLUMN responsible_sales_membership_id DROP NOT NULL,
  ADD CONSTRAINT student_cases_direct_docs_origin_check CHECK (
    responsible_sales_membership_id IS NOT NULL
    OR (
      source_key = 'docs-intake:' || id::TEXT
      AND canonical_client_id IS NOT NULL
      AND canonical_lead_id IS NULL
    )
  );

CREATE TABLE platform_private.docs_student_intake_requests (
  organization_id UUID NOT NULL REFERENCES platform.organizations(id),
  request_id UUID NOT NULL,
  actor_membership_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  fingerprint TEXT NOT NULL,
  receipt JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (organization_id, request_id),
  UNIQUE (organization_id, student_case_id),
  FOREIGN KEY (organization_id, actor_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id),
  FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases(organization_id, id)
);
ALTER TABLE platform_private.docs_student_intake_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.docs_student_intake_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform_private.docs_student_intake_requests
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
CREATE TRIGGER docs_student_intake_requests_append_only
  BEFORE UPDATE OR DELETE ON platform_private.docs_student_intake_requests
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();

-- Before a case exists, use the same owner-based shared-role matcher as the
-- eventual case. Ordinary own-scope staff can create only for themselves.
CREATE FUNCTION platform_private.docs_student_curator_allowed(
  p_organization_id UUID, p_actor_membership_id UUID, p_curator_membership_id UUID
) RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM platform_private.staff_membership_identity(p_organization_id, p_curator_membership_id)
    WHERE platform_private.staff_context_can_access(p_organization_id, p_actor_membership_id,
      'profile.manage', 'student_case', NULL, p_curator_membership_id, NULL, NULL)
      AND platform_private.staff_context_can_access(p_organization_id, p_actor_membership_id,
        'case.read.full', 'student_case', NULL, p_curator_membership_id, NULL, NULL)
      AND platform_private.staff_context_can_access(p_organization_id, p_curator_membership_id,
        'profile.manage', 'student_case', NULL, p_curator_membership_id, NULL, NULL)
      AND platform_private.staff_context_can_access(p_organization_id, p_curator_membership_id,
        'case.read.full', 'student_case', NULL, p_curator_membership_id, NULL, NULL)
  )
$$;
REVOKE ALL ON FUNCTION platform_private.docs_student_curator_allowed(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE FUNCTION platform.docs_student_intake_options(p_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; curators JSONB; default_curator UUID;
BEGIN
  SELECT * INTO actor FROM platform_private.require_domain_actor_read(p_organization_id, 'profile.manage');
  IF NOT platform_private.staff_has_permission(p_organization_id, actor.actor_membership_id, 'case.read.full') THEN
    RAISE EXCEPTION 'docs_student_forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('membership_id', m.id, 'display_name', p.display_name)
    ORDER BY p.display_name, m.id), '[]'::JSONB) INTO curators
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = p_organization_id AND m.status = 'active' AND p.status = 'active'
    AND platform_private.docs_student_curator_allowed(p_organization_id, actor.actor_membership_id, m.id);
  IF platform_private.docs_student_curator_allowed(p_organization_id, actor.actor_membership_id, actor.actor_membership_id) THEN
    default_curator := actor.actor_membership_id;
  END IF;
  RETURN jsonb_build_object('organization_id', p_organization_id, 'curators', curators,
    'default_curator_membership_id', default_curator);
END $$;

CREATE FUNCTION platform.create_docs_student(
  p_organization_id UUID, p_request_id UUID, p_display_name TEXT,
  p_curator_membership_id UUID, p_target_country TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  normalized_name TEXT := btrim(p_display_name);
  normalized_country TEXT := nullif(btrim(p_target_country), '');
  fingerprint TEXT;
  prior platform_private.docs_student_intake_requests%ROWTYPE;
  new_client_id UUID;
  new_case_id UUID := gen_random_uuid();
  initial_scope_id UUID := gen_random_uuid();
  assigned_scope_id UUID := gen_random_uuid();
  result JSONB;
  changed_at TIMESTAMPTZ := statement_timestamp();
  reason CONSTANT TEXT := 'Student document workspace created directly in EVO Docs';
BEGIN
  SELECT * INTO actor FROM platform_private.require_domain_actor(p_organization_id, 'profile.manage');
  IF NOT platform_private.staff_has_permission(p_organization_id, actor.actor_membership_id, 'case.read.full') THEN
    RAISE EXCEPTION 'docs_student_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR p_curator_membership_id IS NULL OR normalized_name IS NULL
    OR length(normalized_name) NOT BETWEEN 1 AND 200 OR normalized_name ~ '[[:cntrl:]]'
    OR length(normalized_country) > 100 OR normalized_country ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'docs_student_invalid_fields' USING ERRCODE = '22023';
  END IF;
  fingerprint := md5(jsonb_build_object('name', normalized_name, 'curator', p_curator_membership_id,
    'country', normalized_country)::TEXT);
  PERFORM pg_advisory_xact_lock(hashtextextended('docs-student:' || p_organization_id::TEXT || ':' || p_request_id::TEXT, 0));
  SELECT * INTO prior FROM platform_private.docs_student_intake_requests r
    WHERE r.organization_id = p_organization_id AND r.request_id = p_request_id;
  IF FOUND THEN
    IF prior.actor_membership_id <> actor.actor_membership_id OR prior.fingerprint <> fingerprint THEN
      RAISE EXCEPTION 'docs_student_request_id_conflict' USING ERRCODE = '22023';
    END IF;
    IF NOT platform_private.staff_can_access(p_organization_id, actor.actor_membership_id,
      'profile.manage', 'student_case', prior.student_case_id)
      OR NOT platform_private.staff_can_access(p_organization_id, actor.actor_membership_id,
        'case.read.full', 'student_case', prior.student_case_id) THEN
      RAISE EXCEPTION 'docs_student_forbidden' USING ERRCODE = '42501';
    END IF;
    RETURN prior.receipt;
  END IF;
  IF NOT platform_private.docs_student_curator_allowed(p_organization_id, actor.actor_membership_id, p_curator_membership_id) THEN
    RAISE EXCEPTION 'docs_student_forbidden' USING ERRCODE = '42501';
  END IF;

  -- Reuse canonical identity/provenance. Name alone never merges two people.
  new_client_id := platform_private.create_or_link_client(p_organization_id, normalized_name,
    NULL, NULL, 'evo_docs', 'student_case', new_case_id::TEXT, 'manual_intake', changed_at);
  INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version, is_active)
    VALUES (initial_scope_id, p_organization_id, 'student_case', new_case_id, 1, TRUE);
  INSERT INTO platform.student_cases(
    id, organization_id, student_membership_id, responsible_sales_membership_id,
    current_curator_membership_id, source_key, contract_confirmation_ref, contract_confirmed_at,
    student_display_name, target_country, target_degree, route_approval_status,
    operational_stage, state, handoff_at, portal_activated_at, closed_at, next_action,
    current_scope_id, current_scope_version, canonical_client_id, canonical_lead_id
  ) VALUES (
    new_case_id, p_organization_id, NULL, NULL, NULL, 'docs-intake:' || new_case_id::TEXT,
    NULL, NULL, normalized_name, normalized_country, NULL, 'draft', 'docs_intake', 'pending',
    NULL, NULL, NULL, NULL, initial_scope_id, 1, new_client_id, NULL
  );

  -- Use the existing forward-only assignment transition, without bypassing
  -- triggers or claiming a Sales handoff, contract, payment or portal login.
  UPDATE platform.record_scopes SET is_active = FALSE
    WHERE organization_id = p_organization_id AND id = initial_scope_id AND scope_version = 1;
  INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version, is_active)
    VALUES (assigned_scope_id, p_organization_id, 'student_case', new_case_id, 2, TRUE);
  PERFORM platform_private.append_scope_event(p_organization_id, p_curator_membership_id,
    assigned_scope_id, 2, TRUE, 'user', actor.actor_profile_id, reason, p_request_id);
  UPDATE platform.student_cases SET current_curator_membership_id = p_curator_membership_id,
    state = 'active', handoff_at = changed_at, current_scope_id = assigned_scope_id, current_scope_version = 2
    WHERE organization_id = p_organization_id AND id = new_case_id;
  INSERT INTO platform.student_case_assignment_events(
    organization_id, student_case_id, event_type, previous_curator_membership_id,
    new_curator_membership_id, previous_scope_id, previous_scope_version,
    new_scope_id, new_scope_version, actor_membership_id, reason, request_id
  ) VALUES (p_organization_id, new_case_id, 'assigned', NULL, p_curator_membership_id,
    initial_scope_id, 1, assigned_scope_id, 2, actor.actor_membership_id, reason, p_request_id);
  INSERT INTO platform.student_case_lifecycle_events(
    organization_id, student_case_id, event_type, previous_state, new_state, actor_membership_id, reason, request_id
  ) VALUES (p_organization_id, new_case_id, 'activated', 'pending', 'active', actor.actor_membership_id, reason, p_request_id);

  result := jsonb_build_object('organization_id', p_organization_id, 'request_id', p_request_id,
    'student_case_id', new_case_id, 'curator_membership_id', p_curator_membership_id);
  INSERT INTO platform_private.docs_student_intake_requests(
    organization_id, request_id, actor_membership_id, student_case_id, fingerprint, receipt
  ) VALUES (p_organization_id, p_request_id, actor.actor_membership_id, new_case_id, fingerprint, result);
  INSERT INTO platform.audit_events(
    organization_id, actor_kind, actor_profile_id, actor_principal, action, resource_type,
    resource_id, after_state, reason, request_id
  ) VALUES (p_organization_id, 'user', actor.actor_profile_id, 'auth:' || actor.actor_auth_user_id::TEXT,
    'docs.student.create', 'student_case', new_case_id,
    jsonb_build_object('canonical_client_id', new_client_id, 'curator_membership_id', p_curator_membership_id,
      'origin', 'docs_intake', 'scope_version', 2), reason, p_request_id);
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION platform.docs_student_intake_options(UUID),
  platform.create_docs_student(UUID, UUID, TEXT, UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.docs_student_intake_options(UUID),
  platform.create_docs_student(UUID, UUID, TEXT, UUID, TEXT) TO authenticated;

-- Existing full-case/application readers must retain cases with no Sales
-- owner. Only their first (full-access) Sales join pair changes. Summary-branch
-- predicates, grants and all existing role/tenant checks are preserved.
DO $readers$
DECLARE signature TEXT; definition TEXT; join_text TEXT; join_at INTEGER;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'platform.staff_student_case_page(integer,timestamptz,uuid,platform.student_case_state,text,uuid,text,uuid,text)',
    'private.platform_staff_application_page(integer,timestamptz,uuid,platform.application_status,uuid,uuid)'
  ] LOOP
    definition := pg_get_functiondef(to_regprocedure(signature));
    FOREACH join_text IN ARRAY ARRAY[
      'JOIN platform.organization_memberships AS sales_membership',
      'JOIN platform.profiles AS sales_profile'
    ] LOOP
      join_at := position(join_text IN definition);
      IF definition IS NULL OR join_at = 0 OR substring(definition FROM greatest(1, join_at - 5) FOR 5) = 'LEFT ' THEN
        RAISE EXCEPTION 'docs_student_reader_source_drift: %', signature;
      END IF;
      definition := overlay(definition PLACING 'LEFT ' || join_text FROM join_at FOR length(join_text));
    END LOOP;
    EXECUTE definition;
  END LOOP;
  -- The current detail reader delegates to the paged case reader; it has no
  -- independent Sales joins and must keep its fixed projection unchanged.
  definition := pg_get_functiondef('platform.staff_student_case_read_snapshot(uuid)'::regprocedure);
  IF position('platform.staff_student_case_page(' IN definition) = 0 THEN
    RAISE EXCEPTION 'docs_student_snapshot_source_drift';
  END IF;
END $readers$;

COMMIT;
