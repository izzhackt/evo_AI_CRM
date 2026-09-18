-- Unified-workflow pivot, slice S7 follow-up.
-- docs/EVO_UNIFIED_WORKFLOW_PLAN_2026-09-18.md (§4, §5, §8) + docs/PLAN_CHANGES.md
-- «unified workflow S1/S2/S4» (this journal, previous entries) + «unified
-- workflow S7: карточные блоки, приглашение, партнёрские факты» (this
-- journal, the entry this migration implements).
--
-- Closes three recorded partial items of the released pivot:
--
--  a) platform_private.lead_sale_condition_fields() (181) widens its
--     allowlist from the 9 «Условия продажи» keys to 26 keys across four
--     card-block families — Пожелания (wishes_countries, wishes_study_fields,
--     wishes_education_level, wishes_intake_year, wishes_intake_season,
--     wishes_universities), Образование (education_current, education_grade,
--     education_marks, education_english, education_certificates) and
--     Условия (conditions_budget_raw/minor/currency, conditions_budget_period,
--     conditions_scholarship, conditions_note) join the original service_label/
--     signing_date/service_cost_*/paid_*/payment_note set. Same shape rules
--     as 181: control-character guard, bounded per-key lengths, USD/EUR/KGS
--     money pairs (now three pairs: service_cost, paid, conditions_budget).
--     Every 181 key stays legal and the function still accepts a payload
--     containing only a SUBSET of the 26 keys (any key not present simply
--     normalizes to blank/NULL) — historical single-family rows, and rows
--     written before this migration, remain valid input shapes.
--     `platform.save_lead_sale_conditions_v1` (181) is UNCHANGED: same
--     signature, same full-row-replace semantics. `staff_lead_sale_conditions_v1`
--     and its `lead_sale_conditions_row` helper (181) DO get a same-signature
--     CREATE OR REPLACE here too — a necessary consequence, not scope creep:
--     without it, a HISTORICAL row (only the original 9 keys stored) or a
--     lead with no row yet would read back missing the 17 new keys, breaking
--     the TS contract's exact-key check. Both reuse the widened validator
--     itself as a defaults source (`lead_sale_condition_fields('{}')` already
--     returns a full 26-key object) rather than hand-listing 26 keys twice.
--     Because the row is replaced whole (not merged) on every save, the four
--     card blocks on the UI side each submit the CURRENT full 26-key set
--     (their own edited slice plus hidden inputs carrying the other three
--     blocks' last-known values) — see LeadCardFieldsForm.tsx. This keeps
--     181's already-audited save path untouched while still letting each
--     block be filled independently, per plan §5 «заполняем постепенно».
--
--  b) platform.prepare_lead_cabinet_v1(p_organization_id, p_request_id,
--     p_lead_id): for a lead with no linked case and no existing Student
--     membership (site/WhatsApp leads have no platform анкета and therefore
--     no account yet), creates the SAME canonical pending, curator-less case
--     the S1 анкета-approval flow creates (migration 180's
--     decide_student_application_v1 shape): state='pending',
--     current_curator_membership_id NULL, canonical_lead_id set,
--     responsible_sales_membership_id = the lead's current owner (legally
--     NULL for an ownerless lead, matching 180's own CASE WHEN). Gated by
--     platform_private.staff_can_access(...,'lead.sales.workflow.manage',
--     'lead',p_lead_id) — the exact same scoped permission every other lead
--     sales-workflow write in this codebase already uses (088/134/174/181).
--     Refuses with a named error when the lead already owns a pending/active
--     case (lead_cabinet_case_exists) or when a Student membership already
--     exists for this person by email (lead_cabinet_membership_exists) —
--     "one person, one card" (plan §1), never a second cabinet.
--
--     Deliberate, documented departure from the literal S7 journal wording
--     ("portal_activated_at=now"): unlike the S1 анкета flow — where the
--     applicant already has a confirmed auth.users row and Student membership
--     BEFORE the case is even inserted, so portal_activated_at can legally be
--     set in the same INSERT — a site/WhatsApp lead has no account at
--     cabinet-prepare time. student_cases_portal_membership_shape_check (088,
--     untouched by this migration) requires student_membership_id IS NOT NULL
--     whenever portal_activated_at is set; setting it here with no membership
--     would violate that invariant. portal_activated_at therefore stays NULL
--     at prepare time — this RPC only prepares the case, exactly as the task
--     contract's own part (b) label says.
--
--     Actual account binding — and therefore portal_activated_at — is a
--     SEPARATE, already-admin-gated mechanism (migration 126's case-bound
--     invite provisioning: platform.prepare_student_portal_provisioning /
--     claim_student_portal_invite / finalize_student_portal_authority).
--     Investigated here, not modified: 126 defines exactly two case shapes,
--     'normal_u6' (an ACTIVE case with a curator already assigned — the
--     ordinary post-handoff Student Portal invite) and 'legacy_pending' (a
--     PENDING, curator-less case at prepare time, but
--     finalize_student_portal_authority's own continuing_legacy_activation
--     branch assigns receipt.legacy_curator_membership_id as the case's
--     current_curator_membership_id and flips state to 'active' the moment
--     the invite is accepted — see 126 lines ~2383-2418/2545-2563). Reusing
--     'legacy_pending' for a cabinet-prepared case would therefore silently
--     assign a curator and hand the case off to Admissions the moment the
--     student accepts their invite — exactly what plan §4 forbids
--     ("Одобрение анкеты или доступа не создаёт передачу в Admissions и не
--     назначает куратора"). Neither existing shape fits "stays pending,
--     curator-less, until a real Sales report handoff" (S2's
--     create_sales_report_handoff already activates a pending cabinet case
--     in place — the correct, existing trigger for that transition).
--
--     Outcome (documented per the task's own instruction, not hidden): invite
--     DISPATCH for a lead-cabinet case is NOT wired into the UI in this
--     slice. Dispatch is admin-gated today (platform_private.
--     require_admin_actor inside prepare_student_portal_provisioning) and
--     that gate is correctly kept, but wiring StudentPortalAccessCard against
--     a cabinet-prepared case would need a THIRD 126 case shape (pending,
--     curator-less, and STAYS that way after acceptance) that does not exist
--     yet — adding one is a schema/trigger change to migration 126's own
--     domain, out of this migration's declared three-part scope, and is left
--     as a follow-up. The UI instead shows the created case link plus an
--     honest, quiet line naming this as admin-handled from the case, per the
--     task's own fallback instruction ("keep that gate and document it").
--
--     Companion read added beyond the literal three parts, same narrow
--     necessity as S4's readApplicationPartnerDetails departure:
--     platform.staff_lead_cabinet_case_v1(p_organization_id,p_lead_id) — a
--     STABLE read gated identically to staff_lead_sale_conditions_v1
--     (private.platform_can_read_canonical_lead), returning the lead's linked
--     case (any state) or NULL. Without it the «Подготовить кабинет» button
--     could not know a cabinet already exists after a page reload (no
--     application row exists for a lead with no анкета, so the existing
--     staff_student_application_for_lead_v1 read stays NULL forever for this
--     population) — plan §4's "для уже открытого доступа показываем «Доступ
--     открыт», а не повторное одобрение" applies here just as much as to the
--     анкета path.
--
--  c) platform.update_application_partner_details_v1(p_organization_id,
--     p_request_id,p_student_case_id,p_university_application_id,
--     p_expected_version,p_fields): allowlists exactly four NEW keys —
--     partner_contact, external_link (https:// shape-checked),
--     decision_reference, decision_note — merged (jsonb concat, preserving
--     every other existing key) into university_applications.admissions_details,
--     with optimistic concurrency (expected_version) and request-id replay.
--     Gated by platform_private.require_domain_actor(...,'application.manage')
--     (preliminary, cheap fail-fast) THEN
--     platform_private.require_case_operator(...,'application.manage') on the
--     application's OWN student_case_id (authoritative, matches p_student_case_id)
--     — the exact double-check pattern
--     private.platform_update_university_application_details (118) already
--     uses for the kept "details" CRUD action, the strongest of the two kept
--     application-CRUD SQL gates (create only does the single post-lock
--     check). NO admissions_playbook_version_id requirement — this is
--     precisely the S4-identified gap this slice closes: the OLD write path
--     (platform_private.admissions_related_command, 137) hard-required one;
--     this new, narrow, independent RPC does not.
--
--     Deliberately NEW key names (snake_case), not the legacy camelCase
--     partnerContact/packageReference/decisionReference/offerConditions the
--     retired playbook editor used: a fresh, independently-owned vocabulary
--     avoids any collision with historical playbook-era data still sitting in
--     admissions_details for old CN/MY cases, and the merge (`||`) means both
--     vocabularies coexist peacefully in the same JSONB column. Known,
--     narrow limitation (not touched here, out of scope, same population S4
--     already flagged as an edge case): the pre-existing
--     platform_private.admissions_guard_related trigger (137) only skips its
--     own admissions_field_schema validation when
--     student_cases.admissions_playbook_version_id IS NULL — true for every
--     case going forward since S4 removed the only UI that could ever set it.
--     For the small remaining population of ACTIVE, still playbook-bound
--     legacy CN/MY cases, that trigger's admissions_validate_fields call
--     requires EVERY key present in the merged admissions_details to appear
--     in admissions_field_schema('application') with a NON-EMPTY value —
--     our four new, often-blank, schema-unlisted keys do not qualify, so a
--     write through this RPC fails closed there. Widening 137's global
--     field-schema/trigger semantics to accommodate optional, sparsely-filled
--     keys is a different, larger change to a different migration's contract
--     and is left as a follow-up, exactly as S4's own read-only-outcome entry
--     already flagged this same population as an edge case.
--
-- Style: SECURITY DEFINER, SET search_path='', REVOKE/GRANT pairs, PT409
-- conflict codes, and request-id replay — (a) keeps 181's own
-- receipt-table/fingerprint replay untouched (only the validator body
-- changes); (b)/(c) use the generic platform_private.replay_audit +
-- platform.audit_events idiom 118/126/137 already use for exactly this kind
-- of case/application-scoped command.
BEGIN;

-- ---------------------------------------------------------------------------
-- a) platform_private.lead_sale_condition_fields(): widen the allowlist
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION platform_private.lead_sale_condition_fields(p_fields JSONB) RETURNS JSONB
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE result JSONB:='{}'::JSONB; key TEXT; value TEXT; amount TEXT; currency TEXT; date_value DATE;
BEGIN
  IF p_fields IS NULL OR jsonb_typeof(p_fields)<>'object' OR pg_column_size(p_fields)>30000
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_fields) k WHERE k NOT IN
      ('service_label','signing_date','service_cost_raw','service_cost_minor','service_cost_currency',
       'paid_raw','paid_minor','paid_currency','payment_note',
       'wishes_countries','wishes_study_fields','wishes_education_level','wishes_intake_year',
       'wishes_intake_season','wishes_universities',
       'education_current','education_grade','education_marks','education_english','education_certificates',
       'conditions_budget_raw','conditions_budget_minor','conditions_budget_currency','conditions_budget_period',
       'conditions_scholarship','conditions_note')) THEN
    RAISE EXCEPTION 'lead_sale_conditions_invalid_fields' USING ERRCODE='22023'; END IF;
  BEGIN date_value:=NULLIF(p_fields->>'signing_date','')::DATE;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'lead_sale_conditions_invalid_date' USING ERRCODE='22023'; END;
  IF date_value IS NOT NULL AND (date_value NOT BETWEEN DATE '1900-01-01' AND DATE '2100-12-31'
    OR (p_fields->>'signing_date') !~ '^(19|20|21)[0-9]{2}-[0-9]{2}-[0-9]{2}$') THEN
    RAISE EXCEPTION 'lead_sale_conditions_invalid_date' USING ERRCODE='22023'; END IF;
  result:=jsonb_build_object('signing_date',date_value);

  -- Bounded free text (each key its own length cap); same control-character
  -- guard as 181's original two-key loop, now covering every text key across
  -- all four card blocks.
  FOREACH key IN ARRAY ARRAY['service_label','payment_note',
      'wishes_countries','wishes_study_fields','wishes_education_level','wishes_intake_season','wishes_universities',
      'education_current','education_grade','education_marks','education_english','education_certificates',
      'conditions_scholarship','conditions_note'] LOOP
    IF p_fields ? key AND jsonb_typeof(p_fields->key) NOT IN ('string','null') THEN
      RAISE EXCEPTION 'lead_sale_conditions_invalid_text' USING ERRCODE='22023'; END IF;
    value:=btrim(coalesce(p_fields->>key,''));
    IF length(value)>(CASE key
        WHEN 'service_label' THEN 300
        WHEN 'wishes_countries' THEN 500
        WHEN 'wishes_study_fields' THEN 500
        WHEN 'wishes_education_level' THEN 200
        WHEN 'wishes_intake_season' THEN 100
        WHEN 'wishes_universities' THEN 2000
        WHEN 'education_current' THEN 300
        WHEN 'education_grade' THEN 100
        WHEN 'education_marks' THEN 300
        WHEN 'education_english' THEN 300
        WHEN 'education_certificates' THEN 2000
        WHEN 'conditions_scholarship' THEN 500
        ELSE 2000 END)
      OR value ~ '[\x01-\x08\x0b\x0c\x0e-\x1f]' THEN
      RAISE EXCEPTION 'lead_sale_conditions_invalid_text' USING ERRCODE='22023'; END IF;
    result:=result||jsonb_build_object(key,value);
  END LOOP;

  -- Bounded raw display text paired with a validated minor/currency below.
  FOREACH key IN ARRAY ARRAY['service_cost_raw','paid_raw','conditions_budget_raw'] LOOP
    IF p_fields ? key AND jsonb_typeof(p_fields->key) NOT IN ('string','null') THEN
      RAISE EXCEPTION 'lead_sale_conditions_invalid_text' USING ERRCODE='22023'; END IF;
    value:=btrim(coalesce(p_fields->>key,''));
    IF length(value)>300 OR value ~ '[\x01-\x08\x0b\x0c\x0e-\x1f]' THEN
      RAISE EXCEPTION 'lead_sale_conditions_invalid_text' USING ERRCODE='22023'; END IF;
    result:=result||jsonb_build_object(key,value);
  END LOOP;

  -- Money pairs: same USD/EUR/KGS + bounded-integer-minor rule as 134/181,
  -- now three pairs (service_cost, paid, conditions_budget).
  FOREACH key IN ARRAY ARRAY['service_cost','paid','conditions_budget'] LOOP
    amount:=NULLIF(p_fields->>(key||'_minor'),''); currency:=NULLIF(p_fields->>(key||'_currency'),'');
    IF (amount IS NULL)<>(currency IS NULL) OR (amount IS NOT NULL AND
      (amount !~ '^(0|[1-9][0-9]{0,12})$' OR amount::NUMERIC>1000000000000 OR currency NOT IN ('USD','EUR','KGS'))) THEN
      RAISE EXCEPTION 'lead_sale_conditions_invalid_money' USING ERRCODE='22023'; END IF;
    result:=result||jsonb_build_object(key||'_minor',amount::BIGINT,key||'_currency',currency);
  END LOOP;

  -- wishes_intake_year: a bare 4-digit calendar year, or empty.
  value:=NULLIF(btrim(coalesce(p_fields->>'wishes_intake_year','')),'');
  IF value IS NOT NULL AND value !~ '^(19|20|21)[0-9]{2}$' THEN
    RAISE EXCEPTION 'lead_sale_conditions_invalid_year' USING ERRCODE='22023'; END IF;
  result:=result||jsonb_build_object('wishes_intake_year',value);

  -- conditions_budget_period: a bounded named choice, or empty.
  value:=NULLIF(btrim(coalesce(p_fields->>'conditions_budget_period','')),'');
  IF value IS NOT NULL AND value NOT IN ('year','program') THEN
    RAISE EXCEPTION 'lead_sale_conditions_invalid_period' USING ERRCODE='22023'; END IF;
  result:=result||jsonb_build_object('conditions_budget_period',value);

  RETURN result;
