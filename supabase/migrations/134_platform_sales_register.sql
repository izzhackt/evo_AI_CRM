-- One canonical reporting register; no customer, case or payment-evidence writes.
-- https://supabase.com/docs/guides/database/functions
-- https://supabase.com/docs/guides/api/securing-your-api
BEGIN;

CREATE TABLE platform_private.sales_register (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations(id),
  version BIGINT NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 9007199254740991),
  report_month DATE NOT NULL CHECK (extract(day FROM report_month)=1 AND report_month BETWEEN DATE '1900-01-01' AND DATE '2100-12-01'),
  owner_membership_id UUID,
  source_kind TEXT NOT NULL DEFAULT 'manual' CHECK(source_kind IN ('manual','import','pipeline')),
  lead_id UUID, client_id UUID,
  fields JSONB NOT NULL CHECK (jsonb_typeof(fields)='object'),
  archived BOOLEAN NOT NULL DEFAULT false,
  source_key TEXT CHECK (length(source_key) BETWEEN 1 AND 400),
  source_sha256 TEXT CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  source_sheet TEXT CHECK (length(source_sheet) BETWEEN 1 AND 150),
  source_row INTEGER CHECK (source_row BETWEEN 1 AND 100000),
  source_snapshot JSONB,
  source_fingerprint TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id), UNIQUE (organization_id,source_key), UNIQUE(organization_id,lead_id),
  FOREIGN KEY(organization_id,client_id,lead_id) REFERENCES platform.leads(organization_id,client_id,id),
  CHECK ((source_kind='pipeline' AND lead_id IS NOT NULL AND client_id IS NOT NULL) OR (source_kind<>'pipeline' AND lead_id IS NULL AND client_id IS NULL)),
  CHECK ((source_kind='import')=(source_key IS NOT NULL)),
  FOREIGN KEY (organization_id,owner_membership_id) REFERENCES platform.organization_memberships(organization_id,id),
  CHECK ((source_key IS NULL AND source_sha256 IS NULL AND source_sheet IS NULL AND source_row IS NULL AND source_fingerprint IS NULL
      AND ((source_kind='pipeline' AND source_snapshot IS NOT NULL AND jsonb_typeof(source_snapshot)='object') OR (source_kind='manual' AND source_snapshot IS NULL)))
    OR (source_key IS NOT NULL AND source_sha256 IS NOT NULL AND source_sheet IS NOT NULL AND source_row IS NOT NULL AND source_snapshot IS NOT NULL AND source_fingerprint IS NOT NULL))
);
CREATE INDEX sales_register_period ON platform_private.sales_register(organization_id,archived,report_month DESC,id);
CREATE INDEX sales_register_owner_period ON platform_private.sales_register(organization_id,owner_membership_id,archived,report_month DESC,id);
CREATE TABLE platform_private.sales_register_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES platform.organizations(id),
  version BIGINT NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 9007199254740991),
  report_month DATE NOT NULL CHECK (extract(day FROM report_month)=1 AND report_month BETWEEN DATE '1900-01-01' AND DATE '2100-12-01'),
  manager_label TEXT CHECK (length(manager_label) BETWEEN 1 AND 300),
  target_count INTEGER NOT NULL CHECK (target_count BETWEEN 0 AND 1000000),
  source_key TEXT, source_sha256 TEXT, source_fingerprint TEXT,
  UNIQUE(organization_id,source_key)
);
CREATE UNIQUE INDEX sales_register_target_month ON platform_private.sales_register_targets(organization_id,report_month,coalesce(manager_label,''));
CREATE TABLE platform_private.sales_register_requests (
  organization_id UUID NOT NULL REFERENCES platform.organizations(id), request_id UUID NOT NULL,
  actor_membership_id UUID NOT NULL, fingerprint TEXT NOT NULL, receipt JSONB NOT NULL,
  reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
  PRIMARY KEY(organization_id,request_id)
);
ALTER TABLE platform_private.sales_register ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.sales_register FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.sales_register_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.sales_register_targets FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.sales_register_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.sales_register_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform_private.sales_register,platform_private.sales_register_targets,platform_private.sales_register_requests
  FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;

CREATE FUNCTION platform_private.sales_register_actor(p_organization_id UUID)
RETURNS TABLE(auth_user_id UUID,profile_id UUID,membership_id UUID,platform_role platform.business_role)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  RETURN QUERY SELECT a.auth_user_id,a.profile_id,a.membership_id,a.platform_role
    FROM platform.current_actor_authority() a
    WHERE a.organization_id=p_organization_id AND a.platform_role IN ('admin','sales');
  IF NOT FOUND THEN RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501'; END IF;
END $$;

