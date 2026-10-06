-- «Маркетинг» М1, шаг 1 (docs/EVO_MARKETING_PLAN_2026-10-06.md §3.2, §8 С4): касания источника
-- заявки и необязательные метки формы сайта.
--
--  a) platform_private.lead_attribution_touches: только добавление (триггеры append-only и
--     no-truncate как у website_lead_receipts, 170), RLS включён и форсирован, политик нет,
--     REVOKE ALL: читают только RPC. Вид касания — website_form (метки формы), staff_manual
--     (сотрудник при создании лида), staff_correction (исправление в Lead 360). `fbclid` не
--     хранится, только признак has_fbclid.
--  b) platform_private.attribution_value / sanitize_lead_attribution: одна проверка меток в SQL
--     (§8 С4): значение с '@', 7+ цифрами подряд, длиннее 100 знаков или с лишними символами
--     отбрасывается; utm_id — только цифры; landing_path ≤ 200 без ?, # и @; referrer_host —
--     только hostname ≤ 253; seen_at не в будущем и не старше 30 суток. Никогда не бросает
--     исключение: плохие метки не дают отказа заявке.
--  c) platform.receive_website_lead: DROP + CREATE с тем же списком параметров плюс
--     p_attribution JSONB DEFAULT NULL (у RPC одна сигнатура, как в 231; PostgREST не терпит
--     двух) и тем же ACL (только service_role). Тело — побайтово тело миграции 262 (240 с
--     переменной contact_phone вместо normalized_phone; исправление 42702 — в 262, не здесь),
--     кроме объявления `touch JSONB; joined BOOLEAN`, вставки касания после квитанции и
--     вычисления `joined`; миграция отказывается выполняться, если живое тело не равно телу
--     262 (md5). Метки не попадают в payload квитанции; повтор с тем же
--     requestId и другими метками — обычный accepted без второго касания (первая запись
--     побеждает); заявка, присоединённая к открытому лиду (240), добавляет касание этому лиду.
BEGIN;

CREATE TABLE platform_private.lead_attribution_touches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations(id),
  lead_id UUID NOT NULL,
  touch_kind TEXT NOT NULL CHECK (touch_kind IN ('website_form','staff_manual','staff_correction')),
  evidence TEXT NOT NULL CHECK (evidence IN ('utm_tagged','referrer','staff_asserted','message_code')),
  staff_channel TEXT CHECK (staff_channel IN ('instagram_ads','instagram','website_search','referral','other','unknown')),
  utm_source TEXT CHECK (length(utm_source) BETWEEN 1 AND 100),
  utm_medium TEXT CHECK (length(utm_medium) BETWEEN 1 AND 100),
  utm_campaign TEXT CHECK (length(utm_campaign) BETWEEN 1 AND 100),
  utm_content TEXT CHECK (length(utm_content) BETWEEN 1 AND 100),
  utm_term TEXT CHECK (length(utm_term) BETWEEN 1 AND 100),
  utm_id TEXT CHECK (utm_id ~ '^[0-9]{1,20}$'),
  has_fbclid BOOLEAN NOT NULL DEFAULT FALSE,
  referrer_host TEXT CHECK (length(referrer_host) BETWEEN 1 AND 253),
  landing_path TEXT CHECK (length(landing_path) BETWEEN 1 AND 200 AND landing_path !~ '[?#]'),
  seen_at TIMESTAMPTZ,
  request_id UUID NOT NULL,
  created_by UUID REFERENCES platform.organization_memberships(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  FOREIGN KEY (organization_id,lead_id) REFERENCES platform.leads(organization_id,id),
  -- A website touch is measured data from the form: no staff fields. A staff touch is only
  -- what staff asserted: a channel and an author, never form data.
  CONSTRAINT lead_attribution_touches_shape CHECK (
    (touch_kind='website_form' AND staff_channel IS NULL AND created_by IS NULL AND evidence IN ('utm_tagged','referrer'))
    OR (touch_kind IN ('staff_manual','staff_correction') AND staff_channel IS NOT NULL AND created_by IS NOT NULL
      AND evidence='staff_asserted' AND utm_source IS NULL AND utm_medium IS NULL AND utm_campaign IS NULL
      AND utm_content IS NULL AND utm_term IS NULL AND utm_id IS NULL AND NOT has_fbclid
      AND referrer_host IS NULL AND landing_path IS NULL AND seen_at IS NULL))
);
CREATE UNIQUE INDEX lead_attribution_touches_kind_request ON platform_private.lead_attribution_touches (touch_kind,request_id);
CREATE INDEX lead_attribution_touches_lead ON platform_private.lead_attribution_touches
  (organization_id,lead_id,created_at,id);