END $$;

-- lead_sale_conditions_row/staff_lead_sale_conditions_v1: both must keep
-- reading cleanly for a HISTORICAL row saved before this migration (only the
-- 9 original keys stored) and for a lead with no row at all yet. Reusing the
-- validator itself as a defaults source (it already returns a full 26-key
-- object, blank/NULL, when given '{}') means both cases always read back
-- every key — no need to hand-list 26 keys twice.
CREATE OR REPLACE FUNCTION platform_private.lead_sale_conditions_row(p_row platform_private.lead_sale_conditions) RETURNS JSONB
LANGUAGE SQL STABLE SET search_path='' AS $$
 SELECT platform_private.lead_sale_condition_fields('{}'::JSONB)||p_row.fields||jsonb_build_object('lead_id',p_row.lead_id,'organization_id',p_row.organization_id,
   'revision',p_row.revision::TEXT,'updated_by_membership_id',p_row.updated_by_membership_id,'updated_at',p_row.updated_at)
$$;

CREATE OR REPLACE FUNCTION platform.staff_lead_sale_conditions_v1(p_organization_id UUID,p_lead_id UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE row platform_private.lead_sale_conditions%ROWTYPE; linked JSONB;
BEGIN
  IF p_lead_id IS NULL OR NOT private.platform_can_read_canonical_lead(p_organization_id,p_lead_id) THEN
    RAISE EXCEPTION 'lead_sale_conditions_forbidden' USING ERRCODE='42501'; END IF;
  SELECT jsonb_build_object('id',r.id,'report_month',r.report_month,'archived',r.archived) INTO linked
    FROM platform_private.sales_register r WHERE r.organization_id=p_organization_id AND r.lead_id=p_lead_id;
  SELECT * INTO row FROM platform_private.lead_sale_conditions c
    WHERE c.organization_id=p_organization_id AND c.lead_id=p_lead_id;
  IF NOT FOUND THEN
    RETURN platform_private.lead_sale_condition_fields('{}'::JSONB)||jsonb_build_object(
      'organization_id',p_organization_id,'lead_id',p_lead_id,'revision','0',
      'updated_by_membership_id',NULL,'updated_at',NULL,'linked_sales_register',linked);
  END IF;
  RETURN platform_private.lead_sale_conditions_row(row)||jsonb_build_object('linked_sales_register',linked);
END $$;

-- ---------------------------------------------------------------------------
-- b) student_cases_intake_origin_check: legalize the lead-cabinet shape, THEN
--    platform.prepare_lead_cabinet_v1 + platform.staff_lead_cabinet_case_v1
-- ---------------------------------------------------------------------------
-- Every existing disjunct stays exactly as 180 left it (historical rows and
-- every other origin stay legal); this adds a fourth: a lead-cabinet case
-- with an ownerless lead (responsible_sales_membership_id NULL — legal since
-- 176, and possible here exactly as it already is for a public-application
-- case approved by a non-Sales actor, 180). When the lead DOES have an owner,
-- the first disjunct already covers it regardless of source_key shape.
ALTER TABLE platform.student_cases
  DROP CONSTRAINT student_cases_intake_origin_check,
  ADD CONSTRAINT student_cases_intake_origin_check CHECK(
   responsible_sales_membership_id IS NOT NULL
   OR (
    public_application_id IS NULL
    AND source_key IS NOT DISTINCT FROM ('docs-intake:'||id::TEXT)
    AND canonical_client_id IS NOT NULL AND canonical_lead_id IS NULL
   )
   OR (
    public_application_id IS NOT NULL
    AND source_key IS NOT DISTINCT FROM ('public_student_application:'||public_application_id::TEXT)
    AND student_membership_id IS NOT NULL
   )
   OR (
    public_application_id IS NULL
    AND source_key IS NOT DISTINCT FROM ('lead-cabinet:'||canonical_lead_id::TEXT)
    AND canonical_lead_id IS NOT NULL AND student_membership_id IS NULL
   )
  );