CREATE FUNCTION platform_private.sales_register_fields(p_fields JSONB,p_allow_unknown_applicant BOOLEAN DEFAULT false) RETURNS JSONB
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE result JSONB:='{}'::JSONB; key TEXT; value TEXT; amount TEXT; currency TEXT; month_value DATE; date_value DATE;
BEGIN
  IF p_fields IS NULL OR jsonb_typeof(p_fields)<>'object' OR pg_column_size(p_fields)>40000
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_fields) k WHERE k NOT IN
      ('report_month','signing_date','applicant_name','phone','country','university','program','direction','intake',
       'contract_number','manager_label','status_raw','owner_membership_id','service_cost_raw','service_cost_minor',
       'service_cost_currency','paid_raw','paid_minor','paid_currency','needs_review','notes')) THEN
    RAISE EXCEPTION 'sales_register_invalid_fields' USING ERRCODE='22023'; END IF;
  IF coalesce(p_fields->>'report_month','') !~ '^(19|20|21)[0-9]{2}-[0-9]{2}-01$' THEN
    RAISE EXCEPTION 'sales_register_invalid_month' USING ERRCODE='22023'; END IF;
  BEGIN
    month_value:=(p_fields->>'report_month')::DATE;
    date_value:=NULLIF(p_fields->>'signing_date','')::DATE;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'sales_register_invalid_date' USING ERRCODE='22023'; END;
  IF month_value NOT BETWEEN DATE '1900-01-01' AND DATE '2100-12-01' OR
    (date_value IS NOT NULL AND (date_value NOT BETWEEN DATE '1900-01-01' AND DATE '2100-12-31'
      OR (p_fields->>'signing_date') !~ '^(19|20|21)[0-9]{2}-[0-9]{2}-[0-9]{2}$')) THEN
    RAISE EXCEPTION 'sales_register_invalid_date' USING ERRCODE='22023'; END IF;
  result:=jsonb_build_object('signing_date',date_value);
  FOREACH key IN ARRAY ARRAY['applicant_name','phone','country','university','program','direction','intake',
    'contract_number','manager_label','status_raw','service_cost_raw','paid_raw','notes'] LOOP
    IF p_fields ? key AND jsonb_typeof(p_fields->key) NOT IN ('string','null') THEN
      RAISE EXCEPTION 'sales_register_invalid_text' USING ERRCODE='22023'; END IF;
    value:=btrim(coalesce(p_fields->>key,''));
    IF length(value)>(CASE key WHEN 'applicant_name' THEN 300 WHEN 'phone' THEN 100 WHEN 'country' THEN 200
      WHEN 'university' THEN 500 WHEN 'program' THEN 500 WHEN 'direction' THEN 500 WHEN 'intake' THEN 200
      WHEN 'contract_number' THEN 200 WHEN 'manager_label' THEN 300 ELSE 2000 END)
      OR value ~ '[\x01-\x08\x0b\x0c\x0e-\x1f]' OR (key='applicant_name' AND value='' AND p_allow_unknown_applicant IS DISTINCT FROM true) THEN
      RAISE EXCEPTION 'sales_register_invalid_text' USING ERRCODE='22023'; END IF;
    result:=result||jsonb_build_object(key,value);
  END LOOP;
  FOREACH key IN ARRAY ARRAY['service_cost','paid'] LOOP
    amount:=NULLIF(p_fields->>(key||'_minor'),''); currency:=NULLIF(p_fields->>(key||'_currency'),'');
    IF (amount IS NULL)<>(currency IS NULL) OR (amount IS NOT NULL AND
      (amount !~ '^(0|[1-9][0-9]{0,12})$' OR amount::NUMERIC>1000000000000 OR currency NOT IN ('USD','EUR','KGS'))) THEN
      RAISE EXCEPTION 'sales_register_invalid_money' USING ERRCODE='22023'; END IF;
    result:=result||jsonb_build_object(key||'_minor',amount::BIGINT,key||'_currency',currency);
  END LOOP;
  IF p_fields ? 'needs_review' AND jsonb_typeof(p_fields->'needs_review')<>'boolean' THEN
    RAISE EXCEPTION 'sales_register_invalid_review' USING ERRCODE='22023'; END IF;
  RETURN result||jsonb_build_object('needs_review',coalesce((p_fields->>'needs_review')::BOOLEAN,false)
    OR date_value IS NULL OR result->>'service_cost_minor' IS NULL OR result->>'paid_minor' IS NULL);
END $$;

CREATE FUNCTION platform_private.sales_register_row(p_row platform_private.sales_register) RETURNS JSONB
LANGUAGE SQL STABLE SET search_path='' AS $$
 SELECT p_row.fields||jsonb_build_object('id',p_row.id,'version',p_row.version::TEXT,'report_month',p_row.report_month,
   'owner_membership_id',p_row.owner_membership_id,'archived',p_row.archived,'source_kind',p_row.source_kind,'lead_id',p_row.lead_id,'client_id',p_row.client_id,'source_key',p_row.source_key,
   'source_sha256',p_row.source_sha256,'source_sheet',p_row.source_sheet,'source_row',p_row.source_row,'updated_at',p_row.updated_at)
$$;

CREATE FUNCTION private.manage_sales_register_v1(p_organization_id UUID,p_operation TEXT,p_record_id UUID,
 p_expected_version BIGINT,p_fields JSONB,p_reason TEXT,p_request_id UUID) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor RECORD; old platform_private.sales_register%ROWTYPE; changed platform_private.sales_register%ROWTYPE;
 normalized_fields JSONB; owner_id UUID; fingerprint TEXT; prior platform_private.sales_register_requests%ROWTYPE; receipt JSONB; target_id UUID;
