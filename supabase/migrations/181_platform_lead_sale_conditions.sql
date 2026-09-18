-- Unified-workflow pivot, slice S2 «Карточка Sales и продажа в отчёте».
-- docs/EVO_UNIFIED_WORKFLOW_PLAN_2026-09-18.md (§5, §6, §13) + docs/PLAN_CHANGES.md
-- «план-контракт реализации» (2026-09-18) + «unified workflow S1» (S1's own entry).
--
-- Owner's last edit (plan §6): сумму, валюту, дату и оплату заполняют в
-- карточке; в отчёте выбирают только лида и куратора. This migration moves
-- sale-condition storage onto the lead card (new 1:1 table) and narrows
-- platform.create_sales_report_handoff to (org, request, lead, curator,
-- report_month?) — the register fields are now built from the card, not a
-- browser-submitted p_fields blob.
--
-- Sections:
--  a) platform_private.lead_sale_conditions: one row per lead, mutable with
--     an optimistic-concurrency `revision` (NOT append-only — it is a current-
--     state card block, same shape family as platform_private.sales_register
--     itself). platform_private.lead_sale_condition_fields() is a new
--     allowlist validator mirroring platform_private.sales_register_fields()
--     (134) conventions: same money-pair shape, same USD/EUR/KGS currencies,
--     same control-character/length guards. Its key set (service_label,
--     signing_date, service_cost_raw/minor/currency, paid_raw/minor/currency,
--     payment_note) intentionally does NOT overlap 1:1 with sales_register's
--     key set (e.g. no report_month/applicant_name/university/program on the
--     card) — (e) below maps card keys onto register keys explicitly.
--  b) platform.save_lead_sale_conditions_v1: upsert with optimistic
--     concurrency (p_expected_revision, 0 for the first save) and a payload-
--     bound request-id receipt table (platform_private.lead_sale_conditions_requests,
--     same append-only-receipt shape as every other domain in this codebase).
--     Permission gate mirrors the lead sales workflow writes: actor role
--     admin/sales, then platform_private.staff_can_access(...,
--     'lead.sales.workflow.manage','lead',p_lead_id) — the same scoped check
--     platform.create_sales_report_handoff already used per-lead.
--  c) platform.staff_lead_sale_conditions_v1: a read gated on
--     private.platform_can_read_canonical_lead (same lead-read authority the
--     S1 «Доступ к платформе» block already uses). Its result also carries
--     linked_sales_register (id/report_month/archived or null) so the card
--     can render «Продажа в отчёте за <месяц>» without a second round trip.
--  d) staff_can_access permission key check: 'lead.sales.workflow.manage' is
--     an existing key (088/134/174); no new permission is introduced.
--  e) platform.create_sales_report_handoff: DROP the old 8-argument creation
--     signature (organization/request/fields/reason/lead/curator/email/
--     direction) and CREATE the narrow 5-argument one the plan describes
--     (org, request, lead, curator, report_month DEFAULT NULL — defaulting to
--     the current Bishkek month, same "предзаполнить сегодняшний день" spirit
--     plan §6 asks for on the date, applied here to the month). The new
--     signature makes edit/archive/restore branches on
--     private.manage_sales_register_v1 (untouched here) the only surviving
--     mutation path for register rows created before this migration; new
--     rows are created exactly once, at report-save time, from the card's
--     conditions. p_lead_id is REQUIRED: the create-new-lead branch (and its
--     platform.create_manual_sales_lead call) is dropped entirely, per plan
--     §13 «Отдельная форма повторного ввода условий... убираем» — the report
--     always «выбирает существующего лида».
--     Inside: require platform_private.lead_sale_conditions for that lead
--     with service_cost present (error 'sale_conditions_missing', 22023,
--     so the UI can link back to the card block — plan §6 «ведём к
--     соответствующему блоку той же карточки»); build the register fields
--     payload by mapping card keys onto register keys (service_label ->
--     program — the closest existing register column to «услуга/пакет»;
--     payment_note -> notes; signing_date/service_cost_*/paid_* pass through
--     unchanged) plus applicant_name/phone from the canonical client and
--     report_month (provided or current Bishkek month).
--     THEN two paths (the S1 flag, documented in S1's own PLAN_CHANGES
--     deviation #2): if the lead already owns a platform.student_cases row
--     in state='pending' linked by canonical_lead_id (the S1 cabinet case
--     opened by access approval — see 180 section d), activate THAT case via
--     platform_private.assign_student_case_curator_authorized_e1 (126/177;
--     same authorized-actor curator-assignment path 177 already reuses for
--     an analogous "approve into an existing case" flow). Its own
--     pending->active UPDATE uses COALESCE on handoff_at/portal_activated_at
--     (042/126/177 — unchanged here), so the S1 approval timestamp already
--     in portal_activated_at is preserved and only handoff_at (still NULL
--     while pending, per the 088/180 state-shape CHECK) gets set now. That
--     path never touches platform.sales_admissions_handoffs (that table
--     specifically records the OTHER path, a Lead that had no case yet), so
--     platform.staff_student_case_handoff_context/staff_lead_admissions_handoff
--     legitimately return nothing for this branch's cases — the pending-
--     case's own student_case_lifecycle_events/student_case_assignment_events/
--     audit_events rows (all written by assign_student_case_curator_authorized_e1
--     itself) are its audit trail instead. Because no
--     sales_admissions_handoffs row exists yet for this branch, the AFTER
--     INSERT trigger that normally seeds the register's placeholder pipeline
--     row (134's sales_register_completed_handoff) never fires, so this
--     branch INSERTs the (already fully-populated, no placeholder needed)
--     sales_register row directly. Otherwise (no pending case): keep today's
--     create-case handoff path via platform_private.handoff_lead_to_admissions
--     (088/134, mode 'sales_report', unchanged) — that path's own AFTER
--     INSERT trigger seeds the placeholder pipeline row, which this function
--     then UPDATEs with the real fields, exactly as 174 did.
--     Replay semantics: the append-only receipt table
--     (platform_private.sales_report_handoff_requests, unchanged schema from
--     174) is reused as-is; only the fingerprint INPUT shape changes, from
--     174's 8-value shape (fields/reason/lead/curator/email/direction) to
--     this migration's 3-value shape (lead/curator/report_month). A
--     request_id minted before this deploy and retried after it would
--     recompute a fingerprint under the new formula that cannot match an old
--     stored row computed under the old formula (fail-closed
--     'sales_register_request_id_conflict', never a silently wrong replay);
--     in practice request ids are per-submission random UUIDs, so this is a
--     theoretical boundary note, not an expected operational case. A retry
--     of the SAME request_id under the NEW function is fully idempotent as
--     before (advisory-locked by (org,request_id), receipt-table short
--     circuit). The two internal sub-calls each derive their own stable
--     child request id via public.uuid_generate_v5(p_request_id, <tag>)
--     exactly as 174 already did for its own 'sales-report:handoff' child —
--     this migration adds the 'sales-report:assign' tag for the new
--     pending-case branch, so each sub-call is independently idempotent too
--     (both platform_private.handoff_lead_to_admissions and
--     assign_student_case_curator_authorized_e1 replay off their own request
--     ids).
--
-- Style: SECURITY DEFINER, SET search_path='', REVOKE/GRANT pairs, PT409
-- conflict codes (Supabase custom-error-code retry guidance, see 178), and
-- request-id replay via a private receipt table — exactly as 134/174/180.
BEGIN;

-- ---------------------------------------------------------------------------
-- a) platform_private.lead_sale_conditions + its allowlist validator
-- ---------------------------------------------------------------------------
CREATE TABLE platform_private.lead_sale_conditions (
  lead_id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES platform.organizations(id),
  fields JSONB NOT NULL CHECK (jsonb_typeof(fields)='object'),
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
  updated_by_membership_id UUID NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  FOREIGN KEY(organization_id,lead_id) REFERENCES platform.leads(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,updated_by_membership_id) REFERENCES platform.organization_memberships(organization_id,id)
);
CREATE INDEX lead_sale_conditions_org_idx ON platform_private.lead_sale_conditions(organization_id,updated_at DESC);
ALTER TABLE platform_private.lead_sale_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.lead_sale_conditions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform_private.lead_sale_conditions FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;

CREATE TABLE platform_private.lead_sale_conditions_requests (
  organization_id UUID NOT NULL REFERENCES platform.organizations(id), request_id UUID NOT NULL,
  actor_membership_id UUID NOT NULL, fingerprint TEXT NOT NULL, receipt JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY(organization_id,request_id)
);
ALTER TABLE platform_private.lead_sale_conditions_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.lead_sale_conditions_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform_private.lead_sale_conditions_requests FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
CREATE TRIGGER lead_sale_conditions_requests_append_only BEFORE UPDATE OR DELETE
  ON platform_private.lead_sale_conditions_requests FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();

-- Mirrors platform_private.sales_register_fields (134): same money-pair
-- shape/currencies, same control-character and length guards. Keys are the
-- card's own vocabulary (service_label/payment_note), not the register's.
CREATE FUNCTION platform_private.lead_sale_condition_fields(p_fields JSONB) RETURNS JSONB
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE result JSONB:='{}'::JSONB; key TEXT; value TEXT; amount TEXT; currency TEXT; date_value DATE;
BEGIN
  IF p_fields IS NULL OR jsonb_typeof(p_fields)<>'object' OR pg_column_size(p_fields)>20000
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_fields) k WHERE k NOT IN
      ('service_label','signing_date','service_cost_raw','service_cost_minor','service_cost_currency',
       'paid_raw','paid_minor','paid_currency','payment_note')) THEN
    RAISE EXCEPTION 'lead_sale_conditions_invalid_fields' USING ERRCODE='22023'; END IF;
  BEGIN date_value:=NULLIF(p_fields->>'signing_date','')::DATE;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'lead_sale_conditions_invalid_date' USING ERRCODE='22023'; END;
  IF date_value IS NOT NULL AND (date_value NOT BETWEEN DATE '1900-01-01' AND DATE '2100-12-31'
    OR (p_fields->>'signing_date') !~ '^(19|20|21)[0-9]{2}-[0-9]{2}-[0-9]{2}$') THEN
    RAISE EXCEPTION 'lead_sale_conditions_invalid_date' USING ERRCODE='22023'; END IF;
  result:=jsonb_build_object('signing_date',date_value);
  FOREACH key IN ARRAY ARRAY['service_label','payment_note'] LOOP
    IF p_fields ? key AND jsonb_typeof(p_fields->key) NOT IN ('string','null') THEN
      RAISE EXCEPTION 'lead_sale_conditions_invalid_text' USING ERRCODE='22023'; END IF;
    value:=btrim(coalesce(p_fields->>key,''));
    IF length(value)>(CASE key WHEN 'service_label' THEN 300 ELSE 2000 END)
      OR value ~ '[\x01-\x08\x0b\x0c\x0e-\x1f]' THEN
      RAISE EXCEPTION 'lead_sale_conditions_invalid_text' USING ERRCODE='22023'; END IF;
    result:=result||jsonb_build_object(key,value);
  END LOOP;
  FOREACH key IN ARRAY ARRAY['service_cost_raw','paid_raw'] LOOP
    IF p_fields ? key AND jsonb_typeof(p_fields->key) NOT IN ('string','null') THEN
      RAISE EXCEPTION 'lead_sale_conditions_invalid_text' USING ERRCODE='22023'; END IF;
    value:=btrim(coalesce(p_fields->>key,''));
    IF length(value)>300 OR value ~ '[\x01-\x08\x0b\x0c\x0e-\x1f]' THEN
      RAISE EXCEPTION 'lead_sale_conditions_invalid_text' USING ERRCODE='22023'; END IF;
    result:=result||jsonb_build_object(key,value);
  END LOOP;
  FOREACH key IN ARRAY ARRAY['service_cost','paid'] LOOP
    amount:=NULLIF(p_fields->>(key||'_minor'),''); currency:=NULLIF(p_fields->>(key||'_currency'),'');
    IF (amount IS NULL)<>(currency IS NULL) OR (amount IS NOT NULL AND
      (amount !~ '^(0|[1-9][0-9]{0,12})$' OR amount::NUMERIC>1000000000000 OR currency NOT IN ('USD','EUR','KGS'))) THEN
      RAISE EXCEPTION 'lead_sale_conditions_invalid_money' USING ERRCODE='22023'; END IF;
    result:=result||jsonb_build_object(key||'_minor',amount::BIGINT,key||'_currency',currency);
  END LOOP;
  RETURN result;