CREATE FUNCTION platform.prepare_lead_cabinet_v1(p_organization_id UUID,p_request_id UUID,p_lead_id UUID) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor RECORD; owner_id UUID; client_id_value UUID; client_name TEXT; client_email TEXT;
  new_case UUID:=gen_random_uuid(); scope_id UUID:=gen_random_uuid();
  replay_shape JSONB; replayed JSONB; changed platform.student_cases%ROWTYPE; result JSONB;
BEGIN
  PERFORM platform_private.lock_p2d_request(p_request_id);
  IF p_lead_id IS NULL THEN RAISE EXCEPTION 'lead_cabinet_invalid_command' USING ERRCODE='22023'; END IF;
  SELECT a.* INTO actor FROM platform.current_actor_authority() a
    WHERE a.organization_id=p_organization_id AND a.platform_role IN ('admin','sales');
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

-- Companion read (see header): the «Подготовить кабинет» button's own
-- discoverability after a page reload, gated identically to
-- staff_lead_sale_conditions_v1 (181).
CREATE FUNCTION platform.staff_lead_cabinet_case_v1(p_organization_id UUID,p_lead_id UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE found_case RECORD;
BEGIN
  IF p_lead_id IS NULL OR NOT private.platform_can_read_canonical_lead(p_organization_id,p_lead_id) THEN
    RAISE EXCEPTION 'lead_cabinet_forbidden' USING ERRCODE='42501'; END IF;
  SELECT sc.id,sc.state INTO found_case FROM platform.student_cases sc
    WHERE sc.organization_id=p_organization_id
      AND (sc.canonical_lead_id=p_lead_id
        OR sc.canonical_client_id=(SELECT l.client_id FROM platform.leads l
            WHERE l.organization_id=p_organization_id AND l.id=p_lead_id)
        OR sc.canonical_lead_id IN (
          SELECT l2.id FROM platform.leads l2
          WHERE l2.organization_id=p_organization_id AND l2.client_id=(
            SELECT l.client_id FROM platform.leads l
            WHERE l.organization_id=p_organization_id AND l.id=p_lead_id)))
    ORDER BY sc.created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('student_case_id',found_case.id,'state',found_case.state::TEXT);
END $$;

REVOKE ALL ON FUNCTION platform.prepare_lead_cabinet_v1(UUID,UUID,UUID),
  platform.staff_lead_cabinet_case_v1(UUID,UUID)
  FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.prepare_lead_cabinet_v1(UUID,UUID,UUID),
  platform.staff_lead_cabinet_case_v1(UUID,UUID)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- c) platform_private.application_partner_detail_fields +
