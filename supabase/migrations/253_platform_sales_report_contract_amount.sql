-- Э8.6 «Отчёт продаж»: «Оплачено в валюте договора», причины пометки словами,
-- написания менеджеров (решения владельца 28.09.2026). docs/PLAN_CHANGES.md
-- «2026-09-28 — Э8: срезы по итоговой критике (решения владельца 28.09,
-- запись до кода)», срез Э8.6. Номер 252 занят срезом Э8.5 (очередь дел 241);
-- эта миграция от него не зависит и применяется после него.
--
-- Why (28.09 critique on the live CRM, read-only): «Остаток» was «—» for most
-- September records — 5 of 6 were paid in another currency than the contract
-- (EUR/USD → KGS), and the report never converts currencies. Almost every
-- imported record read «Нужно уточнить», with reasons rebuilt from fields in
-- the browser («причина не записана»), because the import's own flags were
-- never projected. The manager filter grouped 19 spellings of ~15 people by
-- case and spaces only; there was no owner-approved mapping.
--
-- Owner decisions 28.09 (the field «Оплачено в валюте договора» confirmed by
-- the owner 28.09, not «курс на дату оплаты»):
--  * «Оплачено в валюте договора» — the manager types the amount paid, in the
--    contract (cost) currency; the system converts nothing;
--  * a currency difference alone no longer flags a record once that amount
--    is entered; no mass update of existing rows;
--  * manager spellings map to a person by a table the owner fills; a name
--    without a CRM account is allowed; the system guesses nothing beyond the
--    key (case, spaces, trailing dots).
--
-- Forward-only. v1/v2/v3 reads, manage v1 and staff_lead_handoff_strip_v1 stay
-- byte-identical (rollback of the application keeps working): new columns are
-- NOT inside `fields` (sales_register_row v1 = fields || fixed keys would leak
-- them into the released exact-key reads). SECURITY DEFINER with the empty
-- search_path throughout; client-callable functions only in `platform`.
--
--  a) platform_private.sales_register.paid_contract_minor/_currency: the pair
--     «Оплачено в валюте договора» (both or neither, the register's currency
--     domain). NULL for every existing row.
--  b) platform_private.sales_manager_label_key(text): IMMUTABLE key — trim,
--     collapse whitespace, strip trailing dots, lower case. Nothing else.
--  c) platform_private.sales_manager_labels: one owner-approved mapping per
--     key (display name, optional staff membership), FORCE RLS, no grants.
--  d) platform_private.sales_register_row_v2(row): the v1 row plus
--     paid_contract {minor, currency}, review_reasons (computed live, only
--     while the record is flagged: missing sale date / cost / paid amount; paid
--     in another currency without «Оплачено в валюте договора»; import flags
--     whose field is still not fixed, as 'import:<flag>'), import_flags (the
--     flag strings only — source_snapshot is never returned) and manager_key.
--  e) platform.read_sales_register_v4: v3 (247) with row_v2, a manager KEY
--     filter (p_manager_key replaces the exact spelling), manager_options
--     (key, mapped or most frequent tidy spelling, record count of the
--     current selection without the manager filter) and totals whose paid
--     side uses «Оплачено в валюте договора» when the record was paid in
--     another currency and the contract amount is in the cost currency.
--  f) platform.manage_sales_register_v2: manage v1 (134+156+174+208, anchored
--     below) with the contract pair. Same gates (sales.register.manage on the
--     record, 208 Sales Manager guard), request-id replay, audit. needs_review
--     = manual flag OR missing date/cost/paid OR (paid currency ≠ cost
--     currency AND no contract amount). The pair is accepted only for a record
--     paid in another currency than its cost, in the cost currency.
--  g) platform.read_sales_manager_labels_v1 / save_sales_manager_label_v1:
--     the Admin screen «Менеджеры в отчёте» — keys with raw spellings and
--     record counts, the current mapping, staff options; save with an
--     optimistic version, request-id replay and an audit event. Permission:
--     sales.register.import at organization scope (as «Перенос данных»).
BEGIN;

-- ---------------------------------------------------------------------------
-- Anchors: v4 and manage v2 are copies of these exact definitions.
-- ---------------------------------------------------------------------------
DO $a253_anchor$
DECLARE anchor RECORD;
BEGIN
  FOR anchor IN SELECT * FROM (VALUES
    ('platform.read_sales_register_v3(uuid,integer,integer,integer,uuid,boolean,text,text,boolean,text,text)', '1439fa99ea98aebe86e0a2673ae7e2a5'),
    ('private.manage_sales_register_v1(uuid,text,uuid,bigint,jsonb,text,uuid)', '3b6b19063c5e2d55ce5a226cd94b5540'),
    ('platform_private.sales_register_row(platform_private.sales_register)', '17df8ac76544087f7f93410c26e734cc'),
    ('platform_private.sales_register_fields(jsonb,boolean)', '3afe9eec0198bd830ef7b6ca9af2878b')
  ) AS a(signature, expected)
  LOOP
    IF (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = anchor.signature::regprocedure)
      IS DISTINCT FROM anchor.expected THEN
      RAISE EXCEPTION 'a253_sales_anchor_drift: % is not the expected definition', anchor.signature;
    END IF;
  END LOOP;
END
$a253_anchor$;