END $$;

CREATE FUNCTION platform_private.lead_sale_conditions_row(p_row platform_private.lead_sale_conditions) RETURNS JSONB
LANGUAGE SQL STABLE SET search_path='' AS $$
 SELECT p_row.fields||jsonb_build_object('lead_id',p_row.lead_id,'organization_id',p_row.organization_id,
   'revision',p_row.revision::TEXT,'updated_by_membership_id',p_row.updated_by_membership_id,'updated_at',p_row.updated_at)
$$;

-- ---------------------------------------------------------------------------
-- b) platform.save_lead_sale_conditions_v1: upsert, optimistic concurrency
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.save_lead_sale_conditions_v1(
  p_organization_id UUID,p_request_id UUID,p_lead_id UUID,p_expected_revision BIGINT,p_fields JSONB
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor RECORD; normalized JSONB; fingerprint TEXT; prior platform_private.lead_sale_conditions_requests%ROWTYPE;
  old platform_private.lead_sale_conditions%ROWTYPE; changed platform_private.lead_sale_conditions%ROWTYPE; receipt JSONB;
BEGIN
  SELECT a.* INTO actor FROM platform.current_actor_authority() a
    WHERE a.organization_id=p_organization_id AND a.platform_role IN ('admin','sales');
  IF NOT FOUND THEN RAISE EXCEPTION 'lead_sale_conditions_forbidden' USING ERRCODE='42501'; END IF;
  IF p_request_id IS NULL OR p_lead_id IS NULL OR p_expected_revision IS NULL
    OR p_expected_revision NOT BETWEEN 0 AND 9007199254740991 THEN
    RAISE EXCEPTION 'lead_sale_conditions_invalid_command' USING ERRCODE='22023'; END IF;
  normalized:=platform_private.lead_sale_condition_fields(p_fields);
  PERFORM pg_advisory_xact_lock(hashtextextended('lead-sale-conditions:'||p_organization_id::TEXT||':'||p_lead_id::TEXT,0));
  fingerprint:=md5(jsonb_build_object('actor',actor.membership_id,'lead',p_lead_id,
    'revision',p_expected_revision,'fields',p_fields)::TEXT);
  SELECT * INTO prior FROM platform_private.lead_sale_conditions_requests r
    WHERE r.organization_id=p_organization_id AND r.request_id=p_request_id;
  IF FOUND THEN
    IF prior.actor_membership_id<>actor.membership_id OR prior.fingerprint<>fingerprint THEN
      RAISE EXCEPTION 'lead_sale_conditions_request_id_conflict' USING ERRCODE='22023'; END IF;
    RETURN prior.receipt;
  END IF;
  IF NOT platform_private.staff_can_access(p_organization_id,actor.membership_id,'lead.sales.workflow.manage','lead',p_lead_id) THEN
    RAISE EXCEPTION 'lead_sale_conditions_forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO old FROM platform_private.lead_sale_conditions c
    WHERE c.organization_id=p_organization_id AND c.lead_id=p_lead_id FOR UPDATE;
  IF (old.lead_id IS NULL)<>(p_expected_revision=0) OR (old.lead_id IS NOT NULL AND old.revision<>p_expected_revision) THEN
    RAISE EXCEPTION 'lead_sale_conditions_stale' USING ERRCODE='PT409'; END IF;
  IF old.lead_id IS NULL THEN
    INSERT INTO platform_private.lead_sale_conditions(lead_id,organization_id,fields,revision,updated_by_membership_id)
      VALUES(p_lead_id,p_organization_id,normalized,1,actor.membership_id) RETURNING * INTO changed;
  ELSE
    UPDATE platform_private.lead_sale_conditions SET fields=normalized,revision=revision+1,
      updated_by_membership_id=actor.membership_id,updated_at=statement_timestamp()
      WHERE organization_id=p_organization_id AND lead_id=p_lead_id RETURNING * INTO changed;
  END IF;
  receipt:=platform_private.lead_sale_conditions_row(changed);
  INSERT INTO platform_private.lead_sale_conditions_requests(organization_id,request_id,actor_membership_id,fingerprint,receipt)
    VALUES(p_organization_id,p_request_id,actor.membership_id,fingerprint,receipt);
  INSERT INTO platform.audit_events(organization_id,actor_kind,actor_profile_id,actor_principal,action,resource_type,resource_id,after_state,reason,request_id)
    VALUES(p_organization_id,'user',actor.profile_id,'auth:'||actor.auth_user_id::TEXT,'lead.sale.conditions.save','lead',p_lead_id,
      jsonb_build_object('revision',changed.revision::TEXT),'Sale conditions saved on the lead card',p_request_id);
  RETURN receipt;
END $$;

-- ---------------------------------------------------------------------------
-- c) platform.staff_lead_sale_conditions_v1: read, gated on lead read
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.staff_lead_sale_conditions_v1(p_organization_id UUID,p_lead_id UUID) RETURNS JSONB
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
    RETURN jsonb_build_object('organization_id',p_organization_id,'lead_id',p_lead_id,'revision','0',
      'service_label','','signing_date',NULL,'service_cost_raw','','service_cost_minor',NULL,'service_cost_currency',NULL,
      'paid_raw','','paid_minor',NULL,'paid_currency',NULL,'payment_note','','updated_by_membership_id',NULL,'updated_at',NULL,
      'linked_sales_register',linked);
  END IF;
  RETURN platform_private.lead_sale_conditions_row(row)||jsonb_build_object('linked_sales_register',linked);