--    platform.update_application_partner_details_v1
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.application_partner_detail_fields(p_fields JSONB) RETURNS JSONB
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE result JSONB:='{}'::JSONB; key TEXT; value TEXT;
BEGIN
  IF p_fields IS NULL OR jsonb_typeof(p_fields)<>'object' OR pg_column_size(p_fields)>20000
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_fields) k WHERE k NOT IN
      ('partner_contact','external_link','decision_reference','decision_note')) THEN
    RAISE EXCEPTION 'application_partner_details_invalid_fields' USING ERRCODE='22023'; END IF;
  FOREACH key IN ARRAY ARRAY['partner_contact','external_link','decision_reference','decision_note'] LOOP
    IF p_fields ? key AND jsonb_typeof(p_fields->key) NOT IN ('string','null') THEN
      RAISE EXCEPTION 'application_partner_details_invalid_text' USING ERRCODE='22023'; END IF;
    value:=btrim(coalesce(p_fields->>key,''));
    IF length(value)>(CASE key WHEN 'partner_contact' THEN 300 WHEN 'decision_reference' THEN 300 ELSE 2000 END)
      OR value ~ '[\x01-\x08\x0b\x0c\x0e-\x1f]' THEN
      RAISE EXCEPTION 'application_partner_details_invalid_text' USING ERRCODE='22023'; END IF;
    IF key='external_link' AND value<>'' AND value !~ '^https://[^\s<>"]{1,1990}$' THEN
      RAISE EXCEPTION 'application_partner_details_invalid_link' USING ERRCODE='22023'; END IF;
    result:=result||jsonb_build_object(key,value);
  END LOOP;
  RETURN result;