-- Rollback proof: the released reads and commands are compared after this migration.
CREATE TEMP TABLE a253_released ON COMMIT DROP AS
  SELECT p.oid::REGPROCEDURE::TEXT AS signature, md5(p.prosrc) AS body
  FROM pg_catalog.pg_proc p
  WHERE p.oid IN (
    'platform.read_sales_register_v1(uuid,integer,integer,integer,uuid,boolean,text,text,boolean)'::regprocedure,
    'private.read_sales_register_v1(uuid,integer,integer,integer,uuid,boolean,text,text,boolean)'::regprocedure,
    'platform.read_sales_register_v2(uuid,integer,integer,integer,uuid,boolean,text,text,boolean,text)'::regprocedure,
    'private.read_sales_register_v2(uuid,integer,integer,integer,uuid,boolean,text,text,boolean,text)'::regprocedure,
    'platform.read_sales_register_v3(uuid,integer,integer,integer,uuid,boolean,text,text,boolean,text,text)'::regprocedure,
    'platform.manage_sales_register_v1(uuid,text,uuid,bigint,jsonb,text,uuid)'::regprocedure,
    'private.manage_sales_register_v1(uuid,text,uuid,bigint,jsonb,text,uuid)'::regprocedure,
    'platform.staff_lead_handoff_strip_v1(uuid,uuid)'::regprocedure,
    'platform_private.sales_register_row(platform_private.sales_register)'::regprocedure,
    'platform_private.sales_register_fields(jsonb,boolean)'::regprocedure);

-- ---------------------------------------------------------------------------
-- a) «Оплачено в валюте договора» — columns, not `fields` keys
-- ---------------------------------------------------------------------------
ALTER TABLE platform_private.sales_register
  ADD COLUMN paid_contract_minor BIGINT,
  ADD COLUMN paid_contract_currency TEXT,
  ADD CONSTRAINT sales_register_paid_contract_pair
    CHECK ((paid_contract_minor IS NULL) = (paid_contract_currency IS NULL)),
  ADD CONSTRAINT sales_register_paid_contract_amount
    CHECK (paid_contract_minor IS NULL OR paid_contract_minor BETWEEN 0 AND 1000000000000),
  ADD CONSTRAINT sales_register_paid_contract_currency
    CHECK (paid_contract_currency IS NULL OR paid_contract_currency IN ('USD','EUR','KGS'));
COMMENT ON COLUMN platform_private.sales_register.paid_contract_minor IS
  '«Оплачено в валюте договора» (253): amount typed by the manager in the cost currency for a record paid in another currency; never converted by the system.';

-- ---------------------------------------------------------------------------
-- b) The manager spelling key: case, spaces, trailing dots — nothing else
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.sales_manager_label_key(p_label TEXT)
RETURNS TEXT
LANGUAGE SQL IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
  SELECT lower(regexp_replace(regexp_replace(btrim(coalesce(p_label, '')), '[[:space:]]+', ' ', 'g'), '[.[:space:]]+$', ''))
$$;

-- ---------------------------------------------------------------------------
-- c) Owner-approved mapping of a key to a name (and optionally a staff member)
-- ---------------------------------------------------------------------------
CREATE TABLE platform_private.sales_manager_labels (
  id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  organization_id UUID NOT NULL REFERENCES platform.organizations(id),
  label_key TEXT NOT NULL CHECK (length(label_key) BETWEEN 1 AND 300
    AND label_key = platform_private.sales_manager_label_key(label_key)),
  -- NULL display name = the mapping was cleared (the row keeps its version).
  display_name TEXT CHECK (display_name IS NULL OR (length(display_name) BETWEEN 1 AND 300
    AND display_name = btrim(display_name) AND display_name !~ '[[:cntrl:]]')),
  membership_id UUID,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 9007199254740991),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID NOT NULL,
  PRIMARY KEY (organization_id, label_key),
  FOREIGN KEY (organization_id, membership_id) REFERENCES platform.organization_memberships(organization_id, id),
  FOREIGN KEY (organization_id, updated_by) REFERENCES platform.organization_memberships(organization_id, id),
  CHECK (membership_id IS NULL OR display_name IS NOT NULL)
);
ALTER TABLE platform_private.sales_manager_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.sales_manager_labels FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform_private.sales_manager_labels FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform_private.sales_manager_label_key(TEXT) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- d) Row v2: v1 row + contract amount + reasons in keys + import flag strings
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.sales_register_row_v2(p_row platform_private.sales_register)
RETURNS JSONB
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  cost_currency TEXT := NULLIF(p_row.fields->>'service_cost_currency', '');
  paid_currency TEXT := NULLIF(p_row.fields->>'paid_currency', '');
  sale_date DATE := NULLIF(p_row.fields->>'signing_date', '')::DATE;
  flags TEXT[] := ARRAY[]::TEXT[];
  reasons TEXT[] := ARRAY[]::TEXT[];
  flag TEXT;
  still_open BOOLEAN;