END $$;

REVOKE ALL ON FUNCTION platform.save_lead_sale_conditions_v1(UUID,UUID,UUID,BIGINT,JSONB),
  platform.staff_lead_sale_conditions_v1(UUID,UUID)
  FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.save_lead_sale_conditions_v1(UUID,UUID,UUID,BIGINT,JSONB),
  platform.staff_lead_sale_conditions_v1(UUID,UUID)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- e) platform.create_sales_report_handoff: narrow to (org, request, lead,
--    curator, report_month?); conditions come from the card, never the form.
-- ---------------------------------------------------------------------------
DROP FUNCTION platform.create_sales_report_handoff(UUID,UUID,JSONB,TEXT,UUID,UUID,TEXT,TEXT);

CREATE FUNCTION platform.create_sales_report_handoff(
  p_organization_id UUID,p_request_id UUID,p_lead_id UUID,p_curator_membership_id UUID,p_report_month DATE DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor RECORD; conditions platform_private.lead_sale_conditions%ROWTYPE; fingerprint TEXT;
  prior platform_private.sales_report_handoff_requests%ROWTYPE; owner_id UUID; client_id_value UUID;
  selected_gate_version BIGINT; sale platform_private.sales_register%ROWTYPE; receipt JSONB; case_id UUID;
  canonical_name TEXT; canonical_phone TEXT; report_month_value DATE; fields JSONB; normalized JSONB;
  pending_case platform.student_cases%ROWTYPE; command_reason TEXT:='Sale saved from the report'; source_snapshot JSONB;
BEGIN
  SELECT * INTO actor FROM platform_private.sales_register_actor(p_organization_id);
  IF NOT platform_private.staff_has_permission(p_organization_id,actor.membership_id,'sales.register.manage')
    OR NOT platform_private.staff_has_permission(p_organization_id,actor.membership_id,'lead.sales.workflow.manage') THEN
    RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501'; END IF;
  IF p_request_id IS NULL OR p_lead_id IS NULL OR p_curator_membership_id IS NULL
    OR (p_report_month IS NOT NULL AND (extract(day FROM p_report_month)<>1
      OR p_report_month NOT BETWEEN DATE '1900-01-01' AND DATE '2100-12-01')) THEN
    RAISE EXCEPTION 'sales_register_invalid_command' USING ERRCODE='22023'; END IF;
  report_month_value:=coalesce(p_report_month,date_trunc('month',statement_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE);
  -- Serialize first by request, then by canonical lead. The report trigger owns
  -- the report lock; never acquire it before the lead lock (opposite handoff path).
  PERFORM pg_advisory_xact_lock(hashtextextended('sales-report-request:'||p_organization_id::TEXT||':'||p_request_id::TEXT,0));
  fingerprint:=md5(jsonb_build_object('lead',p_lead_id,'curator',p_curator_membership_id,'report_month',report_month_value)::TEXT);
  SELECT * INTO prior FROM platform_private.sales_report_handoff_requests r
    WHERE r.organization_id=p_organization_id AND r.request_id=p_request_id;
  IF FOUND THEN
    IF prior.actor_membership_id<>actor.membership_id OR prior.fingerprint<>fingerprint THEN
      RAISE EXCEPTION 'sales_register_request_id_conflict' USING ERRCODE='22023'; END IF;
    IF NOT platform_private.staff_can_access(p_organization_id,actor.membership_id,'sales.register.manage','sales_register',
      (prior.receipt->>'record_id')::UUID) THEN RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501'; END IF;
    RETURN prior.receipt;
  END IF;
  IF NOT platform_private.staff_can_access(p_organization_id,actor.membership_id,'lead.sales.workflow.manage','lead',p_lead_id) THEN
    RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::TEXT||':u6:'||p_lead_id::TEXT,0));
  SELECT c.display_name,CASE WHEN length(c.phone)<=100 THEN c.phone ELSE c.normalized_phone END,
    l.current_owner_membership_id,l.client_id
    INTO canonical_name,canonical_phone,owner_id,client_id_value
    FROM platform.leads l JOIN platform.clients c ON c.organization_id=l.organization_id AND c.id=l.client_id
    WHERE l.organization_id=p_organization_id AND l.id=p_lead_id AND l.lifecycle_state='open' AND c.lifecycle_state='active'
    FOR UPDATE OF l,c;
  IF NOT FOUND OR owner_id IS NULL THEN RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM platform_private.sales_register r WHERE r.organization_id=p_organization_id AND r.lead_id=p_lead_id)
    OR EXISTS(SELECT 1 FROM platform.sales_admissions_handoffs h WHERE h.organization_id=p_organization_id AND h.lead_id=p_lead_id) THEN
    RAISE EXCEPTION 'sales_register_already_transferred' USING ERRCODE='PT409'; END IF;
  -- Условия продажи живут на карточке (plan §6); отчёт их не переспрашивает.
  SELECT * INTO conditions FROM platform_private.lead_sale_conditions c
    WHERE c.organization_id=p_organization_id AND c.lead_id=p_lead_id FOR UPDATE;
  IF NOT FOUND OR conditions.fields->>'service_cost_minor' IS NULL THEN
    RAISE EXCEPTION 'sale_conditions_missing' USING ERRCODE='22023'; END IF;
  fields:=jsonb_build_object('report_month',report_month_value,'signing_date',conditions.fields->>'signing_date',
    'applicant_name',left(btrim(canonical_name),300),'phone',canonical_phone,'program',conditions.fields->>'service_label',
    'notes',conditions.fields->>'payment_note','service_cost_raw',conditions.fields->>'service_cost_raw',
    'service_cost_minor',conditions.fields->>'service_cost_minor','service_cost_currency',conditions.fields->>'service_cost_currency',
    'paid_raw',conditions.fields->>'paid_raw','paid_minor',conditions.fields->>'paid_minor','paid_currency',conditions.fields->>'paid_currency');
  normalized:=platform_private.sales_register_fields(fields);
  -- One person, one card (S1 flag): a lead may already own a pending,
  -- portal-activated, curator-less case opened by cabinet approval. Activate
  -- THAT case instead of colliding with student_cases_one_open_case_per_
  -- canonical_lead_idx (088) by inserting a second one for the same lead.
  SELECT * INTO pending_case FROM platform.student_cases sc
    WHERE sc.organization_id=p_organization_id AND sc.canonical_lead_id=p_lead_id AND sc.state='pending' FOR UPDATE;
  IF FOUND THEN
    PERFORM platform_private.assign_student_case_curator_authorized_e1(p_organization_id,pending_case.id,p_curator_membership_id,
      command_reason,public.uuid_generate_v5(p_request_id,'sales-report:assign'),actor.profile_id,actor.membership_id,actor.auth_user_id);
    case_id:=pending_case.id;
    -- No platform.sales_admissions_handoffs row exists for this branch (that
    -- table is the OTHER path's evidence), so its AFTER INSERT trigger never
    -- fires here: insert the already fully-populated pipeline row directly.
    source_snapshot:=jsonb_build_object('activation','pending_case','student_case_id',case_id);
    INSERT INTO platform_private.sales_register(organization_id,report_month,owner_membership_id,source_kind,lead_id,client_id,fields,source_snapshot)
      VALUES(p_organization_id,report_month_value,owner_id,'pipeline',p_lead_id,client_id_value,normalized,source_snapshot)
      RETURNING * INTO sale;
  ELSE
    SELECT g.gate_version INTO selected_gate_version FROM platform.lead_admissions_gates g
      WHERE g.organization_id=p_organization_id AND g.lead_id=p_lead_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'sales_register_gate_missing' USING ERRCODE='22023'; END IF;
    PERFORM platform_private.handoff_lead_to_admissions(p_lead_id,selected_gate_version,p_curator_membership_id,'sales_report',
      command_reason,public.uuid_generate_v5(p_request_id,'sales-report:handoff'));
    SELECT h.student_case_id INTO STRICT case_id FROM platform.sales_admissions_handoffs h
      WHERE h.organization_id=p_organization_id AND h.lead_id=p_lead_id;
    -- The canonical handoff trigger already inserted exactly one pipeline row.
    UPDATE platform_private.sales_register r SET report_month=report_month_value,owner_membership_id=owner_id,
      fields=normalized,updated_at=now() WHERE r.organization_id=p_organization_id AND r.lead_id=p_lead_id RETURNING r.* INTO STRICT sale;
  END IF;
  receipt:=jsonb_build_object('organization_id',p_organization_id,'operation','create','record_id',sale.id,
    'version',sale.version::TEXT,'request_id',p_request_id,'student_case_id',case_id,'curator_membership_id',p_curator_membership_id);
  INSERT INTO platform_private.sales_report_handoff_requests(organization_id,request_id,actor_membership_id,fingerprint,receipt)
    VALUES(p_organization_id,p_request_id,actor.membership_id,fingerprint,receipt);
  INSERT INTO platform.audit_events(organization_id,actor_kind,actor_profile_id,actor_principal,action,resource_type,resource_id,after_state,reason,request_id)
    VALUES(p_organization_id,'user',actor.profile_id,'auth:'||actor.auth_user_id::TEXT,'sales.register.create','sales_register',sale.id,
      jsonb_build_object('version',sale.version::TEXT,'lead_id',p_lead_id,'student_case_id',case_id,'curator_membership_id',p_curator_membership_id),
      'Report sale with immediate Admissions assignment',p_request_id);
  RETURN receipt;
END $$;

REVOKE ALL ON FUNCTION platform.create_sales_report_handoff(UUID,UUID,UUID,UUID,DATE)
  FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.create_sales_report_handoff(UUID,UUID,UUID,UUID,DATE) TO authenticated;

COMMENT ON TABLE platform_private.lead_sale_conditions IS
  'Unified workflow S2: one mutable sale-conditions block per lead card (revision-versioned), filling it never adds a report row.';
COMMENT ON FUNCTION platform.create_sales_report_handoff(UUID,UUID,UUID,UUID,DATE) IS
  'S2 narrow report save: choose an existing lead + curator; register fields are built from the lead card conditions.';

COMMIT;