END $$;

CREATE FUNCTION platform.update_application_partner_details_v1(
  p_organization_id UUID,p_request_id UUID,p_student_case_id UUID,p_university_application_id UUID,
  p_expected_version BIGINT,p_fields JSONB
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE preliminary_actor RECORD; actor RECORD; application_row platform.university_applications%ROWTYPE;
  target_student_case_id UUID; normalized JSONB; replay_shape JSONB; replayed JSONB; result JSONB;
  next_version BIGINT; changed_at TIMESTAMPTZ;
BEGIN
  PERFORM platform_private.lock_p2d_request(p_request_id);
  IF p_student_case_id IS NULL OR p_university_application_id IS NULL
    OR p_expected_version IS NULL OR p_expected_version<1 THEN
    RAISE EXCEPTION 'application_partner_details_invalid_command' USING ERRCODE='22023'; END IF;
  normalized:=platform_private.application_partner_detail_fields(p_fields);

  -- Cheap fail-fast before any lookup, mirroring 118's own
  -- private.platform_update_university_application_details ordering.
  SELECT * INTO preliminary_actor FROM platform_private.require_domain_actor(p_organization_id,'application.manage');

  SELECT application.student_case_id INTO target_student_case_id
    FROM platform.university_applications application
    WHERE application.organization_id=p_organization_id AND application.id=p_university_application_id;
  IF NOT FOUND OR target_student_case_id IS DISTINCT FROM p_student_case_id THEN
    RAISE EXCEPTION 'University application is unavailable' USING ERRCODE='42501'; END IF;

  -- Authoritative, scoped check on the application's OWN case — same
  -- STRONGEST-of-the-kept-CRUD gate as 118's details-update path. NO
  -- admissions_playbook_version_id requirement (see migration header).
  SELECT * INTO actor FROM platform_private.require_case_operator(p_organization_id,target_student_case_id,'application.manage');

  replay_shape:=jsonb_build_object('organization_id',p_organization_id,'student_case_id',p_student_case_id,
    'university_application_id',p_university_application_id,'fields',normalized,
    'expected_version',p_expected_version::TEXT,'actor_membership_id',actor.actor_membership_id);
  replayed:=platform_private.replay_audit(p_request_id,'application.partner.details.update','university_application',
    p_university_application_id,'Обновлены партнёрские и решенческие факты заявки',replay_shape);
  IF replayed IS NOT NULL THEN RETURN replayed; END IF;

  PERFORM 1 FROM platform.student_cases
    WHERE organization_id=p_organization_id AND id=p_student_case_id FOR UPDATE;
  SELECT * INTO application_row FROM platform.university_applications
    WHERE organization_id=p_organization_id AND id=p_university_application_id AND student_case_id=p_student_case_id
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'University application is unavailable' USING ERRCODE='42501'; END IF;
  IF application_row.version<>p_expected_version OR application_row.version=9223372036854775807 THEN
    RAISE EXCEPTION 'admissions_version_conflict' USING ERRCODE='PT409'; END IF;
  -- Re-check live authority after the case+application locks, exactly as
  -- 118's details-update path does: a concurrent curator reassignment or
  -- scope change between the first check and the locks must fail closed.
  SELECT * INTO actor FROM platform_private.require_case_operator(p_organization_id,target_student_case_id,'application.manage');

  -- jsonb concat: every OTHER existing key (legacy playbook-era camelCase
  -- facts, or anything else already stored) is preserved untouched.
  UPDATE platform.university_applications
    SET admissions_details=COALESCE(admissions_details,'{}'::JSONB)||normalized, version=version+1
    WHERE organization_id=p_organization_id AND id=p_university_application_id
    RETURNING version,updated_at INTO next_version,changed_at;

  result:=replay_shape||jsonb_build_object('version',next_version::TEXT,'changed_at',changed_at);
  INSERT INTO platform.audit_events(organization_id,actor_kind,actor_profile_id,actor_principal,action,resource_type,resource_id,after_state,reason,request_id)
    VALUES(p_organization_id,'user',actor.actor_profile_id,'auth:'||actor.actor_auth_user_id::TEXT,'application.partner.details.update',
      'university_application',p_university_application_id,result,'Обновлены партнёрские и решенческие факты заявки',p_request_id);
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION platform.update_application_partner_details_v1(UUID,UUID,UUID,UUID,BIGINT,JSONB)
  FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.update_application_partner_details_v1(UUID,UUID,UUID,UUID,BIGINT,JSONB) TO authenticated;

COMMENT ON FUNCTION platform.prepare_lead_cabinet_v1(UUID,UUID,UUID) IS
  'S7: prepares a pending, curator-less case for a lead with no account yet. Only prepares — invite dispatch stays the existing admin-gated 126 flow (see migration header for the documented shape gap).';
COMMENT ON FUNCTION platform.update_application_partner_details_v1(UUID,UUID,UUID,UUID,BIGINT,JSONB) IS
  'S7: partner_contact/external_link/decision_reference/decision_note on university_applications.admissions_details — no admissions_playbook_version_id requirement, unlike the retired 137 write path.';

-- Admin audit journal allowlist: expose both new actions (same
-- rename-and-replace pattern as 179/181).
ALTER FUNCTION platform_private.p7a_safe_audit_actions()
  RENAME TO p7a_safe_audit_actions_pre_card_fields_and_partner_details;
CREATE FUNCTION platform_private.p7a_safe_audit_actions()
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.array_agg(DISTINCT allowed.action ORDER BY allowed.action)
  FROM pg_catalog.unnest(
    platform_private.p7a_safe_audit_actions_pre_card_fields_and_partner_details()
      || ARRAY['lead.cabinet.prepare','application.partner.details.update']::TEXT[]
  ) AS allowed(action)
$$;
REVOKE ALL ON FUNCTION
  platform_private.p7a_safe_audit_actions_pre_card_fields_and_partner_details(),
  platform_private.p7a_safe_audit_actions()
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

COMMIT;
