-- Four card blocks share one revisioned row. Merge only the selected group's
-- exact patch into the locked authoritative row; never trust sibling SSR fields.
-- The legacy full-replacement v1 function, receipts and read DTO stay unchanged.
BEGIN;

CREATE FUNCTION platform.save_lead_sale_conditions_group_v1(
  p_organization_id UUID, p_request_id UUID, p_lead_id UUID,
  p_expected_revision BIGINT, p_group TEXT, p_fields JSONB
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  original_membership_id UUID;
  group_keys TEXT[];
  fingerprint TEXT;
  normalized JSONB;
  prior platform_private.lead_sale_conditions_requests%ROWTYPE;
  old platform_private.lead_sale_conditions%ROWTYPE;
  changed platform_private.lead_sale_conditions%ROWTYPE;
  receipt JSONB;
BEGIN
  SELECT a.* INTO actor FROM platform.current_actor_authority() a
    WHERE a.organization_id = p_organization_id AND a.platform_role IS DISTINCT FROM 'student';
  IF NOT FOUND OR platform_private.staff_can_access(
    p_organization_id, actor.membership_id, 'lead.sales.workflow.manage', 'lead', p_lead_id
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'lead_sale_conditions_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR p_lead_id IS NULL OR p_expected_revision IS NULL
    OR p_expected_revision NOT BETWEEN 0 AND 9007199254740990 THEN
    RAISE EXCEPTION 'lead_sale_conditions_invalid_command' USING ERRCODE = '22023';
  END IF;

  group_keys := CASE p_group
    WHEN 'sale' THEN ARRAY['service_label', 'signing_date', 'service_cost_raw',
      'service_cost_minor', 'service_cost_currency', 'paid_raw', 'paid_minor', 'paid_currency', 'payment_note']
    WHEN 'wishes' THEN ARRAY['wishes_countries', 'wishes_study_fields', 'wishes_education_level',
      'wishes_intake_year', 'wishes_intake_season', 'wishes_universities']
    WHEN 'education' THEN ARRAY['education_current', 'education_grade', 'education_marks',
      'education_english', 'education_certificates']
    WHEN 'conditions' THEN ARRAY['conditions_budget_raw', 'conditions_budget_minor',
      'conditions_budget_currency', 'conditions_budget_period', 'conditions_scholarship', 'conditions_note']
    ELSE NULL END;
  IF group_keys IS NULL OR p_fields IS NULL OR jsonb_typeof(p_fields) <> 'object'
    OR pg_column_size(p_fields) > 20000 THEN
    RAISE EXCEPTION 'lead_sale_conditions_invalid_fields' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_fields)) <> cardinality(group_keys)
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_fields) k WHERE NOT k = ANY(group_keys)) THEN
    RAISE EXCEPTION 'lead_sale_conditions_invalid_fields' USING ERRCODE = '22023';
  END IF;

  -- Hash the original command, never the subsequently merged database snapshot.
  original_membership_id := actor.membership_id;
  fingerprint := md5(jsonb_build_object('operation', 'lead-card-group-v1',
    'actor', actor.membership_id, 'lead', p_lead_id, 'revision', p_expected_revision,
    'group', p_group, 'fields', p_fields)::TEXT);
  -- Same lead lock as the legacy v1 writer; serialize request reuse across leads.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'lead-sale-conditions:' || p_organization_id::TEXT || ':' || p_lead_id::TEXT, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'lead-sale-conditions-request:' || p_organization_id::TEXT || ':' || p_request_id::TEXT, 0));
  SELECT * INTO old FROM platform_private.lead_sale_conditions c
    WHERE c.organization_id = p_organization_id AND c.lead_id = p_lead_id FOR UPDATE;

  -- Authority can change while waiting. Historical replay also requires current
  -- per-record access; it must not disclose a past receipt after access is lost.
  SELECT a.* INTO actor FROM platform.current_actor_authority() a
    WHERE a.organization_id = p_organization_id AND a.platform_role IS DISTINCT FROM 'student';
  IF NOT FOUND OR actor.membership_id IS DISTINCT FROM original_membership_id OR platform_private.staff_can_access(
    p_organization_id, actor.membership_id, 'lead.sales.workflow.manage', 'lead', p_lead_id
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'lead_sale_conditions_forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO prior FROM platform_private.lead_sale_conditions_requests r
    WHERE r.organization_id = p_organization_id AND r.request_id = p_request_id;
  IF FOUND THEN
    IF prior.actor_membership_id <> actor.membership_id OR prior.fingerprint <> fingerprint THEN
      RAISE EXCEPTION 'lead_sale_conditions_request_id_conflict' USING ERRCODE = '22023';
    END IF;
    RETURN prior.receipt;
  END IF;
  IF (old.lead_id IS NULL) <> (p_expected_revision = 0)
    OR (old.lead_id IS NOT NULL AND old.revision <> p_expected_revision) THEN
    RAISE EXCEPTION 'lead_sale_conditions_stale' USING ERRCODE = 'PT409';
  END IF;
  normalized := platform_private.lead_sale_condition_fields(COALESCE(old.fields, '{}'::JSONB) || p_fields);
  IF old.lead_id IS NULL THEN
    INSERT INTO platform_private.lead_sale_conditions(lead_id, organization_id, fields, revision, updated_by_membership_id)
      VALUES(p_lead_id, p_organization_id, normalized, 1, actor.membership_id) RETURNING * INTO changed;
  ELSE
    UPDATE platform_private.lead_sale_conditions SET fields = normalized, revision = revision + 1,
      updated_by_membership_id = actor.membership_id, updated_at = statement_timestamp()
      WHERE organization_id = p_organization_id AND lead_id = p_lead_id RETURNING * INTO changed;
  END IF;
  receipt := platform_private.lead_sale_conditions_row(changed);
  BEGIN
    INSERT INTO platform_private.lead_sale_conditions_requests(organization_id, request_id, actor_membership_id, fingerprint, receipt)
      VALUES(p_organization_id, p_request_id, actor.membership_id, fingerprint, receipt);
  EXCEPTION WHEN unique_violation THEN
    -- Legacy v1 does not take the request lock. Reject a concurrent cross-lead
    -- collision; the raised error rolls back this command's earlier row write.
    RAISE EXCEPTION 'lead_sale_conditions_request_id_conflict' USING ERRCODE = '22023';
  END;
  INSERT INTO platform.audit_events(organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, after_state, reason, request_id)
    VALUES(p_organization_id, 'user', actor.profile_id, 'auth:' || actor.auth_user_id::TEXT,
      'lead.sale.conditions.save', 'lead', p_lead_id, jsonb_build_object('revision', changed.revision::TEXT),
      'Sale conditions saved on the lead card', p_request_id);
  RETURN receipt;
END $$;

REVOKE ALL ON FUNCTION platform.save_lead_sale_conditions_group_v1(UUID,UUID,UUID,BIGINT,TEXT,JSONB)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.save_lead_sale_conditions_group_v1(UUID,UUID,UUID,BIGINT,TEXT,JSONB)
  TO authenticated;

COMMIT;