BEGIN
  -- Only the import's flag strings (never the snapshot, which holds source cells).
  IF p_row.source_kind = 'import' AND jsonb_typeof(p_row.source_snapshot->'review_flags') = 'array' THEN
    SELECT coalesce(array_agg(f.flag ORDER BY f.first_seen), ARRAY[]::TEXT[]) INTO flags
    FROM (SELECT e.value AS flag, min(e.ordinality) AS first_seen
      FROM jsonb_array_elements_text(p_row.source_snapshot->'review_flags') WITH ORDINALITY AS e(value, ordinality)
      WHERE e.value ~ '^[a-z][a-z0-9_]{0,149}$'
      GROUP BY e.value) AS f;
  END IF;
  -- Reasons explain the current flag; an unflagged record has none.
  IF coalesce((p_row.fields->>'needs_review')::BOOLEAN, false) THEN
    IF sale_date IS NULL THEN reasons := reasons || 'signing_date_missing'::TEXT; END IF;
    IF p_row.fields->>'service_cost_minor' IS NULL THEN reasons := reasons || 'service_cost_missing'::TEXT; END IF;
    IF p_row.fields->>'paid_minor' IS NULL THEN reasons := reasons || 'paid_missing'::TEXT; END IF;
    IF cost_currency IS NOT NULL AND paid_currency IS NOT NULL AND cost_currency <> paid_currency
      AND p_row.paid_contract_currency IS DISTINCT FROM cost_currency THEN
      reasons := reasons || 'contract_amount_missing'::TEXT;
    END IF;
    FOREACH flag IN ARRAY flags LOOP
      still_open := CASE
        -- The live reasons above already cover date, money and currency flags.
        WHEN flag = 'signing_date_outside_report_month' THEN
          sale_date IS NOT NULL AND date_trunc('month', sale_date)::DATE <> p_row.report_month
        WHEN flag ~ '^(signing_date_|service_cost_|paid_)' OR flag = 'cost_paid_currency_mismatch' THEN false
        WHEN flag = 'phone_missing' THEN btrim(coalesce(p_row.fields->>'phone', '')) = ''
        WHEN flag = 'status_unspecified' THEN
          lower(regexp_replace(btrim(coalesce(p_row.fields->>'status_raw', '')), '[[:space:]]+', ' ', 'g'))
            NOT IN ('оплачено', 'частично оплачено', 'не оплачено')
        WHEN flag ~ '^(applicant_name|phone|country|university|program|direction|intake|contract_number|manager_label|status_raw)_formula_not_evaluated$' THEN
          btrim(coalesce(p_row.fields->>regexp_replace(flag, '_formula_not_evaluated$', ''), '')) = ''
        ELSE true END;
      IF still_open THEN reasons := reasons || ('import:' || flag); END IF;
    END LOOP;
  END IF;
  RETURN platform_private.sales_register_row(p_row) || jsonb_build_object(
    'paid_contract', CASE WHEN p_row.paid_contract_minor IS NULL THEN NULL
      ELSE jsonb_build_object('minor', p_row.paid_contract_minor, 'currency', p_row.paid_contract_currency) END,
    'review_reasons', to_jsonb(reasons),
    'import_flags', to_jsonb(flags),
    'manager_key', platform_private.sales_manager_label_key(p_row.fields->>'manager_label'));