CREATE INDEX lead_attribution_touches_created ON platform_private.lead_attribution_touches
  (organization_id,created_at DESC);
ALTER TABLE platform_private.lead_attribution_touches ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.lead_attribution_touches FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform_private.lead_attribution_touches FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
CREATE TRIGGER lead_attribution_touches_append_only BEFORE UPDATE OR DELETE ON platform_private.lead_attribution_touches
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER lead_attribution_touches_no_truncate BEFORE TRUNCATE ON platform_private.lead_attribution_touches
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();

-- One value of the attribution object, or NULL when it must be dropped. Kinds: token (utm_source,
-- utm_medium), label (utm_campaign/content/term: letters, digits, space), id (utm_id), host, path.
CREATE FUNCTION platform_private.attribution_value(p_value JSONB,p_kind TEXT)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE v TEXT; max_length INTEGER;
BEGIN
  IF jsonb_typeof(p_value) IS DISTINCT FROM 'string' THEN RETURN NULL; END IF;
  v:=btrim(p_value #>> '{}');
  IF v IS NULL OR v='' THEN RETURN NULL; END IF;
  IF p_kind='id' THEN RETURN CASE WHEN v ~ '^[0-9]{1,20}$' THEN v END; END IF;
  max_length:=CASE p_kind WHEN 'host' THEN 253 WHEN 'path' THEN 200 ELSE 100 END;
  IF length(v)>max_length OR v ~ '@' OR v ~* '%40' OR v ~ '[0-9]{7,}' THEN RETURN NULL; END IF;
  RETURN CASE p_kind
    WHEN 'token' THEN CASE WHEN v ~ '^[A-Za-z0-9_.:~-]+$' THEN v END
    WHEN 'label' THEN CASE WHEN v ~ '^[A-Za-z0-9Ѐ-ӿ_.:~ -]+$' THEN v END
    WHEN 'host' THEN CASE WHEN lower(v) ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' THEN lower(v) END
    WHEN 'path' THEN CASE WHEN v ~ '^/[A-Za-z0-9_.~/%:+,=-]*$' THEN v END
  END;
END $$;

-- The whole attribution object: only surviving fields, or NULL when nothing survives. seen_at alone
-- is not attribution. has_fbclid is kept only when true.
CREATE FUNCTION platform_private.sanitize_lead_attribution(p_attribution JSONB,p_now TIMESTAMPTZ DEFAULT statement_timestamp())
RETURNS JSONB LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE result JSONB; seen TEXT;
BEGIN
  IF jsonb_typeof(p_attribution) IS DISTINCT FROM 'object' THEN RETURN NULL; END IF;
  result:=jsonb_strip_nulls(jsonb_build_object(
    'utm_source',platform_private.attribution_value(p_attribution->'utm_source','token'),
    'utm_medium',platform_private.attribution_value(p_attribution->'utm_medium','token'),
    'utm_campaign',platform_private.attribution_value(p_attribution->'utm_campaign','label'),
    'utm_content',platform_private.attribution_value(p_attribution->'utm_content','label'),
    'utm_term',platform_private.attribution_value(p_attribution->'utm_term','label'),
    'utm_id',platform_private.attribution_value(p_attribution->'utm_id','id'),
    'has_fbclid',CASE WHEN p_attribution->'has_fbclid'='true'::JSONB THEN TRUE END,
    'referrer_host',platform_private.attribution_value(p_attribution->'referrer_host','host'),
    'landing_path',platform_private.attribution_value(p_attribution->'landing_path','path')));
  IF result='{}'::JSONB THEN RETURN NULL; END IF;
  IF jsonb_typeof(p_attribution->'seen_at')='string' THEN
    seen:=p_attribution->>'seen_at';
    IF seen ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}(:?\d{2})?)$'
      AND pg_input_is_valid(seen,'timestamptz') THEN
      IF seen::TIMESTAMPTZ<=p_now AND seen::TIMESTAMPTZ>=p_now-INTERVAL '30 days' THEN
        result:=result||jsonb_build_object('seen_at',seen::TIMESTAMPTZ);
      END IF;
    END IF;
  END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION platform_private.attribution_value(JSONB,TEXT),
  platform_private.sanitize_lead_attribution(JSONB,TIMESTAMPTZ)
  FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;