BEGIN
 SELECT * INTO actor FROM platform_private.sales_register_actor(p_organization_id);
 IF p_request_id IS NULL OR p_operation IS NULL OR p_operation NOT IN ('create','update','archive','restore')
   OR p_expected_version IS NULL OR p_expected_version<0 OR p_expected_version>9007199254740991
   OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 1000
   OR ((p_operation='create')<>(p_record_id IS NULL)) OR (p_operation='create' AND p_expected_version<>0)
   OR (p_operation<>'create' AND p_expected_version<1) THEN
   RAISE EXCEPTION 'sales_register_invalid_command' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sales-register:'||p_organization_id::TEXT,0));
 SELECT * INTO actor FROM platform_private.sales_register_actor(p_organization_id);
 fingerprint:=md5(jsonb_build_object('actor',actor.membership_id,'operation',p_operation,'record',p_record_id,
   'version',p_expected_version,'fields',p_fields,'reason',p_reason)::TEXT);
 SELECT * INTO prior FROM platform_private.sales_register_requests WHERE organization_id=p_organization_id AND request_id=p_request_id;
 IF FOUND THEN
   IF prior.fingerprint<>fingerprint OR prior.actor_membership_id<>actor.membership_id THEN
     RAISE EXCEPTION 'sales_register_request_id_conflict' USING ERRCODE='22023'; END IF;
   -- Ownership may change after a successful command; do not replay foreign details.
   IF actor.platform_role='sales' AND NOT EXISTS(SELECT 1 FROM platform_private.sales_register r
     WHERE r.id=(prior.receipt->>'record_id')::UUID AND r.organization_id=p_organization_id AND r.owner_membership_id=actor.membership_id) THEN
     RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501'; END IF;
   RETURN prior.receipt;
 END IF;
 IF p_operation<>'create' THEN
   SELECT * INTO old FROM platform_private.sales_register WHERE organization_id=p_organization_id AND id=p_record_id FOR UPDATE;
   IF NOT FOUND OR (actor.platform_role='sales' AND old.owner_membership_id IS DISTINCT FROM actor.membership_id) THEN
     RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501'; END IF;
   IF old.version<>p_expected_version THEN RAISE EXCEPTION 'sales_register_stale' USING ERRCODE='PT409'; END IF;
 END IF;
 IF p_operation IN ('create','update') THEN
   normalized_fields:=platform_private.sales_register_fields(p_fields);
   BEGIN owner_id:=NULLIF(p_fields->>'owner_membership_id','')::UUID;
   EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'sales_register_invalid_owner' USING ERRCODE='22023'; END;
   IF actor.platform_role='sales' THEN
     IF owner_id IS NOT NULL AND owner_id<>actor.membership_id THEN RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501'; END IF;
     owner_id:=actor.membership_id;
   END IF;
   IF owner_id IS NOT NULL AND NOT platform_private.is_eligible_sales_owner(p_organization_id,owner_id) THEN
     RAISE EXCEPTION 'sales_register_invalid_owner' USING ERRCODE='22023'; END IF;
 END IF;
 IF p_operation='create' THEN
   INSERT INTO platform_private.sales_register(organization_id,report_month,owner_membership_id,fields)
     VALUES(p_organization_id,(p_fields->>'report_month')::DATE,owner_id,normalized_fields) RETURNING * INTO changed;
 ELSIF p_operation='update' THEN
   IF old.archived THEN RAISE EXCEPTION 'sales_register_archived' USING ERRCODE='22023'; END IF;
   UPDATE platform_private.sales_register SET report_month=(p_fields->>'report_month')::DATE,owner_membership_id=owner_id,
     fields=normalized_fields,version=version+1,updated_at=now() WHERE id=old.id RETURNING * INTO changed;
 ELSE
   IF p_fields IS DISTINCT FROM '{}'::JSONB OR old.archived=(p_operation='archive') THEN
     RAISE EXCEPTION 'sales_register_invalid_archive' USING ERRCODE='22023'; END IF;
   UPDATE platform_private.sales_register SET archived=(p_operation='archive'),version=version+1,updated_at=now()
     WHERE id=old.id RETURNING * INTO changed;
 END IF;
 target_id:=changed.id;
 receipt:=jsonb_build_object('organization_id',p_organization_id,'record_id',target_id,'version',changed.version::TEXT,
   'operation',p_operation,'request_id',p_request_id);
 -- Preserve the human explanation privately; shared audit projections receive no free text.
 INSERT INTO platform_private.sales_register_requests VALUES(p_organization_id,p_request_id,actor.membership_id,fingerprint,receipt,btrim(p_reason));
 INSERT INTO platform.audit_events(organization_id,actor_kind,actor_profile_id,actor_principal,action,resource_type,resource_id,before_state,after_state,reason,request_id)
 VALUES(p_organization_id,'user',actor.profile_id,'auth:'||actor.auth_user_id::TEXT,'sales.register.'||p_operation,'sales_register',target_id,
   CASE WHEN p_operation='create' THEN NULL ELSE jsonb_build_object('version',old.version::TEXT,'archived',old.archived) END,
   jsonb_build_object('version',changed.version::TEXT,'archived',changed.archived),'Sales register command',p_request_id);
 RETURN receipt;
END $$;

CREATE FUNCTION private.read_sales_register_v1(p_organization_id UUID,p_year INTEGER,p_month INTEGER DEFAULT NULL,
 p_offset INTEGER DEFAULT 0,p_record_id UUID DEFAULT NULL,p_archived BOOLEAN DEFAULT false) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor RECORD; selected JSONB:=NULL; rows JSONB; total BIGINT; totals JSONB; targets JSONB; labels JSONB; owners JSONB;
 unresolved_cost BIGINT; unresolved_paid BIGINT; first_month DATE; last_month DATE;