END
$$;
REVOKE ALL ON FUNCTION platform_private.sales_register_row_v2(platform_private.sales_register)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- e) platform.read_sales_register_v4: v3 + row v2 + manager key + options
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.read_sales_register_v4(p_organization_id UUID, p_year INTEGER, p_month INTEGER DEFAULT NULL,
  p_offset INTEGER DEFAULT 0, p_record_id UUID DEFAULT NULL, p_archived BOOLEAN DEFAULT false,
  p_manager_key TEXT DEFAULT NULL, p_direction TEXT DEFAULT NULL, p_needs_review BOOLEAN DEFAULT NULL,
  p_query TEXT DEFAULT NULL, p_sale_slice TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; selected JSONB:=NULL; rows JSONB; total BIGINT; totals JSONB; targets JSONB; owners JSONB;
 managers JSONB; facets JSONB;
 unresolved_cost BIGINT; unresolved_paid BIGINT; first_month DATE; last_month DATE; period_end DATE;
 normalized_query TEXT := NULLIF(btrim(p_query),''); query_lower TEXT; query_digits TEXT;
 manager_key TEXT := CASE WHEN p_manager_key IS NULL THEN NULL ELSE platform_private.sales_manager_label_key(p_manager_key) END;
BEGIN
 SELECT * INTO actor FROM platform_private.sales_register_actor(p_organization_id);
 IF p_year IS NULL OR p_year NOT BETWEEN 1900 AND 2100 OR (p_month IS NOT NULL AND p_month NOT BETWEEN 1 AND 12)
   OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 1000000 OR p_archived IS NULL
   OR (p_manager_key IS NOT NULL AND (length(p_manager_key) NOT BETWEEN 1 AND 300 OR p_manager_key ~ '[[:cntrl:]]' OR manager_key = ''))
   OR (p_direction IS NOT NULL AND (length(p_direction) NOT BETWEEN 1 AND 500 OR p_direction ~ '[[:cntrl:]]'))
   OR (p_query IS NOT NULL AND (length(p_query)>200 OR p_query ~ '[[:cntrl:]]'))
   OR (p_sale_slice IS NOT NULL AND (p_sale_slice NOT IN ('undated','other_sale_date','filed_elsewhere') OR p_archived)) THEN
   RAISE EXCEPTION 'sales_register_invalid_filter' USING ERRCODE='22023'; END IF;
 query_lower:=lower(normalized_query);
 query_digits:=CASE WHEN normalized_query ~ '^[+0-9 ().-]+$'
   THEN NULLIF(regexp_replace(normalized_query,'[^0-9]','','g'),'') ELSE NULL END;
 first_month:=make_date(p_year,coalesce(p_month,1),1);
 last_month:=CASE WHEN p_month IS NULL THEN make_date(p_year,12,1) ELSE first_month END;
 period_end:=(last_month + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
 IF p_record_id IS NOT NULL THEN
   SELECT platform_private.sales_register_row_v2(r) INTO selected FROM platform_private.sales_register r
     WHERE r.organization_id=p_organization_id AND r.id=p_record_id AND platform_private.staff_can_access(p_organization_id, actor.membership_id,
      'sales.register.read', 'sales_register', r.id);
   IF NOT FOUND THEN RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501'; END IF;
 END IF;
 -- `base` is v3's selection without the manager filter: the manager options
 -- count what choosing each of them would show.
 WITH base AS MATERIALIZED (SELECT r.* FROM platform_private.sales_register r WHERE r.organization_id=p_organization_id
   AND platform_private.staff_can_access(p_organization_id, actor.membership_id,
      'sales.register.read', 'sales_register', r.id) AND r.archived=p_archived
   AND CASE WHEN p_sale_slice = 'filed_elsewhere'
     THEN NULLIF(r.fields->>'signing_date','')::DATE BETWEEN first_month AND period_end
       AND r.report_month NOT BETWEEN first_month AND last_month
     ELSE r.report_month BETWEEN first_month AND last_month END
   AND (p_sale_slice IS NULL OR p_sale_slice = 'filed_elsewhere'
     OR (p_sale_slice = 'undated' AND NULLIF(r.fields->>'signing_date','') IS NULL)
     OR (p_sale_slice = 'other_sale_date'
       AND NULLIF(r.fields->>'signing_date','')::DATE NOT BETWEEN first_month AND period_end))
   AND (p_direction IS NULL OR r.fields->>'direction'=p_direction)
   AND (p_needs_review IS NULL OR (r.fields->>'needs_review')::BOOLEAN=p_needs_review)
   AND (normalized_query IS NULL
     OR strpos(lower(coalesce(r.fields->>'applicant_name','')),query_lower)>0
     OR strpos(lower(coalesce(r.fields->>'contract_number','')),query_lower)>0
     OR (query_digits IS NOT NULL AND strpos(regexp_replace(coalesce(r.fields->>'phone',''),'[^0-9]','','g'),query_digits)>0))),
 filtered AS MATERIALIZED (SELECT b.* FROM base b
   WHERE manager_key IS NULL OR platform_private.sales_manager_label_key(b.fields->>'manager_label')=manager_key),
 -- Paid side of the totals: «Оплачено в валюте договора» for a record paid in
 -- another currency when that amount is in the cost currency; else as v3.
 paid AS (SELECT CASE WHEN f.paid_contract_minor IS NOT NULL AND f.paid_contract_currency=f.fields->>'service_cost_currency'
       AND f.fields->>'paid_currency' IS DISTINCT FROM f.fields->>'service_cost_currency'
     THEN f.paid_contract_currency ELSE f.fields->>'paid_currency' END AS currency,
   CASE WHEN f.paid_contract_minor IS NOT NULL AND f.paid_contract_currency=f.fields->>'service_cost_currency'
       AND f.fields->>'paid_currency' IS DISTINCT FROM f.fields->>'service_cost_currency'
     THEN f.paid_contract_minor ELSE (f.fields->>'paid_minor')::BIGINT END AS minor
   FROM filtered f WHERE f.fields->>'paid_minor' IS NOT NULL)
 SELECT (SELECT count(*) FROM filtered),
   coalesce((SELECT jsonb_agg(platform_private.sales_register_row_v2(page::platform_private.sales_register) ORDER BY page.report_month DESC,page.id) FROM
      (SELECT * FROM filtered ORDER BY report_month DESC,id LIMIT 50 OFFSET p_offset) page),'[]'),
   (SELECT count(*) FROM filtered WHERE fields->>'service_cost_minor' IS NULL),
   (SELECT count(*) FROM filtered WHERE fields->>'paid_minor' IS NULL),
   coalesce((SELECT jsonb_agg(jsonb_build_object('currency',currency,'cost_minor',cost_minor::TEXT,'paid_minor',paid_minor::TEXT) ORDER BY currency)
     FROM (SELECT currency,sum(cost_minor) cost_minor,sum(paid_minor) paid_minor FROM (
       SELECT fields->>'service_cost_currency' currency,(fields->>'service_cost_minor')::BIGINT cost_minor,0::BIGINT paid_minor FROM filtered WHERE fields->>'service_cost_minor' IS NOT NULL
       UNION ALL SELECT p.currency,0::BIGINT,p.minor FROM paid p) amounts GROUP BY currency) sums),'[]'),
   coalesce((SELECT jsonb_object_agg(k.key, k.n) FROM (SELECT platform_private.sales_manager_label_key(b.fields->>'manager_label') AS key, count(*) AS n
     FROM base b GROUP BY 1) k WHERE k.key<>''),'{}')
 INTO total,rows,unresolved_cost,unresolved_paid,totals,facets;
 IF p_archived THEN totals:='[]'; unresolved_cost:=0; unresolved_paid:=0; END IF;
 -- Menu of managers: every key the actor can read (as v3's labels), named by
 -- the owner's mapping or, unmapped, by its most frequent tidy spelling.
 WITH spelled AS (SELECT platform_private.sales_manager_label_key(r.fields->>'manager_label') AS key,
     regexp_replace(btrim(r.fields->>'manager_label'),'[[:space:]]+',' ','g') AS tidy, count(*) AS n
   FROM platform_private.sales_register r WHERE r.organization_id=p_organization_id AND platform_private.staff_can_access(p_organization_id, actor.membership_id,
      'sales.register.read', 'sales_register', r.id)
   AND r.fields->>'manager_label'<>'' GROUP BY 1,2),
 best AS (SELECT DISTINCT ON (s.key) s.key, s.tidy FROM spelled s WHERE s.key<>'' ORDER BY s.key, s.n DESC, s.tidy),
 named AS (SELECT b.key, left(coalesce(m.display_name, b.tidy),300) AS name FROM best b
   LEFT JOIN platform_private.sales_manager_labels m ON m.organization_id=p_organization_id AND m.label_key=b.key AND m.display_name IS NOT NULL
   ORDER BY 2, 1 LIMIT 1000)
 SELECT coalesce(jsonb_agg(jsonb_build_object('key',n.key,'name',n.name,'count',coalesce((facets->>n.key)::BIGINT,0)) ORDER BY n.name,n.key),'[]')
   INTO managers FROM named n;
 IF platform_private.staff_can_access(p_organization_id, actor.membership_id,
      'sales.register.target.manage', 'organization', p_organization_id) THEN
   SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.id,'version',t.version::TEXT,'report_month',t.report_month,
     'manager_label',t.manager_label,'target_count',t.target_count) ORDER BY t.report_month,t.manager_label),'[]') INTO targets
     FROM platform_private.sales_register_targets t WHERE t.organization_id=p_organization_id AND t.report_month BETWEEN first_month AND last_month;
 ELSE targets:='[]'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'label',left(btrim(regexp_replace(coalesce(p.display_name,''),'[[:cntrl:]]',' ','g')),300)) ORDER BY p.display_name,m.id),'[]') INTO owners
 FROM platform.organization_memberships m JOIN platform.profiles p ON p.id=m.profile_id
 WHERE m.organization_id=p_organization_id AND platform_private.staff_can_receive_assignment(p_organization_id, m.id, 'sales.register.read', 'sales_register', NULL)
   AND platform_private.staff_can_create_for_owner(p_organization_id, actor.membership_id,
     'sales.register.manage', 'sales_register', m.id);
 RETURN jsonb_build_object('query',normalized_query,'manager_key',manager_key,'organization_id',p_organization_id,'year',p_year,'month',p_month,'offset',p_offset,
   'total_count',total,'rows',rows,'selected',selected,'has_more',p_offset+50<total,'totals',totals,
   'unresolved_cost_count',unresolved_cost,'unresolved_paid_count',unresolved_paid,'targets',targets,'manager_options',managers,'owner_options',owners);