-- The new body is 262's body plus the attribution additions: refuse any other starting point (262 not
-- applied, or the function changed since).
DO $a263_anchor$
DECLARE live_md5 TEXT;
BEGIN
  SELECT pg_catalog.md5(p.prosrc) INTO live_md5 FROM pg_catalog.pg_proc p
    WHERE p.oid=to_regprocedure('platform.receive_website_lead(uuid,uuid,uuid,text,text,integer,text,text,boolean,text,jsonb)');
  IF live_md5 IS DISTINCT FROM '7dc77f2607cc62b1f644572481d850e6' THEN
    RAISE EXCEPTION 'a263_attribution_anchor_mismatch: receive_website_lead is not the migration 262 body (md5 %)',live_md5;
  END IF;
END
$a263_anchor$;

DROP FUNCTION platform.receive_website_lead(UUID,UUID,UUID,TEXT,TEXT,INTEGER,TEXT,TEXT,BOOLEAN,TEXT,JSONB);

CREATE FUNCTION platform.receive_website_lead(
  p_organization_id UUID,p_owner_membership_id UUID,p_request_id UUID,
  p_name TEXT,p_phone TEXT,p_age INTEGER,p_city TEXT,p_country TEXT,
  p_consent BOOLEAN,p_ip_hash TEXT,p_university JSONB DEFAULT NULL,p_attribution JSONB DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE receipt platform_private.website_lead_receipts%ROWTYPE;
  contact_phone TEXT; payload JSONB; resolved_client UUID; resolved_lead UUID;
  matching_clients INTEGER; attempts INTEGER; direction TEXT; touch JSONB;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'website_intake_forbidden' USING ERRCODE='42501';
  END IF;
  contact_phone:=platform_private.normalize_person_phone(NULLIF(btrim(p_phone),''));
  IF p_request_id IS NULL OR p_request_id='00000000-0000-0000-0000-000000000000'::UUID
    OR p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 300 OR p_name ~ '[[:cntrl:]]'
    OR contact_phone IS NULL OR contact_phone !~ '^\+?[0-9]{7,15}$'
    OR (p_age IS NOT NULL AND p_age NOT BETWEEN 10 AND 100)
    OR (p_city IS NOT NULL AND (length(btrim(p_city)) NOT BETWEEN 1 AND 150 OR p_city ~ '[[:cntrl:]]'))
    OR p_country IS NULL OR p_country NOT IN ('China','Malaysia','Europe','Germany','United Kingdom',
      'Italy','Netherlands','France','Poland','Czechia','Austria','Cyprus',
      'United Arab Emirates','Turkey','Undecided')
    OR p_consent IS DISTINCT FROM TRUE OR p_ip_hash IS NULL OR p_ip_hash !~ '^[0-9a-f]{64}$'
  THEN RAISE EXCEPTION 'website_intake_invalid' USING ERRCODE='22023'; END IF;
  IF p_university IS NOT NULL THEN
    IF jsonb_typeof(p_university) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'website_intake_invalid' USING ERRCODE='22023';
    END IF;
    IF NOT (p_university ?& ARRAY['slug','name'])
      OR p_university - ARRAY['slug','name'] <> '{}'::JSONB
      OR jsonb_typeof(p_university->'slug') IS DISTINCT FROM 'string'
      OR jsonb_typeof(p_university->'name') IS DISTINCT FROM 'string'
      OR length(p_university->>'slug') NOT BETWEEN 1 AND 120
      OR (p_university->>'slug') !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
      OR length(p_university->>'name') NOT BETWEEN 1 AND 300
      OR length(btrim(p_university->>'name'))=0
      OR (p_university->>'name') ~ '[[:cntrl:]]'
    THEN RAISE EXCEPTION 'website_intake_invalid' USING ERRCODE='22023'; END IF;
    p_university:=jsonb_build_object('slug',p_university->>'slug','name',btrim(p_university->>'name'));
  END IF;
  PERFORM 1 FROM platform.organizations o WHERE o.id=p_organization_id AND o.status='active' FOR KEY SHARE;
  IF NOT FOUND OR p_owner_membership_id IS NULL
    OR NOT platform_private.staff_can_receive_assignment(p_organization_id,p_owner_membership_id,'lead.read','lead',NULL)
    OR NOT platform_private.staff_can_receive_assignment(p_organization_id,p_owner_membership_id,'lead.sales.workflow.manage','lead',NULL)
  THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  payload:=jsonb_build_object('name',btrim(p_name),'phone',contact_phone,'age',p_age,
    'city',NULLIF(btrim(p_city),''),'country',btrim(p_country),'consent',TRUE);
  -- Preserve the exact legacy payload for retries from already-open older forms.
  -- A supplied university participates in request-id conflict detection.
  IF p_university IS NOT NULL THEN payload:=payload||jsonb_build_object('university',p_university); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('website-request:'||p_request_id::TEXT,0));
  SELECT * INTO receipt FROM platform_private.website_lead_receipts r WHERE r.request_id=p_request_id;
  IF FOUND THEN
    IF receipt.organization_id<>p_organization_id OR receipt.payload<>payload THEN
      RETURN jsonb_build_object('status','request_conflict');
    END IF;
    RETURN jsonb_build_object('status','accepted','request_id',p_request_id);
  END IF;
  -- Durable global cap bounds the number of IP buckets an attacker can create.
  INSERT INTO platform_private.website_intake_limits AS limits VALUES(p_organization_id,'organization',statement_timestamp(),1)
    ON CONFLICT(organization_id,bucket) DO UPDATE SET
      attempts=CASE WHEN limits.window_start<=statement_timestamp()-INTERVAL '1 hour' THEN 1 ELSE limits.attempts+1 END,
      window_start=CASE WHEN limits.window_start<=statement_timestamp()-INTERVAL '1 hour' THEN statement_timestamp() ELSE limits.window_start END
    RETURNING limits.attempts INTO attempts;
  IF attempts>100 THEN RETURN jsonb_build_object('status','rate_limited'); END IF;
  DELETE FROM platform_private.website_intake_limits WHERE organization_id=p_organization_id
    AND bucket<>'organization' AND window_start<statement_timestamp()-INTERVAL '1 day';
  INSERT INTO platform_private.website_intake_limits AS limits VALUES(p_organization_id,p_ip_hash,statement_timestamp(),1)
    ON CONFLICT(organization_id,bucket) DO UPDATE SET
      attempts=CASE WHEN limits.window_start<=statement_timestamp()-INTERVAL '10 minutes' THEN 1 ELSE limits.attempts+1 END,
      window_start=CASE WHEN limits.window_start<=statement_timestamp()-INTERVAL '10 minutes' THEN statement_timestamp() ELSE limits.window_start END
    RETURNING limits.attempts INTO attempts;
  IF attempts>5 THEN RETURN jsonb_build_object('status','rate_limited'); END IF;
  -- Shares the manual-intake contact lock, preventing competing client creation.
  PERFORM pg_advisory_xact_lock(hashtextextended('manual-lead-contact:'||p_organization_id::TEXT||':'||contact_phone,0));
  SELECT count(*),min(c.id::TEXT)::UUID INTO matching_clients,resolved_client FROM platform.clients c
    WHERE c.organization_id=p_organization_id AND c.lifecycle_state='active' AND c.normalized_phone=contact_phone;
  IF matching_clients>1 THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  IF resolved_client IS NOT NULL THEN
    SELECT l.id INTO resolved_lead FROM platform.leads l WHERE l.organization_id=p_organization_id
      AND l.client_id=resolved_client AND l.lifecycle_state='open'
      ORDER BY l.updated_at DESC,l.id LIMIT 1 FOR UPDATE;
  ELSE
    resolved_client:=platform_private.create_or_link_client(p_organization_id,btrim(p_name),NULL,contact_phone,
      'evo_website','client',p_request_id::TEXT,'website_submitted',statement_timestamp(),NULL,NULL);
  END IF;
  IF resolved_lead IS NULL THEN
    resolved_lead:=platform_private.create_or_link_lead(p_organization_id,resolved_client,p_owner_membership_id,
      'new','website','evo_website','lead',p_request_id::TEXT,'website_submitted',statement_timestamp(),NULL,NULL);
    direction:=CASE lower(btrim(p_country)) WHEN 'china' THEN 'CN' WHEN 'malaysia' THEN 'MY' WHEN 'europe' THEN 'EU'
      WHEN 'turkey' THEN 'TR' WHEN 'turkiye' THEN 'TR' WHEN 'united arab emirates' THEN 'AE'
      WHEN 'uae' THEN 'AE' WHEN 'germany' THEN 'EU' WHEN 'italy' THEN 'EU'
      WHEN 'netherlands' THEN 'EU' WHEN 'france' THEN 'EU' WHEN 'poland' THEN 'EU'
      WHEN 'united kingdom' THEN 'EU' WHEN 'czechia' THEN 'EU'
      WHEN 'austria' THEN 'EU' WHEN 'cyprus' THEN 'EU' WHEN 'undecided' THEN NULL ELSE NULL END;
    UPDATE platform.leads SET interest_direction=direction WHERE id=resolved_lead AND organization_id=p_organization_id;
  END IF;
  INSERT INTO platform_private.website_lead_receipts(request_id,organization_id,lead_id,payload)
    VALUES(p_request_id,p_organization_id,resolved_lead,payload);
  -- Attribution never enters the receipt payload (request-id conflict detection stays
  -- byte-for-byte as before) and never rejects a lead: bad values are dropped, a touch is
  -- written only when something survives. A replay returned above, before this point.
  touch:=platform_private.sanitize_lead_attribution(p_attribution,statement_timestamp());
  IF touch IS NOT NULL THEN
    INSERT INTO platform_private.lead_attribution_touches(organization_id,lead_id,touch_kind,evidence,
      utm_source,utm_medium,utm_campaign,utm_content,utm_term,utm_id,has_fbclid,referrer_host,landing_path,seen_at,request_id)
    VALUES(p_organization_id,resolved_lead,'website_form',
      CASE WHEN touch ?| ARRAY['utm_source','utm_medium','utm_campaign','utm_content','utm_term','utm_id','has_fbclid']
        THEN 'utm_tagged' ELSE 'referrer' END,
      touch->>'utm_source',touch->>'utm_medium',touch->>'utm_campaign',touch->>'utm_content',touch->>'utm_term',
      touch->>'utm_id',coalesce((touch->>'has_fbclid')::BOOLEAN,FALSE),touch->>'referrer_host',touch->>'landing_path',
      (touch->>'seen_at')::TIMESTAMPTZ,p_request_id)
    ON CONFLICT(touch_kind,request_id) DO NOTHING;
  END IF;
  INSERT INTO platform.audit_events(organization_id,actor_kind,actor_principal,action,resource_type,resource_id,after_state,reason,request_id)
    VALUES(p_organization_id,'service','evo-website','lead.website.receive','lead',resolved_lead,
      jsonb_build_object('source_key','website','request_id',p_request_id),'Website inquiry received with consent',p_request_id);
  RETURN jsonb_build_object('status','accepted','request_id',p_request_id);