BEGIN
 SELECT * INTO actor FROM platform_private.sales_register_actor(p_organization_id);
 IF p_year IS NULL OR p_year NOT BETWEEN 1900 AND 2100 OR (p_month IS NOT NULL AND p_month NOT BETWEEN 1 AND 12)
   OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 1000000 OR p_archived IS NULL THEN
   RAISE EXCEPTION 'sales_register_invalid_filter' USING ERRCODE='22023'; END IF;
 first_month:=make_date(p_year,coalesce(p_month,1),1);
 last_month:=CASE WHEN p_month IS NULL THEN make_date(p_year,12,1) ELSE first_month END;
 IF p_record_id IS NOT NULL THEN
   SELECT platform_private.sales_register_row(r) INTO selected FROM platform_private.sales_register r
     WHERE r.organization_id=p_organization_id AND r.id=p_record_id AND (actor.platform_role='admin' OR r.owner_membership_id=actor.membership_id);
   IF NOT FOUND THEN RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501'; END IF;
 END IF;
 WITH filtered AS MATERIALIZED (SELECT r.* FROM platform_private.sales_register r WHERE r.organization_id=p_organization_id
   AND (actor.platform_role='admin' OR r.owner_membership_id=actor.membership_id) AND r.archived=p_archived
   AND r.report_month BETWEEN first_month AND last_month)
 SELECT (SELECT count(*) FROM filtered),
   coalesce((SELECT jsonb_agg(platform_private.sales_register_row(page::platform_private.sales_register) ORDER BY page.report_month DESC,page.id) FROM
      (SELECT * FROM filtered ORDER BY report_month DESC,id LIMIT 50 OFFSET p_offset) page),'[]'),
   (SELECT count(*) FROM filtered WHERE fields->>'service_cost_minor' IS NULL),
   (SELECT count(*) FROM filtered WHERE fields->>'paid_minor' IS NULL),
   coalesce((SELECT jsonb_agg(jsonb_build_object('currency',currency,'cost_minor',cost_minor::TEXT,'paid_minor',paid_minor::TEXT) ORDER BY currency)
     FROM (SELECT currency,sum(cost_minor) cost_minor,sum(paid_minor) paid_minor FROM (
       SELECT fields->>'service_cost_currency' currency,(fields->>'service_cost_minor')::BIGINT cost_minor,0::BIGINT paid_minor FROM filtered WHERE fields->>'service_cost_minor' IS NOT NULL
       UNION ALL SELECT fields->>'paid_currency',0::BIGINT,(fields->>'paid_minor')::BIGINT FROM filtered WHERE fields->>'paid_minor' IS NOT NULL) amounts GROUP BY currency) sums),'[]')
 INTO total,rows,unresolved_cost,unresolved_paid,totals;
 -- Archived rows can be inspected, but never contribute to active report totals.
 IF p_archived THEN totals:='[]'; unresolved_cost:=0; unresolved_paid:=0; END IF;
 SELECT coalesce(jsonb_agg(label ORDER BY label),'[]') INTO labels FROM (SELECT DISTINCT r.fields->>'manager_label' label
   FROM platform_private.sales_register r WHERE r.organization_id=p_organization_id AND (actor.platform_role='admin' OR r.owner_membership_id=actor.membership_id)
   AND r.fields->>'manager_label'<>'' LIMIT 1000) label_rows;
 IF actor.platform_role='admin' THEN
   SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.id,'version',t.version::TEXT,'report_month',t.report_month,
     'manager_label',t.manager_label,'target_count',t.target_count) ORDER BY t.report_month,t.manager_label),'[]') INTO targets
     FROM platform_private.sales_register_targets t WHERE t.organization_id=p_organization_id AND t.report_month BETWEEN first_month AND last_month;
 ELSE targets:='[]'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'label',left(btrim(regexp_replace(coalesce(p.display_name,''),'[[:cntrl:]]',' ','g')),300)) ORDER BY p.display_name,m.id),'[]') INTO owners
 FROM platform.organization_memberships m JOIN platform.profiles p ON p.id=m.profile_id
 WHERE m.organization_id=p_organization_id AND platform_private.is_eligible_sales_owner(p_organization_id,m.id)
   AND (actor.platform_role='admin' OR m.id=actor.membership_id);
 RETURN jsonb_build_object('organization_id',p_organization_id,'year',p_year,'month',p_month,'offset',p_offset,
   'total_count',total,'rows',rows,'selected',selected,'has_more',p_offset+50<total,'totals',totals,
   'unresolved_cost_count',unresolved_cost,'unresolved_paid_count',unresolved_paid,'targets',targets,'manager_labels',labels,'owner_options',owners);
END $$;

CREATE FUNCTION private.import_sales_register_v1(p_organization_id UUID,p_request_id UUID,p_payload JSONB) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor RECORD; entry JSONB; fields JSONB; snapshot JSONB; fingerprint TEXT; import_fingerprint TEXT; import_key TEXT; source_sha TEXT;
 prior platform_private.sales_register_requests%ROWTYPE; existing platform_private.sales_register%ROWTYPE;
 existing_target platform_private.sales_register_targets%ROWTYPE; receipt JSONB; inserted INTEGER:=0; skipped INTEGER:=0; mismatches INTEGER:=0;
 targets_inserted INTEGER:=0; targets_skipped INTEGER:=0; targets_mismatched INTEGER:=0; key TEXT; target_month DATE; manager TEXT;