END $$;

-- ---------------------------------------------------------------------------
-- f) platform.manage_sales_register_v2: manage v1 + «Оплачено в валюте договора»
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.manage_sales_register_v2(p_organization_id UUID, p_operation TEXT, p_record_id UUID,
  p_expected_version BIGINT, p_fields JSONB, p_paid_contract_minor BIGINT, p_paid_contract_currency TEXT,
  p_reason TEXT, p_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; old platform_private.sales_register%ROWTYPE; changed platform_private.sales_register%ROWTYPE;
 normalized_fields JSONB; owner_id UUID; fingerprint TEXT; prior platform_private.sales_register_requests%ROWTYPE; receipt JSONB;
 cost_currency TEXT; paid_currency TEXT; currency_gap BOOLEAN;
BEGIN
 -- 174: a sale is created only with its curator (create_sales_report_handoff).
 IF p_operation='create' THEN RAISE EXCEPTION 'sales_register_curator_required' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM platform.organizations WHERE id=p_organization_id FOR KEY SHARE;
 SELECT * INTO actor FROM platform_private.sales_register_actor(p_organization_id);
 IF NOT platform_private.staff_is_sales_manager(p_organization_id,actor.membership_id) THEN
   RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_operation IS NULL OR p_operation NOT IN ('update','archive','restore') OR p_record_id IS NULL
   OR p_expected_version IS NULL OR p_expected_version<1 OR p_expected_version>9007199254740991
   OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 1000
   OR ((p_paid_contract_minor IS NULL)<>(p_paid_contract_currency IS NULL))
   OR (p_paid_contract_minor IS NOT NULL AND (p_paid_contract_minor NOT BETWEEN 0 AND 1000000000000
     OR p_paid_contract_currency NOT IN ('USD','EUR','KGS') OR p_operation<>'update')) THEN
   RAISE EXCEPTION 'sales_register_invalid_command' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sales-register:'||p_organization_id::TEXT,0));
 SELECT * INTO actor FROM platform_private.sales_register_actor(p_organization_id);
 IF NOT platform_private.staff_is_sales_manager(p_organization_id,actor.membership_id) THEN
   RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501'; END IF;
 fingerprint:=md5(jsonb_build_object('command','manage_v2','actor',actor.membership_id,'operation',p_operation,'record',p_record_id,
   'version',p_expected_version,'fields',p_fields,'paid_contract',
   jsonb_build_object('minor',p_paid_contract_minor,'currency',p_paid_contract_currency),'reason',p_reason)::TEXT);
 SELECT * INTO prior FROM platform_private.sales_register_requests WHERE organization_id=p_organization_id AND request_id=p_request_id;
 IF FOUND THEN
   IF prior.fingerprint<>fingerprint OR prior.actor_membership_id<>actor.membership_id THEN
     RAISE EXCEPTION 'sales_register_request_id_conflict' USING ERRCODE='22023'; END IF;
   -- Ownership may change after a successful command; do not replay foreign details.
   IF NOT platform_private.staff_can_access(p_organization_id, actor.membership_id,
      'sales.register.manage', 'sales_register', (prior.receipt->>'record_id')::UUID) THEN
     RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501'; END IF;
   RETURN prior.receipt;
 END IF;
 SELECT * INTO old FROM platform_private.sales_register WHERE organization_id=p_organization_id AND id=p_record_id FOR UPDATE;
 IF NOT FOUND OR NOT platform_private.staff_can_access(p_organization_id, actor.membership_id,
    'sales.register.manage', 'sales_register', old.id) THEN
   RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501'; END IF;
 IF old.version<>p_expected_version THEN RAISE EXCEPTION 'sales_register_stale' USING ERRCODE='PT409'; END IF;
 IF p_operation='update' THEN
   normalized_fields:=platform_private.sales_register_fields(p_fields);
   BEGIN owner_id:=NULLIF(p_fields->>'owner_membership_id','')::UUID;
   EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'sales_register_invalid_owner' USING ERRCODE='22023'; END;
   IF owner_id IS NULL AND NOT platform_private.staff_can_create_for_owner(p_organization_id,
     actor.membership_id, 'sales.register.manage', 'sales_register', NULL) THEN
     owner_id := actor.membership_id;
   END IF;
   IF NOT platform_private.staff_can_create_for_owner(p_organization_id, actor.membership_id,
     'sales.register.manage', 'sales_register', owner_id) THEN
     RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501';
   END IF;
   IF owner_id IS NOT NULL AND NOT platform_private.staff_can_receive_assignment(p_organization_id, owner_id,
      'sales.register.read', 'sales_register', p_record_id) THEN
     RAISE EXCEPTION 'sales_register_invalid_owner' USING ERRCODE='22023'; END IF;
   -- «Оплачено в валюте договора» exists only for a record paid in another
   -- currency than its cost, and only in the cost currency.
   cost_currency:=normalized_fields->>'service_cost_currency';
   paid_currency:=normalized_fields->>'paid_currency';
   IF p_paid_contract_minor IS NOT NULL AND (cost_currency IS NULL OR paid_currency IS NULL
     OR paid_currency=cost_currency OR p_paid_contract_currency<>cost_currency) THEN
     RAISE EXCEPTION 'sales_register_invalid_contract_amount' USING ERRCODE='22023'; END IF;
   currency_gap:=cost_currency IS NOT NULL AND paid_currency IS NOT NULL AND cost_currency<>paid_currency
     AND p_paid_contract_minor IS NULL;
   -- 134's flag (manual OR no date/cost/paid) plus the currency rule of 253.
   normalized_fields:=normalized_fields||jsonb_build_object('needs_review',
     (normalized_fields->>'needs_review')::BOOLEAN OR currency_gap);
   IF old.archived THEN RAISE EXCEPTION 'sales_register_archived' USING ERRCODE='22023'; END IF;
   UPDATE platform_private.sales_register SET report_month=(p_fields->>'report_month')::DATE,owner_membership_id=owner_id,
     fields=normalized_fields,paid_contract_minor=p_paid_contract_minor,paid_contract_currency=p_paid_contract_currency,
     version=version+1,updated_at=now() WHERE id=old.id RETURNING * INTO changed;
 ELSE
   IF p_fields IS DISTINCT FROM '{}'::JSONB OR old.archived=(p_operation='archive') THEN
     RAISE EXCEPTION 'sales_register_invalid_archive' USING ERRCODE='22023'; END IF;
   UPDATE platform_private.sales_register SET archived=(p_operation='archive'),version=version+1,updated_at=now()
     WHERE id=old.id RETURNING * INTO changed;
 END IF;
 receipt:=jsonb_build_object('organization_id',p_organization_id,'record_id',changed.id,'version',changed.version::TEXT,
   'operation',p_operation,'request_id',p_request_id);
 -- Preserve the human explanation privately; shared audit projections receive no free text.
 INSERT INTO platform_private.sales_register_requests VALUES(p_organization_id,p_request_id,actor.membership_id,fingerprint,receipt,btrim(p_reason));
 INSERT INTO platform.audit_events(organization_id,actor_kind,actor_profile_id,actor_principal,action,resource_type,resource_id,before_state,after_state,reason,request_id)
 VALUES(p_organization_id,'user',actor.profile_id,'auth:'||actor.auth_user_id::TEXT,'sales.register.'||p_operation,'sales_register',changed.id,
   jsonb_build_object('version',old.version::TEXT,'archived',old.archived,'paid_contract_set',old.paid_contract_minor IS NOT NULL),
   jsonb_build_object('version',changed.version::TEXT,'archived',changed.archived,'paid_contract_set',changed.paid_contract_minor IS NOT NULL),
   'Sales register command',p_request_id);
 RETURN receipt;
END $$;

-- ---------------------------------------------------------------------------
-- g) «Менеджеры в отчёте»: read and save the owner's mapping
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.read_sales_manager_labels_v1(p_organization_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; labels JSONB; staff JSONB;
BEGIN
  SELECT * INTO actor FROM platform_private.sales_register_actor(p_organization_id);
  IF NOT platform_private.staff_can_access(p_organization_id, actor.membership_id,
    'sales.register.import', 'organization', p_organization_id) THEN
    RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501';
  END IF;
  WITH spelled AS (SELECT platform_private.sales_manager_label_key(r.fields->>'manager_label') AS key,
      r.fields->>'manager_label' AS spelling, count(*) AS n
    FROM platform_private.sales_register r WHERE r.organization_id=p_organization_id
      AND platform_private.staff_can_access(p_organization_id, actor.membership_id, 'sales.register.read', 'sales_register', r.id)
      AND r.fields->>'manager_label'<>'' GROUP BY 1,2),
  -- The unmapped name is chosen exactly as read_sales_register_v4 chooses it.
  tidied AS (SELECT s.key, regexp_replace(btrim(s.spelling),'[[:space:]]+',' ','g') AS tidy, sum(s.n) AS n
    FROM spelled s WHERE s.key<>'' GROUP BY 1,2),
  best AS (SELECT DISTINCT ON (t.key) t.key, t.tidy FROM tidied t ORDER BY t.key, t.n DESC, t.tidy),
  keyed AS (SELECT s.key, sum(s.n) AS n,
      jsonb_agg(jsonb_build_object('spelling',s.spelling,'count',s.n) ORDER BY s.n DESC, s.spelling) AS spellings,
      (SELECT b.tidy FROM best b WHERE b.key=s.key) AS tidy
    FROM spelled s WHERE s.key<>'' GROUP BY s.key),
  every_key AS (SELECT k.key FROM keyed k UNION SELECT m.label_key FROM platform_private.sales_manager_labels m
    WHERE m.organization_id=p_organization_id),
  listed AS (SELECT e.key, coalesce(k.n,0) AS n, coalesce(k.spellings,'[]'::JSONB) AS spellings,
      left(coalesce(k.tidy, e.key),300) AS tidy, m.display_name, m.membership_id, m.version, m.updated_at
    FROM every_key e LEFT JOIN keyed k ON k.key=e.key
    LEFT JOIN platform_private.sales_manager_labels m ON m.organization_id=p_organization_id AND m.label_key=e.key
    ORDER BY coalesce(m.display_name, k.tidy, e.key), e.key LIMIT 1000)
  SELECT coalesce(jsonb_agg(jsonb_build_object('key',l.key,'tidy',l.tidy,'record_count',l.n,'spellings',l.spellings,
      'mapping',CASE WHEN l.version IS NULL THEN NULL ELSE jsonb_build_object('display_name',l.display_name,
        'membership_id',l.membership_id,'version',l.version::TEXT,'updated_at',l.updated_at) END)
      ORDER BY coalesce(l.display_name, l.tidy), l.key),'[]')
    INTO labels FROM listed l;
  -- Staff who can be named: whoever may own report records, plus anyone
  -- already chosen in a mapping (so a saved choice never disappears).
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'label',left(btrim(regexp_replace(coalesce(p.display_name,''),'[[:cntrl:]]',' ','g')),300))
      ORDER BY p.display_name,m.id),'[]') INTO staff
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id=m.profile_id
  WHERE m.organization_id=p_organization_id AND (
    platform_private.staff_can_receive_assignment(p_organization_id, m.id, 'sales.register.read', 'sales_register', NULL)
    OR EXISTS(SELECT 1 FROM platform_private.sales_manager_labels l WHERE l.organization_id=p_organization_id AND l.membership_id=m.id));
  RETURN jsonb_build_object('organization_id',p_organization_id,'labels',labels,'staff_options',staff);