END $$;
REVOKE ALL ON FUNCTION platform.receive_website_lead(UUID,UUID,UUID,TEXT,TEXT,INTEGER,TEXT,TEXT,BOOLEAN,TEXT,JSONB,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION platform.receive_website_lead(UUID,UUID,UUID,TEXT,TEXT,INTEGER,TEXT,TEXT,BOOLEAN,TEXT,JSONB,JSONB) TO service_role;

-- One signature, service_role only, definer with the empty search_path; the touches table is closed to
-- every client role and append-only; private helpers are not callable by client roles.
DO $a263_verify$
DECLARE routine RECORD;
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.pronamespace='platform'::REGNAMESPACE
    AND p.proname='receive_website_lead')<>1
    OR to_regprocedure('platform.receive_website_lead(uuid,uuid,uuid,text,text,integer,text,text,boolean,text,jsonb,jsonb)') IS NULL
  THEN RAISE EXCEPTION 'a263_attribution_verification_failed: receive_website_lead signature'; END IF;
  FOR routine IN SELECT p.oid::REGPROCEDURE AS signature,p.prosecdef,p.proconfig FROM pg_catalog.pg_proc p
    WHERE p.oid IN ('platform.receive_website_lead(uuid,uuid,uuid,text,text,integer,text,text,boolean,text,jsonb,jsonb)'::regprocedure,
      'platform_private.attribution_value(jsonb,text)'::regprocedure,
      'platform_private.sanitize_lead_attribution(jsonb,timestamp with time zone)'::regprocedure)
  LOOP
    IF routine.proconfig IS DISTINCT FROM ARRAY['search_path=""']
      OR has_function_privilege('anon',routine.signature,'EXECUTE')
      OR has_function_privilege('authenticated',routine.signature,'EXECUTE')
      OR has_function_privilege('service_role',routine.signature,'EXECUTE')
        IS DISTINCT FROM (routine.signature::TEXT LIKE 'platform.receive_website_lead%')
    THEN RAISE EXCEPTION 'a263_attribution_verification_failed: %',routine.signature; END IF;
  END LOOP;
  IF NOT (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid='platform.receive_website_lead(uuid,uuid,uuid,text,text,integer,text,text,boolean,text,jsonb,jsonb)'::regprocedure)
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid='platform_private.lead_attribution_touches'::REGCLASS
      AND c.relrowsecurity AND c.relforcerowsecurity)
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_policy pol WHERE pol.polrelid='platform_private.lead_attribution_touches'::REGCLASS)
    OR has_table_privilege('authenticated','platform_private.lead_attribution_touches','SELECT')
    OR has_table_privilege('service_role','platform_private.lead_attribution_touches','SELECT')
    OR has_table_privilege('service_role','platform_private.lead_attribution_touches','INSERT')
    OR (SELECT count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid='platform_private.lead_attribution_touches'::REGCLASS
      AND NOT t.tgisinternal AND t.tgname IN ('lead_attribution_touches_append_only','lead_attribution_touches_no_truncate'))<>2
  THEN RAISE EXCEPTION 'a263_attribution_verification_failed: touches table posture'; END IF;
END
$a263_verify$;

COMMENT ON TABLE platform_private.lead_attribution_touches IS
  'Касания источника заявки (263): только добавление; метки формы сайта, слова сотрудника и исправления. Читают только RPC раздела «Маркетинг» и проекция канала (264).';
COMMENT ON FUNCTION platform.receive_website_lead(UUID,UUID,UUID,TEXT,TEXT,INTEGER,TEXT,TEXT,BOOLEAN,TEXT,JSONB,JSONB) IS
  '240 + необязательные метки p_attribution (263): метки очищаются в SQL, пишутся отдельным касанием website_form и не входят в payload квитанции; повтор по requestId касания не добавляет.';

NOTIFY pgrst,'reload schema';
COMMIT;