BEGIN
 SELECT * INTO actor FROM platform_private.sales_register_actor(p_organization_id);
 IF actor.platform_role<>'admin' THEN RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR pg_column_size(p_payload)>10000000
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('source_sha256','sales','targets'))
   OR coalesce(p_payload->>'source_sha256','') !~ '^[a-f0-9]{64}$' OR jsonb_typeof(p_payload->'sales') IS DISTINCT FROM 'array'
   OR jsonb_typeof(p_payload->'targets') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'sales')>250
   OR jsonb_array_length(p_payload->'targets')>120 THEN RAISE EXCEPTION 'sales_register_invalid_import' USING ERRCODE='22023'; END IF;
 source_sha:=p_payload->>'source_sha256';
 PERFORM pg_advisory_xact_lock(hashtextextended('sales-register:'||p_organization_id::TEXT,0));
 SELECT * INTO actor FROM platform_private.sales_register_actor(p_organization_id);
 IF actor.platform_role<>'admin' THEN RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501'; END IF;
 fingerprint:=md5(jsonb_build_object('actor',actor.membership_id,'operation','import','payload',p_payload)::TEXT);
 SELECT * INTO prior FROM platform_private.sales_register_requests WHERE organization_id=p_organization_id AND request_id=p_request_id;
 IF FOUND THEN
   IF prior.fingerprint<>fingerprint OR prior.actor_membership_id<>actor.membership_id THEN RAISE EXCEPTION 'sales_register_request_id_conflict' USING ERRCODE='22023'; END IF;
   RETURN prior.receipt;
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'sales') s GROUP BY s->>'source_key' HAVING count(*)>1)
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'targets') s GROUP BY s->>'source_key' HAVING count(*)>1) THEN
   RAISE EXCEPTION 'sales_register_duplicate_source_key' USING ERRCODE='22023'; END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(p_payload->'sales') LOOP
   import_key:=entry->>'source_key'; snapshot:=entry->'source_snapshot';
   IF jsonb_typeof(entry)<>'object' OR length(coalesce(import_key,'')) NOT BETWEEN 1 AND 400
     OR length(coalesce(entry->>'source_sheet','')) NOT BETWEEN 1 AND 150 OR coalesce(entry->>'source_row','') !~ '^[1-9][0-9]{0,5}$'
     OR (entry->>'source_row')::INTEGER>100000 OR jsonb_typeof(snapshot) IS DISTINCT FROM 'object' OR pg_column_size(snapshot)>40000
     OR EXISTS(SELECT 1 FROM jsonb_object_keys(snapshot) k WHERE k NOT IN ('signing_date_raw','signing_date_type','intake_raw',
       'status_raw','status_column_present','service_cost_raw','paid_raw','service_cost_number_format','paid_number_format','source_period_year_inferred','review_flags',
       'applicant_name','phone','country','university','program','direction','intake','contract_number','manager_label')) THEN
     RAISE EXCEPTION 'sales_register_invalid_source' USING ERRCODE='22023'; END IF;
   FOR key IN SELECT jsonb_object_keys(snapshot) LOOP
     IF key='review_flags' THEN
       IF jsonb_typeof(snapshot->key)<>'array' OR jsonb_array_length(snapshot->key)>30
         OR EXISTS(SELECT 1 FROM jsonb_array_elements(snapshot->key) f WHERE jsonb_typeof(f)<>'string' OR length(f#>>'{}')>150) THEN
         RAISE EXCEPTION 'sales_register_invalid_source' USING ERRCODE='22023'; END IF;
     ELSIF jsonb_typeof(snapshot->key) NOT IN ('string','number','boolean','null') OR length(snapshot->>key)>2000 THEN
       RAISE EXCEPTION 'sales_register_invalid_source' USING ERRCODE='22023'; END IF;
   END LOOP;
   IF NULLIF(entry->>'owner_membership_id','') IS NOT NULL THEN RAISE EXCEPTION 'sales_register_import_owner_requires_explicit_edit' USING ERRCODE='22023'; END IF;
   fields:=platform_private.sales_register_fields(entry-ARRAY['source_key','source_sheet','source_row','source_snapshot']);
   import_fingerprint:=md5(entry::TEXT);
   SELECT * INTO existing FROM platform_private.sales_register r WHERE r.organization_id=p_organization_id AND r.source_key=import_key;
   IF FOUND THEN
     IF existing.source_sha256=source_sha AND existing.source_fingerprint=import_fingerprint THEN skipped:=skipped+1;
     ELSE mismatches:=mismatches+1; END IF;
   ELSE
     INSERT INTO platform_private.sales_register(organization_id,report_month,fields,source_kind,source_key,source_sha256,source_sheet,source_row,source_snapshot,source_fingerprint)
       VALUES(p_organization_id,(entry->>'report_month')::DATE,fields,'import',import_key,source_sha,entry->>'source_sheet',(entry->>'source_row')::INTEGER,snapshot,import_fingerprint);
     inserted:=inserted+1;
   END IF;
 END LOOP;
 FOR entry IN SELECT value FROM jsonb_array_elements(p_payload->'targets') LOOP
   IF jsonb_typeof(entry)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(entry) k WHERE k NOT IN ('report_month','manager_label','target_count','source_key'))
     OR coalesce(entry->>'report_month','') !~ '^(19|20|21)[0-9]{2}-[0-9]{2}-01$'
     OR coalesce(entry->>'target_count','') !~ '^(0|[1-9][0-9]{0,6})$' OR (entry->>'target_count')::NUMERIC>1000000
     OR length(coalesce(entry->>'source_key','')) NOT BETWEEN 1 AND 400 OR length(coalesce(entry->>'manager_label',''))>300 THEN
     RAISE EXCEPTION 'sales_register_invalid_target' USING ERRCODE='22023'; END IF;
   BEGIN target_month:=(entry->>'report_month')::DATE;
   EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'sales_register_invalid_target' USING ERRCODE='22023'; END;
   IF target_month NOT BETWEEN DATE '1900-01-01' AND DATE '2100-12-01' THEN RAISE EXCEPTION 'sales_register_invalid_target' USING ERRCODE='22023'; END IF;
   manager:=NULLIF(btrim(entry->>'manager_label'),''); import_key:=entry->>'source_key'; import_fingerprint:=md5(entry::TEXT);
   SELECT * INTO existing_target FROM platform_private.sales_register_targets t WHERE t.organization_id=p_organization_id AND
     (t.source_key=import_key OR (t.report_month=target_month AND t.manager_label IS NOT DISTINCT FROM manager)) ORDER BY t.id LIMIT 1;
   IF FOUND THEN
     IF existing_target.source_key=import_key AND existing_target.source_sha256=source_sha AND existing_target.source_fingerprint=import_fingerprint THEN targets_skipped:=targets_skipped+1;
     ELSE targets_mismatched:=targets_mismatched+1; END IF;
   ELSE
     INSERT INTO platform_private.sales_register_targets(organization_id,report_month,manager_label,target_count,source_key,source_sha256,source_fingerprint)
       VALUES(p_organization_id,target_month,manager,(entry->>'target_count')::INTEGER,import_key,source_sha,import_fingerprint);
     targets_inserted:=targets_inserted+1;
   END IF;
 END LOOP;
 receipt:=jsonb_build_object('organization_id',p_organization_id,'request_id',p_request_id,'operation','import','source_sha256',source_sha,
   'inserted',inserted,'skipped',skipped,'mismatches',mismatches,'targets_inserted',targets_inserted,'targets_skipped',targets_skipped,'targets_mismatched',targets_mismatched);
 INSERT INTO platform_private.sales_register_requests VALUES(p_organization_id,p_request_id,actor.membership_id,fingerprint,receipt,'Sales source import');
 INSERT INTO platform.audit_events(organization_id,actor_kind,actor_profile_id,actor_principal,action,resource_type,resource_id,after_state,reason,request_id)
 VALUES(p_organization_id,'user',actor.profile_id,'auth:'||actor.auth_user_id::TEXT,'sales.register.import','sales_register_import',p_request_id,receipt,'Sales source import',p_request_id);
 RETURN receipt;
END $$;

CREATE FUNCTION private.manage_sales_register_target_v1(p_organization_id UUID,p_record_id UUID,p_expected_version BIGINT,
 p_report_month DATE,p_manager_label TEXT,p_target_count INTEGER,p_reason TEXT,p_request_id UUID) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor RECORD; changed platform_private.sales_register_targets%ROWTYPE; prior platform_private.sales_register_requests%ROWTYPE;
 fingerprint TEXT; receipt JSONB; manager TEXT:=NULLIF(btrim(p_manager_label),'');
BEGIN
 SELECT * INTO actor FROM platform_private.sales_register_actor(p_organization_id);
 IF actor.platform_role<>'admin' THEN RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_expected_version IS NULL OR p_expected_version NOT BETWEEN 0 AND 9007199254740991
   OR ((p_record_id IS NULL)<>(p_expected_version=0)) OR p_report_month IS NULL OR extract(day FROM p_report_month)<>1
   OR p_report_month NOT BETWEEN DATE '1900-01-01' AND DATE '2100-12-01' OR length(manager)>300
   OR p_target_count IS NULL OR p_target_count NOT BETWEEN 0 AND 1000000 OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 1000 THEN
   RAISE EXCEPTION 'sales_register_invalid_target' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sales-register:'||p_organization_id::TEXT,0));
 SELECT * INTO actor FROM platform_private.sales_register_actor(p_organization_id);
 IF actor.platform_role<>'admin' THEN RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501'; END IF;
 fingerprint:=md5(jsonb_build_object('actor',actor.membership_id,'operation','target','id',p_record_id,'version',p_expected_version,
   'month',p_report_month,'manager',manager,'count',p_target_count,'reason',p_reason)::TEXT);
 SELECT * INTO prior FROM platform_private.sales_register_requests WHERE organization_id=p_organization_id AND request_id=p_request_id;
 IF FOUND THEN
   IF prior.fingerprint<>fingerprint OR prior.actor_membership_id<>actor.membership_id THEN RAISE EXCEPTION 'sales_register_request_id_conflict' USING ERRCODE='22023'; END IF;
   RETURN prior.receipt;
 END IF;
 IF p_record_id IS NULL THEN
   IF EXISTS(SELECT 1 FROM platform_private.sales_register_targets t WHERE t.organization_id=p_organization_id AND t.report_month=p_report_month AND t.manager_label IS NOT DISTINCT FROM manager) THEN
     RAISE EXCEPTION 'sales_register_target_exists' USING ERRCODE='PT409'; END IF;
   INSERT INTO platform_private.sales_register_targets(organization_id,report_month,manager_label,target_count)
     VALUES(p_organization_id,p_report_month,manager,p_target_count) RETURNING * INTO changed;
 ELSE
   SELECT * INTO changed FROM platform_private.sales_register_targets WHERE organization_id=p_organization_id AND id=p_record_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501'; END IF;
   IF changed.version<>p_expected_version THEN RAISE EXCEPTION 'sales_register_stale' USING ERRCODE='PT409'; END IF;
   IF EXISTS(SELECT 1 FROM platform_private.sales_register_targets t WHERE t.organization_id=p_organization_id AND t.id<>p_record_id
     AND t.report_month=p_report_month AND t.manager_label IS NOT DISTINCT FROM manager) THEN RAISE EXCEPTION 'sales_register_target_exists' USING ERRCODE='PT409'; END IF;
   UPDATE platform_private.sales_register_targets SET report_month=p_report_month,manager_label=manager,target_count=p_target_count,
     version=version+1 WHERE id=p_record_id RETURNING * INTO changed;
 END IF;
 receipt:=jsonb_build_object('organization_id',p_organization_id,'operation','target','record_id',changed.id,'version',changed.version::TEXT,'request_id',p_request_id);
 INSERT INTO platform_private.sales_register_requests VALUES(p_organization_id,p_request_id,actor.membership_id,fingerprint,receipt,btrim(p_reason));
 INSERT INTO platform.audit_events(organization_id,actor_kind,actor_profile_id,actor_principal,action,resource_type,resource_id,before_state,after_state,reason,request_id)
 VALUES(p_organization_id,'user',actor.profile_id,'auth:'||actor.auth_user_id::TEXT,'sales.register.target','sales_register_target',changed.id,
   jsonb_build_object('version',p_expected_version::TEXT),jsonb_build_object('version',changed.version::TEXT),'Sales monthly target',p_request_id);
 RETURN receipt;
END $$;

-- This is the existing canonical terminal event, not a guessed stage_key.
-- No browser-side second write: failure here aborts the handoff transaction.
CREATE FUNCTION platform_private.register_completed_sales_handoff(p_handoff_id UUID) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE handoff platform.sales_admissions_handoffs%ROWTYPE; client platform.clients%ROWTYPE;
 original_owner UUID; eligible_owner UUID; manager TEXT; report_month DATE; fields JSONB; sale_id UUID; audit_request UUID;
 original_applicant TEXT; display_applicant TEXT; display_manager TEXT; display_phone TEXT; normalization_needed BOOLEAN;
BEGIN
 SELECT * INTO handoff FROM platform.sales_admissions_handoffs WHERE id=p_handoff_id AND handoff_state='completed';
 IF NOT FOUND THEN RAISE EXCEPTION 'sales_register_handoff_missing' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sales-register:'||handoff.organization_id::TEXT,0));
 IF EXISTS(SELECT 1 FROM platform_private.sales_register r WHERE r.organization_id=handoff.organization_id AND r.lead_id=handoff.lead_id) THEN RETURN; END IF;
 SELECT * INTO STRICT client FROM platform.clients c WHERE c.organization_id=handoff.organization_id AND c.id=handoff.client_id;
 original_owner:=NULLIF(handoff.sales_context->>'current_owner_membership_id','')::UUID;
 SELECT p.display_name INTO manager FROM platform.organization_memberships m JOIN platform.profiles p ON p.id=m.profile_id
   WHERE m.organization_id=handoff.organization_id AND m.id=original_owner;
 IF original_owner IS NOT NULL AND platform_private.is_eligible_sales_owner(handoff.organization_id,original_owner) THEN eligible_owner:=original_owner; END IF;
 report_month:=date_trunc('month',handoff.handed_off_at AT TIME ZONE 'Asia/Bishkek')::DATE;
 -- Canonical identity permits longer raw text than this bounded report. Keep
 -- honest fragments/unknown values, never reject a valid handoff for display length.
 -- The original is still in its canonical card; no full identity copy is added.
 original_applicant:=coalesce(NULLIF(handoff.client_context->>'display_name',''),client.display_name);
 display_applicant:=left(btrim(regexp_replace(original_applicant,'[[:cntrl:]]',' ','g')),300);
 display_manager:=left(btrim(regexp_replace(coalesce(manager,''),'[[:cntrl:]]',' ','g')),300);
 display_phone:=CASE WHEN length(client.phone)<=100 AND client.phone !~ '[[:cntrl:]]' THEN client.phone
   WHEN client.normalized_phone ~ '^\+?[0-9]{7,15}$' THEN client.normalized_phone ELSE NULL END;
 normalization_needed:=display_applicant IS DISTINCT FROM original_applicant OR display_manager IS DISTINCT FROM coalesce(manager,'')
   OR display_phone IS DISTINCT FROM client.phone;
 fields:=platform_private.sales_register_fields(jsonb_build_object('report_month',report_month,
   'applicant_name',display_applicant,'phone',display_phone,'manager_label',display_manager,'status_raw','Переданы','needs_review',true,
   'notes','Создано по завершённой передаче. Дату договора, стоимость и сумму оплаты нужно уточнить; первый платёж не заменяет итог оплаты.'
     ||CASE WHEN normalization_needed THEN ' Длинные или непригодные для отчёта значения сокращены либо не указаны; оригинал сохранён в карточке.' ELSE '' END),true);
 INSERT INTO platform_private.sales_register(organization_id,report_month,owner_membership_id,source_kind,lead_id,client_id,fields,source_snapshot)
   VALUES(handoff.organization_id,report_month,eligible_owner,'pipeline',handoff.lead_id,handoff.client_id,fields,
     fields||jsonb_build_object('handoff_id',handoff.id,'handed_off_at',handoff.handed_off_at,'original_owner_membership_id',original_owner,
       'original_applicant_length',length(original_applicant),'original_manager_length',length(manager),'original_phone_length',length(client.phone),
       'display_normalized',normalization_needed,'phone_normalized_used',display_phone IS DISTINCT FROM client.phone AND display_phone IS NOT NULL)) RETURNING id INTO sale_id;
 audit_request:=public.uuid_generate_v5(handoff.id,'sales-register:pipeline');
 INSERT INTO platform.audit_events(organization_id,actor_kind,actor_profile_id,actor_principal,action,resource_type,resource_id,after_state,reason,request_id)
 VALUES(handoff.organization_id,'user',handoff.actor_profile_id,'handoff:'||handoff.id::TEXT,'sales.register.pipeline','sales_register',sale_id,
   jsonb_build_object('version','1','lead_id',handoff.lead_id,'handoff_id',handoff.id),'Canonical completed handoff',audit_request);
END $$;
CREATE FUNCTION platform_private.sales_register_handoff_trigger() RETURNS TRIGGER
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN PERFORM platform_private.register_completed_sales_handoff(NEW.id); RETURN NEW; END $$;
CREATE TRIGGER sales_register_completed_handoff AFTER INSERT ON platform.sales_admissions_handoffs
 FOR EACH ROW WHEN (NEW.handoff_state='completed') EXECUTE FUNCTION platform_private.sales_register_handoff_trigger();
-- Backfill only genuinely completed canonical handoffs. Zero source rows stays zero.
DO $$ DECLARE handoff_id UUID; BEGIN
 FOR handoff_id IN SELECT id FROM platform.sales_admissions_handoffs WHERE handoff_state='completed' ORDER BY organization_id,handed_off_at,id LOOP
   PERFORM platform_private.register_completed_sales_handoff(handoff_id);
 END LOOP;
END $$;

CREATE FUNCTION platform.manage_sales_register_v1(p_organization_id UUID,p_operation TEXT,p_record_id UUID,p_expected_version BIGINT,p_fields JSONB,p_reason TEXT,p_request_id UUID)
 RETURNS JSONB LANGUAGE SQL VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT private.manage_sales_register_v1(p_organization_id,p_operation,p_record_id,p_expected_version,p_fields,p_reason,p_request_id) $$;
CREATE FUNCTION platform.read_sales_register_v1(p_organization_id UUID,p_year INTEGER,p_month INTEGER DEFAULT NULL,p_offset INTEGER DEFAULT 0,p_record_id UUID DEFAULT NULL,p_archived BOOLEAN DEFAULT false)
 RETURNS JSONB LANGUAGE SQL STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT private.read_sales_register_v1(p_organization_id,p_year,p_month,p_offset,p_record_id,p_archived) $$;
CREATE FUNCTION platform.import_sales_register_v1(p_organization_id UUID,p_request_id UUID,p_payload JSONB)
 RETURNS JSONB LANGUAGE SQL VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT private.import_sales_register_v1(p_organization_id,p_request_id,p_payload) $$;
CREATE FUNCTION platform.manage_sales_register_target_v1(p_organization_id UUID,p_record_id UUID,p_expected_version BIGINT,p_report_month DATE,p_manager_label TEXT,p_target_count INTEGER,p_reason TEXT,p_request_id UUID)
 RETURNS JSONB LANGUAGE SQL VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT private.manage_sales_register_target_v1(p_organization_id,p_record_id,p_expected_version,p_report_month,p_manager_label,p_target_count,p_reason,p_request_id) $$;
REVOKE ALL ON FUNCTION platform_private.register_completed_sales_handoff(UUID),platform_private.sales_register_handoff_trigger() FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
REVOKE ALL ON FUNCTION platform_private.sales_register_actor(UUID),platform_private.sales_register_fields(JSONB,BOOLEAN),platform_private.sales_register_row(platform_private.sales_register)
 FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
REVOKE ALL ON FUNCTION private.manage_sales_register_target_v1(UUID,UUID,BIGINT,DATE,TEXT,INTEGER,TEXT,UUID),platform.manage_sales_register_target_v1(UUID,UUID,BIGINT,DATE,TEXT,INTEGER,TEXT,UUID)
 FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.manage_sales_register_target_v1(UUID,UUID,BIGINT,DATE,TEXT,INTEGER,TEXT,UUID),platform.manage_sales_register_target_v1(UUID,UUID,BIGINT,DATE,TEXT,INTEGER,TEXT,UUID) TO authenticated;
REVOKE ALL ON FUNCTION private.manage_sales_register_v1(UUID,TEXT,UUID,BIGINT,JSONB,TEXT,UUID),platform.manage_sales_register_v1(UUID,TEXT,UUID,BIGINT,JSONB,TEXT,UUID),
 private.read_sales_register_v1(UUID,INTEGER,INTEGER,INTEGER,UUID,BOOLEAN),platform.read_sales_register_v1(UUID,INTEGER,INTEGER,INTEGER,UUID,BOOLEAN),
 private.import_sales_register_v1(UUID,UUID,JSONB),platform.import_sales_register_v1(UUID,UUID,JSONB) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.manage_sales_register_v1(UUID,TEXT,UUID,BIGINT,JSONB,TEXT,UUID),platform.manage_sales_register_v1(UUID,TEXT,UUID,BIGINT,JSONB,TEXT,UUID),
 private.read_sales_register_v1(UUID,INTEGER,INTEGER,INTEGER,UUID,BOOLEAN),platform.read_sales_register_v1(UUID,INTEGER,INTEGER,INTEGER,UUID,BOOLEAN),
 private.import_sales_register_v1(UUID,UUID,JSONB),platform.import_sales_register_v1(UUID,UUID,JSONB) TO authenticated;
COMMIT;