END $$;

CREATE FUNCTION platform.save_sales_manager_label_v1(p_organization_id UUID, p_label_key TEXT, p_expected_version BIGINT,
  p_display_name TEXT, p_membership_id UUID, p_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; existing platform_private.sales_manager_labels%ROWTYPE; changed platform_private.sales_manager_labels%ROWTYPE;
 prior platform_private.sales_register_requests%ROWTYPE; fingerprint TEXT; receipt JSONB; found_existing BOOLEAN;
 display TEXT := NULLIF(btrim(p_display_name),'');
BEGIN
  PERFORM 1 FROM platform.organizations WHERE id=p_organization_id FOR KEY SHARE;
  SELECT * INTO actor FROM platform_private.sales_register_actor(p_organization_id);
  IF NOT platform_private.staff_can_access(p_organization_id, actor.membership_id,
    'sales.register.import', 'organization', p_organization_id) THEN
    RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501';
  END IF;
  IF p_request_id IS NULL OR p_label_key IS NULL OR length(p_label_key) NOT BETWEEN 1 AND 300
    OR p_label_key<>platform_private.sales_manager_label_key(p_label_key)
    OR p_expected_version IS NULL OR p_expected_version NOT BETWEEN 0 AND 9007199254740991
    OR (display IS NOT NULL AND (length(display)>300 OR display ~ '[[:cntrl:]]'))
    OR (p_membership_id IS NOT NULL AND display IS NULL) THEN
    RAISE EXCEPTION 'sales_manager_label_invalid' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('sales-register:'||p_organization_id::TEXT,0));
  fingerprint:=md5(jsonb_build_object('command','manager_label','actor',actor.membership_id,'key',p_label_key,
    'version',p_expected_version,'display_name',display,'membership',p_membership_id)::TEXT);
  SELECT * INTO prior FROM platform_private.sales_register_requests WHERE organization_id=p_organization_id AND request_id=p_request_id;
  IF FOUND THEN
    IF prior.fingerprint<>fingerprint OR prior.actor_membership_id<>actor.membership_id THEN
      RAISE EXCEPTION 'sales_register_request_id_conflict' USING ERRCODE='22023'; END IF;
    RETURN prior.receipt;
  END IF;
  SELECT * INTO existing FROM platform_private.sales_manager_labels
    WHERE organization_id=p_organization_id AND label_key=p_label_key FOR UPDATE;
  found_existing:=FOUND;
  IF (NOT found_existing AND p_expected_version<>0) OR (found_existing AND existing.version<>p_expected_version) THEN
    RAISE EXCEPTION 'sales_manager_label_stale' USING ERRCODE='PT409';
  END IF;
  -- Only a spelling that exists in the report (or a mapping already saved).
  IF NOT found_existing AND NOT EXISTS(SELECT 1 FROM platform_private.sales_register r WHERE r.organization_id=p_organization_id
    AND platform_private.sales_manager_label_key(r.fields->>'manager_label')=p_label_key) THEN
    RAISE EXCEPTION 'sales_manager_label_unknown' USING ERRCODE='22023';
  END IF;
  IF NOT found_existing AND display IS NULL THEN
    RAISE EXCEPTION 'sales_manager_label_invalid' USING ERRCODE='22023';
  END IF;
  IF p_membership_id IS NOT NULL AND p_membership_id IS DISTINCT FROM existing.membership_id AND NOT EXISTS(
    SELECT 1 FROM platform.organization_memberships m WHERE m.organization_id=p_organization_id AND m.id=p_membership_id
      AND platform_private.staff_can_receive_assignment(p_organization_id, m.id, 'sales.register.read', 'sales_register', NULL)) THEN
    RAISE EXCEPTION 'sales_manager_label_invalid_membership' USING ERRCODE='22023';
  END IF;
  IF found_existing THEN
    UPDATE platform_private.sales_manager_labels SET display_name=display, membership_id=p_membership_id,
      version=version+1, updated_at=now(), updated_by=actor.membership_id
      WHERE organization_id=p_organization_id AND label_key=p_label_key RETURNING * INTO changed;
  ELSE
    INSERT INTO platform_private.sales_manager_labels(organization_id,label_key,display_name,membership_id,updated_by)
      VALUES(p_organization_id,p_label_key,display,p_membership_id,actor.membership_id) RETURNING * INTO changed;
  END IF;
  receipt:=jsonb_build_object('organization_id',p_organization_id,'operation','manager_label','label_key',p_label_key,
    'version',changed.version::TEXT,'request_id',p_request_id);
  INSERT INTO platform_private.sales_register_requests VALUES(p_organization_id,p_request_id,actor.membership_id,fingerprint,receipt,
    'Sales manager spelling mapping');
  -- The audit names versions and whether a person is attached; names stay in the table.
  INSERT INTO platform.audit_events(organization_id,actor_kind,actor_profile_id,actor_principal,action,resource_type,resource_id,before_state,after_state,reason,request_id)
  VALUES(p_organization_id,'user',actor.profile_id,'auth:'||actor.auth_user_id::TEXT,'sales.register.manager.label','sales_manager_label',changed.id,
    CASE WHEN found_existing THEN jsonb_build_object('version',existing.version::TEXT,'mapped',existing.display_name IS NOT NULL,
      'membership_id',existing.membership_id) END,
    jsonb_build_object('version',changed.version::TEXT,'mapped',changed.display_name IS NOT NULL,'membership_id',changed.membership_id),
    'Sales manager spelling mapping',p_request_id);
  RETURN receipt;
END $$;

REVOKE ALL ON FUNCTION platform.read_sales_register_v4(UUID, INTEGER, INTEGER, INTEGER, UUID, BOOLEAN, TEXT, TEXT, BOOLEAN, TEXT, TEXT),
  platform.manage_sales_register_v2(UUID, TEXT, UUID, BIGINT, JSONB, BIGINT, TEXT, TEXT, UUID),
  platform.read_sales_manager_labels_v1(UUID),
  platform.save_sales_manager_label_v1(UUID, TEXT, BIGINT, TEXT, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.read_sales_register_v4(UUID, INTEGER, INTEGER, INTEGER, UUID, BOOLEAN, TEXT, TEXT, BOOLEAN, TEXT, TEXT),
  platform.manage_sales_register_v2(UUID, TEXT, UUID, BIGINT, JSONB, BIGINT, TEXT, TEXT, UUID),
  platform.read_sales_manager_labels_v1(UUID),
  platform.save_sales_manager_label_v1(UUID, TEXT, BIGINT, TEXT, UUID, UUID)
  TO authenticated;

-- Every function of this migration keeps the empty search_path; client
-- functions are SECURITY DEFINER and callable by authenticated only; private
-- helpers by nobody; the released reads and commands are byte-identical.
DO $a253_verify$
DECLARE routine RECORD;
BEGIN
  FOR routine IN SELECT p.oid::REGPROCEDURE AS signature, p.prosecdef, p.proconfig
    FROM pg_catalog.pg_proc AS p
    WHERE p.oid IN (
      'platform_private.sales_manager_label_key(text)'::regprocedure,
      'platform_private.sales_register_row_v2(platform_private.sales_register)'::regprocedure,
      'platform.read_sales_register_v4(uuid,integer,integer,integer,uuid,boolean,text,text,boolean,text,text)'::regprocedure,
      'platform.manage_sales_register_v2(uuid,text,uuid,bigint,jsonb,bigint,text,text,uuid)'::regprocedure,
      'platform.read_sales_manager_labels_v1(uuid)'::regprocedure,
      'platform.save_sales_manager_label_v1(uuid,text,bigint,text,uuid,uuid)'::regprocedure)
  LOOP
    IF routine.proconfig IS DISTINCT FROM ARRAY['search_path=""']
      OR has_function_privilege('anon', routine.signature, 'EXECUTE')
      OR (routine.signature::TEXT LIKE 'platform_private.%'
        AND (has_function_privilege('authenticated', routine.signature, 'EXECUTE')
          OR has_function_privilege('service_role', routine.signature, 'EXECUTE')))
      OR (routine.signature::TEXT LIKE 'platform.%'
        AND (NOT routine.prosecdef OR NOT has_function_privilege('authenticated', routine.signature, 'EXECUTE')))
    THEN
      RAISE EXCEPTION 'a253_sales_report_verification_failed: %', routine.signature;
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM a253_released r JOIN pg_catalog.pg_proc p ON p.oid = r.signature::regprocedure
      WHERE md5(p.prosrc) IS DISTINCT FROM r.body)
    OR (SELECT count(*) FROM a253_released) <> 10 THEN
    RAISE EXCEPTION 'a253_sales_report_verification_failed: a released read or command changed';
  END IF;
  IF has_table_privilege('authenticated', 'platform_private.sales_manager_labels', 'SELECT')
    OR has_table_privilege('service_role', 'platform_private.sales_manager_labels', 'SELECT')
    OR NOT (SELECT c.relforcerowsecurity FROM pg_catalog.pg_class c WHERE c.oid = 'platform_private.sales_manager_labels'::regclass) THEN
    RAISE EXCEPTION 'a253_sales_report_verification_failed: manager labels must stay private';
  END IF;
END
$a253_verify$;

COMMENT ON FUNCTION platform_private.sales_manager_label_key(TEXT) IS
  'Key of a manager spelling in «Отчёт продаж» (253): trim, collapse whitespace, strip trailing dots, lower case. The system guesses nothing beyond it.';
COMMENT ON TABLE platform_private.sales_manager_labels IS
  'Owner-approved name for a manager spelling key (253): display name (a person without a CRM account is allowed) and an optional staff membership. NULL display name = cleared.';
COMMENT ON FUNCTION platform_private.sales_register_row_v2(platform_private.sales_register) IS
  'Report row v2 (253): the v1 row + paid_contract, review_reasons (live, only while flagged), import_flags (flag strings only, never source_snapshot) and manager_key.';
COMMENT ON FUNCTION platform.read_sales_register_v4(UUID, INTEGER, INTEGER, INTEGER, UUID, BOOLEAN, TEXT, TEXT, BOOLEAN, TEXT, TEXT) IS
  'read_sales_register_v3 (247) with row v2, a manager key filter, manager_options (key, mapped or tidy name, count of the selection without the manager filter) and paid totals using «Оплачено в валюте договора» (253).';
COMMENT ON FUNCTION platform.manage_sales_register_v2(UUID, TEXT, UUID, BIGINT, JSONB, BIGINT, TEXT, TEXT, UUID) IS
  'manage_sales_register_v1 with «Оплачено в валюте договора» (253): same gates, replay and audit; a currency difference flags a record only while that amount is missing.';
COMMENT ON FUNCTION platform.read_sales_manager_labels_v1(UUID) IS
  '«Менеджеры в отчёте» (253): keys with raw spellings, record counts and the current mapping; sales.register.import at organization scope.';
COMMENT ON FUNCTION platform.save_sales_manager_label_v1(UUID, TEXT, BIGINT, TEXT, UUID, UUID) IS
  'Save the owner''s name for a manager spelling key (253): optimistic version, request-id replay, audit; sales.register.import at organization scope.';

NOTIFY pgrst, 'reload schema';
COMMIT;
