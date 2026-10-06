-- «Маркетинг» М1, шаг 3 (docs/EVO_MARKETING_PLAN_2026-10-06.md §4–§6): чтения раздела для admin и
-- ручной расход.
--
-- Доступ: КАЖДЫЙ RPC раздела проверяет положительно platform_role = 'admin' реального актёра
-- (current_actor_authority, как 071; admin = is_system_admin по staff_membership_identity). Роль
-- NULL приглашённых сотрудников (244), продажи, куратор, студент и вызов без членства получают
-- 42501. Новый ключ разрешения не вводится (до возврата роли маркетолога). Режим просмотра роли
-- для базы неотличим от admin — его отказ остаётся серверным условием маршрута и действий.
--
-- Определения не изобретаются, а переиспользуются:
--  * Заявки — лиды по created_at (дата Asia/Bishkek), ЛЮБОЙ lifecycle_state; open_count — для
--    сверки с «Пришло лидов» воронки (open-лиды того же периода);
--  * Квалифицированы — доказанный вход в qualified (квитанция + аудит, как 111) или передача
--    (сам вход в qualified у переданного мог не записаться, как funnel-source.ts); Переданы —
--    platform_private.sales_lead_handoffs (247);
--  * Договор лида — запись «Отчёта продаж» не в архиве с датой продажи по lead_id или, если её
--    нет, по linked_lead_id (254, пометка «связано вручную»);
--  * Продажи периода — запись не в архиве с signing_date в периоде (staff_sales_count_v1, 247);
--    сумма «по каналам» + «без привязки к лиду» сверяется с ним в самом ответе;
--  * Оплатили — цепочка handoffStripView: платежи дела (189, evo_service_fee не в архиве, за
--    вычетом возвратов, net > 0) → first_payment_received_date подтверждения вручную →
--    paid_minor > 0 с валютой ^[A-Z]{3}$ записи отчёта этого лида (lead_id, не в архиве; связанная
--    запись оплату не подтверждает). Разница с полосой названа в контракте;
--  * канал — platform_private.lead_channels (264), одно правило на все чтения.
-- Деньги — минорные единицы строкой и валюта; валюты не складываются.
BEGIN;

-- ---------------------------------------------------------------------------
-- a) manual spend: append-only, a cancel is a row that references the original
-- ---------------------------------------------------------------------------
CREATE TABLE platform_private.marketing_manual_spend (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations(id),
  request_id UUID NOT NULL UNIQUE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor BETWEEN 1 AND 1000000000000),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  campaign TEXT CHECK (campaign IS NULL OR (length(btrim(campaign)) BETWEEN 1 AND 100 AND campaign !~ '[[:cntrl:]]')),
  note TEXT CHECK (note IS NULL OR (length(btrim(note)) BETWEEN 1 AND 500 AND note !~ '[[:cntrl:]]')),
  cancels_spend_id UUID REFERENCES platform_private.marketing_manual_spend(id),
  created_by UUID NOT NULL REFERENCES platform.organization_memberships(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT marketing_manual_spend_period CHECK (period_start<=period_end AND period_end-period_start<=366
    AND period_start>=DATE '2000-01-01' AND period_end<=DATE '2100-12-31')
);
-- One cancel per entry; a cancel row copies the period, amount, currency and campaign it cancels.
CREATE UNIQUE INDEX marketing_manual_spend_one_cancel ON platform_private.marketing_manual_spend (cancels_spend_id)
  WHERE cancels_spend_id IS NOT NULL;
CREATE INDEX marketing_manual_spend_period_idx ON platform_private.marketing_manual_spend
  (organization_id,period_start,period_end);
ALTER TABLE platform_private.marketing_manual_spend ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.marketing_manual_spend FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform_private.marketing_manual_spend FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
CREATE TRIGGER marketing_manual_spend_append_only BEFORE UPDATE OR DELETE ON platform_private.marketing_manual_spend
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER marketing_manual_spend_no_truncate BEFORE TRUNCATE ON platform_private.marketing_manual_spend
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();

-- ---------------------------------------------------------------------------
-- b) the admin gate: positive platform_role = 'admin', nothing else
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.marketing_admin_actor()
RETURNS TABLE(organization_id UUID,membership_id UUID,profile_id UUID)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  RETURN QUERY SELECT a.organization_id,a.membership_id,a.profile_id FROM platform.current_actor_authority() a
    WHERE a.platform_role='admin'::platform.business_role AND a.membership_id IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'marketing_forbidden' USING ERRCODE='42501'; END IF;
END $$;

-- ---------------------------------------------------------------------------
-- c) the cohort: leads created in [from,to] (Asia/Bishkek), every lifecycle state, with every fact
--    the overview and the list need. No access check: private, the admin RPCs decide.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.marketing_cohort(p_organization_id UUID,p_from DATE,p_to DATE)
RETURNS TABLE(lead_id UUID,created_at TIMESTAMPTZ,lifecycle_state platform.lead_lifecycle_state,source_key TEXT,
  client_name TEXT,client_phone TEXT,owner_membership_id UUID,stage TEXT,channel TEXT,basis TEXT,corrected BOOLEAN,
  ai_assistant BOOLEAN,campaign TEXT,landing_path TEXT,qualified BOOLEAN,handed_off BOOLEAN,contract_signed_on DATE,
  contract_linked BOOLEAN,paid BOOLEAN,paid_amount_minor BIGINT,paid_currency TEXT,paid_source TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  WITH cohort AS MATERIALIZED (
    SELECT l.id,l.created_at,l.lifecycle_state,l.stage_key,l.source_key,l.current_owner_membership_id,
      c.display_name,c.normalized_phone
    FROM platform.leads l LEFT JOIN platform.clients c ON c.organization_id=l.organization_id AND c.id=l.client_id
    WHERE l.organization_id=p_organization_id
      AND l.created_at>=p_from::TIMESTAMP AT TIME ZONE 'Asia/Bishkek'
      AND l.created_at<(p_to+1)::TIMESTAMP AT TIME ZONE 'Asia/Bishkek'
  ), ids AS MATERIALIZED (SELECT coalesce(array_agg(c.id),ARRAY[]::UUID[]) AS ids FROM cohort c),
  handoffs AS MATERIALIZED (
    SELECT h.lead_id FROM platform_private.sales_lead_handoffs(p_organization_id,(SELECT ids.ids FROM ids)) h
  ), channels AS MATERIALIZED (
    SELECT * FROM platform_private.lead_channels(p_organization_id,(SELECT ids.ids FROM ids))
  ), entered_qualified AS MATERIALIZED (
    SELECT DISTINCT r.lead_id FROM platform_private.sales_lead_workflow_receipts r
    JOIN platform.audit_events ae ON ae.request_id=r.request_id AND ae.action='lead.sales.workflow.changed'
      AND ae.resource_id=r.lead_id
    WHERE r.organization_id=p_organization_id AND r.lead_id IN (SELECT cc.id FROM cohort cc)
      AND r.desired_stage_key='qualified'
      AND ae.before_state->>'stage_key' IS DISTINCT FROM ae.after_state->>'stage_key'
  ), sale AS MATERIALIZED (
    SELECT DISTINCT ON (x.lead_id) x.lead_id,x.signing_date,x.linked FROM (
      SELECT r.lead_id,NULLIF(r.fields->>'signing_date','')::DATE AS signing_date,FALSE AS linked
        FROM platform_private.sales_register r
        WHERE r.organization_id=p_organization_id AND NOT r.archived AND r.lead_id IN (SELECT cc.id FROM cohort cc)
      UNION ALL
      SELECT r.linked_lead_id,NULLIF(r.fields->>'signing_date','')::DATE,TRUE
        FROM platform_private.sales_register r
        WHERE r.organization_id=p_organization_id AND NOT r.archived AND r.linked_lead_id IN (SELECT cc.id FROM cohort cc)
    ) x WHERE x.signing_date IS NOT NULL
    ORDER BY x.lead_id,x.linked,x.signing_date
  ), case_money AS MATERIALIZED (
    SELECT sc.canonical_lead_id AS lead_id,
      coalesce(sum(e.amount_minor) FILTER (WHERE e.event_type='payment'),0)
        -coalesce(sum(e.amount_minor) FILTER (WHERE e.event_type='refund'),0) AS net,
      count(*) FILTER (WHERE e.event_type='payment') AS payments,
      count(DISTINCT e.currency) AS currencies,min(e.currency) AS currency
    FROM platform.student_cases sc
    JOIN platform.payment_events e ON e.organization_id=sc.organization_id AND e.student_case_id=sc.id
    JOIN platform.payment_obligations o ON o.organization_id=e.organization_id AND o.id=e.payment_obligation_id
      AND o.category='evo_service_fee' AND o.archived_at IS NULL
    WHERE sc.organization_id=p_organization_id AND sc.canonical_lead_id IN (SELECT cc.id FROM cohort cc)
    GROUP BY sc.canonical_lead_id
  ), gate AS MATERIALIZED (
    SELECT g.lead_id,g.first_payment_amount,g.first_payment_currency FROM platform.lead_admissions_gates g
    WHERE g.organization_id=p_organization_id AND g.lead_id IN (SELECT cc.id FROM cohort cc)
      AND g.first_payment_received_date IS NOT NULL
  ), report_paid AS MATERIALIZED (
    SELECT p.lead_id,p.minor,p.currency FROM (
      SELECT r.lead_id,
        CASE WHEN r.fields->>'paid_minor' ~ '^[0-9]{1,13}$' AND r.fields->>'paid_currency' ~ '^[A-Z]{3}$'
          THEN (r.fields->>'paid_minor')::BIGINT END AS minor,
        r.fields->>'paid_currency' AS currency
      FROM platform_private.sales_register r
      WHERE r.organization_id=p_organization_id AND NOT r.archived AND r.lead_id IN (SELECT cc.id FROM cohort cc)
    ) p WHERE p.minor>0
  )
  SELECT c.id,c.created_at,c.lifecycle_state,c.source_key,left(c.display_name,300),c.normalized_phone,
    c.current_owner_membership_id,
    platform_private.sales_lead_stage(c.lifecycle_state,c.stage_key,h.lead_id IS NOT NULL),
    ch.channel,ch.basis,ch.corrected,ch.ai_assistant,
    (SELECT t.utm_campaign FROM platform_private.lead_attribution_touches t
      WHERE t.organization_id=p_organization_id AND t.lead_id=c.id AND t.touch_kind='website_form'
        AND t.utm_campaign IS NOT NULL ORDER BY t.created_at,t.id LIMIT 1),
    (SELECT t.landing_path FROM platform_private.lead_attribution_touches t
      WHERE t.organization_id=p_organization_id AND t.lead_id=c.id AND t.touch_kind='website_form'
        AND t.landing_path IS NOT NULL ORDER BY t.created_at,t.id LIMIT 1),
    eq.lead_id IS NOT NULL OR h.lead_id IS NOT NULL,
    h.lead_id IS NOT NULL,
    s.signing_date,
    coalesce(s.linked,FALSE),
    (cm.payments>0 AND cm.net>0) OR g.lead_id IS NOT NULL OR rp.lead_id IS NOT NULL,
    CASE WHEN cm.payments>0 AND cm.net>0 THEN CASE WHEN cm.currencies=1 THEN cm.net END
      WHEN g.lead_id IS NOT NULL THEN round(g.first_payment_amount*100)::BIGINT
      WHEN rp.lead_id IS NOT NULL THEN rp.minor END,
    CASE WHEN cm.payments>0 AND cm.net>0 THEN CASE WHEN cm.currencies=1 THEN cm.currency END
      WHEN g.lead_id IS NOT NULL THEN g.first_payment_currency
      WHEN rp.lead_id IS NOT NULL THEN rp.currency END,
    CASE WHEN cm.payments>0 AND cm.net>0 THEN 'case' WHEN g.lead_id IS NOT NULL THEN 'gate'
      WHEN rp.lead_id IS NOT NULL THEN 'report' END
  FROM cohort c
  LEFT JOIN handoffs h ON h.lead_id=c.id
  LEFT JOIN channels ch ON ch.lead_id=c.id
  LEFT JOIN entered_qualified eq ON eq.lead_id=c.id
  LEFT JOIN sale s ON s.lead_id=c.id
  LEFT JOIN case_money cm ON cm.lead_id=c.id
  LEFT JOIN gate g ON g.lead_id=c.id
  LEFT JOIN report_paid rp ON rp.lead_id=c.id
$$;

-- ---------------------------------------------------------------------------
-- d) manual spend commands
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.marketing_spend_add_v1(p_request_id UUID,p_period_start DATE,p_period_end DATE,
  p_amount_minor BIGINT,p_currency TEXT,p_campaign TEXT DEFAULT NULL,p_note TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor RECORD; prior platform_private.marketing_manual_spend%ROWTYPE; saved platform_private.marketing_manual_spend%ROWTYPE;
  campaign_value TEXT:=NULLIF(btrim(p_campaign),''); note_value TEXT:=NULLIF(btrim(p_note),'');
BEGIN
  SELECT * INTO actor FROM platform_private.marketing_admin_actor();
  IF p_request_id IS NULL OR p_period_start IS NULL OR p_period_end IS NULL OR p_period_start>p_period_end
    OR p_period_end-p_period_start>366 OR p_period_start<DATE '2000-01-01' OR p_period_end>DATE '2100-12-31'
    OR p_amount_minor IS NULL OR p_amount_minor NOT BETWEEN 1 AND 1000000000000
    OR p_currency IS NULL OR p_currency !~ '^[A-Z]{3}$'
    OR (campaign_value IS NOT NULL AND (length(campaign_value)>100 OR campaign_value ~ '[[:cntrl:]]'))
    OR (note_value IS NOT NULL AND (length(note_value)>500 OR note_value ~ '[[:cntrl:]]'))
  THEN RAISE EXCEPTION 'marketing_spend_invalid' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('marketing-spend-request:'||p_request_id::TEXT,0));
  SELECT * INTO prior FROM platform_private.marketing_manual_spend s WHERE s.request_id=p_request_id;
  IF FOUND THEN
    IF prior.organization_id<>actor.organization_id OR prior.created_by<>actor.membership_id
      OR prior.cancels_spend_id IS NOT NULL OR prior.period_start<>p_period_start OR prior.period_end<>p_period_end
      OR prior.amount_minor<>p_amount_minor OR prior.currency<>p_currency
      OR prior.campaign IS DISTINCT FROM campaign_value OR prior.note IS DISTINCT FROM note_value
    THEN RAISE EXCEPTION 'marketing_spend_request_conflict' USING ERRCODE='22023'; END IF;
    saved:=prior;
  ELSE
    INSERT INTO platform_private.marketing_manual_spend(organization_id,request_id,period_start,period_end,amount_minor,
      currency,campaign,note,created_by)
    VALUES(actor.organization_id,p_request_id,p_period_start,p_period_end,p_amount_minor,p_currency,campaign_value,
      note_value,actor.membership_id) RETURNING * INTO saved;
  END IF;
  RETURN jsonb_build_object('status','saved','spend_id',saved.id,'request_id',saved.request_id,
    'period_start',saved.period_start,'period_end',saved.period_end,'amount_minor',saved.amount_minor::TEXT,
    'currency',saved.currency,'campaign',saved.campaign,'note',saved.note,'created_at',saved.created_at);
END $$;

CREATE FUNCTION platform.marketing_spend_cancel_v1(p_request_id UUID,p_spend_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor RECORD; original platform_private.marketing_manual_spend%ROWTYPE; prior platform_private.marketing_manual_spend%ROWTYPE;
  cancel_row platform_private.marketing_manual_spend%ROWTYPE;
BEGIN
  SELECT * INTO actor FROM platform_private.marketing_admin_actor();
  IF p_request_id IS NULL OR p_spend_id IS NULL THEN RAISE EXCEPTION 'marketing_spend_invalid' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('marketing-spend-request:'||p_request_id::TEXT,0));
  SELECT * INTO prior FROM platform_private.marketing_manual_spend s WHERE s.request_id=p_request_id;
  IF FOUND THEN
    IF prior.organization_id<>actor.organization_id OR prior.created_by<>actor.membership_id
      OR prior.cancels_spend_id IS DISTINCT FROM p_spend_id
    THEN RAISE EXCEPTION 'marketing_spend_request_conflict' USING ERRCODE='22023'; END IF;
    cancel_row:=prior;
  ELSE
    SELECT * INTO original FROM platform_private.marketing_manual_spend s
      WHERE s.id=p_spend_id AND s.organization_id=actor.organization_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'marketing_spend_not_found' USING ERRCODE='P0002'; END IF;
    IF original.cancels_spend_id IS NOT NULL THEN RAISE EXCEPTION 'marketing_spend_invalid' USING ERRCODE='22023'; END IF;
    IF EXISTS(SELECT 1 FROM platform_private.marketing_manual_spend s WHERE s.cancels_spend_id=original.id) THEN
      RAISE EXCEPTION 'marketing_spend_already_cancelled' USING ERRCODE='PT409';
    END IF;
    INSERT INTO platform_private.marketing_manual_spend(organization_id,request_id,period_start,period_end,amount_minor,
      currency,campaign,note,cancels_spend_id,created_by)
    VALUES(actor.organization_id,p_request_id,original.period_start,original.period_end,original.amount_minor,
      original.currency,original.campaign,NULL,original.id,actor.membership_id) RETURNING * INTO cancel_row;
  END IF;
  RETURN jsonb_build_object('status','cancelled','spend_id',cancel_row.cancels_spend_id,'cancel_id',cancel_row.id,
    'request_id',cancel_row.request_id,'created_at',cancel_row.created_at);
END $$;

-- ---------------------------------------------------------------------------
-- e) overview: block A (cohort), block B (sales of the period), spend, reconciliation
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.marketing_overview_v1(p_from DATE,p_to DATE)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor RECORD; result JSONB; report_sales BIGINT;
BEGIN
  SELECT * INTO actor FROM platform_private.marketing_admin_actor();
  IF p_from IS NULL OR p_to IS NULL OR p_from>p_to OR p_from<DATE '1900-01-01' OR p_to>DATE '2100-12-31'
    OR p_to-p_from>365 THEN RAISE EXCEPTION 'marketing_period_invalid' USING ERRCODE='22023'; END IF;
  report_sales:=(platform.staff_sales_count_v1(actor.organization_id,p_from,p_to)->>'sales')::BIGINT;
  WITH channel_keys(key,ord) AS (VALUES ('instagram_ads',1),('instagram',2),('website_search',3),('referral',4),('other',5),('unknown',6)),
  cohort AS MATERIALIZED (SELECT * FROM platform_private.marketing_cohort(actor.organization_id,p_from,p_to)),
  paid_amounts AS (
    SELECT c.channel,c.paid_currency,sum(c.paid_amount_minor) AS amount,count(*) AS leads FROM cohort c
    WHERE c.paid AND c.paid_amount_minor IS NOT NULL GROUP BY c.channel,c.paid_currency
  ), cohort_rows AS (
    SELECT k.key,k.ord,count(c.lead_id) AS leads,
      count(c.lead_id) FILTER (WHERE c.qualified) AS qualified,
      count(c.lead_id) FILTER (WHERE c.handed_off) AS handed_off,
      count(c.lead_id) FILTER (WHERE c.contract_signed_on IS NOT NULL) AS contract,
      count(c.lead_id) FILTER (WHERE c.contract_signed_on IS NOT NULL AND c.contract_linked) AS contract_linked,
      count(c.lead_id) FILTER (WHERE c.paid) AS paid,
      count(c.lead_id) FILTER (WHERE c.paid AND c.paid_amount_minor IS NULL) AS paid_without_amount,
      count(c.lead_id) FILTER (WHERE c.basis='utm') AS basis_utm,
      count(c.lead_id) FILTER (WHERE c.basis='referrer') AS basis_referrer,
      count(c.lead_id) FILTER (WHERE c.basis='staff') AS basis_staff,
      count(c.lead_id) FILTER (WHERE c.basis='corrected') AS basis_corrected,
      count(c.lead_id) FILTER (WHERE c.basis='unknown') AS basis_unknown,
      count(c.lead_id) FILTER (WHERE c.ai_assistant) AS ai_assistant,
      coalesce((SELECT jsonb_agg(jsonb_build_object('currency',p.paid_currency,'amount_minor',p.amount::TEXT,'leads',p.leads)
        ORDER BY p.paid_currency) FROM paid_amounts p WHERE p.channel=k.key),'[]'::JSONB) AS paid_amounts
    FROM channel_keys k LEFT JOIN cohort c ON c.channel=k.key GROUP BY k.key,k.ord
  ), period_sales AS MATERIALIZED (
    SELECT r.id,coalesce(r.lead_id,r.linked_lead_id) AS lead_id,(r.lead_id IS NULL AND r.linked_lead_id IS NOT NULL) AS linked,
      CASE WHEN r.fields->>'service_cost_minor' ~ '^[0-9]{1,13}$' AND r.fields->>'service_cost_currency' ~ '^[A-Z]{3}$'
        THEN (r.fields->>'service_cost_minor')::BIGINT END AS cost_minor,
      r.fields->>'service_cost_currency' AS cost_currency
    FROM platform_private.sales_register r
    WHERE r.organization_id=actor.organization_id AND NOT r.archived
      AND NULLIF(r.fields->>'signing_date','')::DATE BETWEEN p_from AND p_to
  ), sale_channels AS MATERIALIZED (
    SELECT * FROM platform_private.lead_channels(actor.organization_id,
      ARRAY(SELECT s.lead_id FROM period_sales s WHERE s.lead_id IS NOT NULL))
  ), sales_tagged AS (
    SELECT s.id,s.linked,s.cost_minor,
      CASE WHEN s.cost_minor IS NOT NULL THEN s.cost_currency END AS cost_currency,
      CASE WHEN s.lead_id IS NULL THEN 'without_lead' ELSE coalesce(ch.channel,'unknown') END AS channel
    FROM period_sales s LEFT JOIN sale_channels ch ON ch.lead_id=s.lead_id
  ), sale_amounts AS (
    SELECT t.channel,t.cost_currency,sum(t.cost_minor) AS amount,count(*) AS contracts FROM sales_tagged t
    WHERE t.cost_minor IS NOT NULL GROUP BY t.channel,t.cost_currency
  ), sales_keys(key,ord) AS (SELECT key,ord FROM channel_keys UNION ALL SELECT 'without_lead',7),
  sales_rows AS (
    SELECT k.key,k.ord,count(t.id) AS contracts,count(t.id) FILTER (WHERE t.linked) AS linked_manually,
      count(t.id) FILTER (WHERE t.cost_minor IS NULL) AS amount_missing,
      coalesce((SELECT jsonb_agg(jsonb_build_object('currency',a.cost_currency,'amount_minor',a.amount::TEXT,'contracts',a.contracts)
        ORDER BY a.cost_currency) FROM sale_amounts a WHERE a.channel=k.key),'[]'::JSONB) AS amounts
    FROM sales_keys k LEFT JOIN sales_tagged t ON t.channel=k.key GROUP BY k.key,k.ord
  ), spend_active AS (
    SELECT s.* FROM platform_private.marketing_manual_spend s
    WHERE s.organization_id=actor.organization_id AND s.cancels_spend_id IS NULL
      AND NOT EXISTS(SELECT 1 FROM platform_private.marketing_manual_spend x WHERE x.cancels_spend_id=s.id)
      AND s.period_end>=p_from AND s.period_start<=p_to
  ), spend_json AS (
    SELECT s.*,(s.period_start>=p_from AND s.period_end<=p_to) AS inside FROM spend_active s
  )
  SELECT jsonb_build_object(
    'organization_id',actor.organization_id,'from',p_from,'to',p_to,'time_zone','Asia/Bishkek',
    'cohort',jsonb_build_object(
      'total',(SELECT count(*) FROM cohort),
      'open_count',(SELECT count(*) FROM cohort c WHERE c.lifecycle_state='open'),
      'source_keys',coalesce((SELECT jsonb_object_agg(x.source_key,x.n) FROM (SELECT c.source_key,count(*) AS n FROM cohort c GROUP BY c.source_key) x),'{}'::JSONB),
      'repeat_submissions',(SELECT count(*) FROM platform_private.website_lead_receipts r
        JOIN platform.leads l ON l.organization_id=r.organization_id AND l.id=r.lead_id
        WHERE r.organization_id=actor.organization_id AND r.created_at>l.created_at
          AND r.created_at>=p_from::TIMESTAMP AT TIME ZONE 'Asia/Bishkek'
          AND r.created_at<(p_to+1)::TIMESTAMP AT TIME ZONE 'Asia/Bishkek'),
      'totals',jsonb_build_object('leads',(SELECT count(*) FROM cohort),
        'qualified',(SELECT count(*) FROM cohort c WHERE c.qualified),
        'handed_off',(SELECT count(*) FROM cohort c WHERE c.handed_off),
        'contract',(SELECT count(*) FROM cohort c WHERE c.contract_signed_on IS NOT NULL),
        'contract_linked',(SELECT count(*) FROM cohort c WHERE c.contract_signed_on IS NOT NULL AND c.contract_linked),
        'paid',(SELECT count(*) FROM cohort c WHERE c.paid),
        'paid_without_amount',(SELECT count(*) FROM cohort c WHERE c.paid AND c.paid_amount_minor IS NULL)),
      'channels',(SELECT jsonb_agg(jsonb_build_object('channel',r.key,'leads',r.leads,'qualified',r.qualified,
        'handed_off',r.handed_off,'contract',r.contract,'contract_linked',r.contract_linked,'paid',r.paid,
        'paid_without_amount',r.paid_without_amount,'paid_amounts',r.paid_amounts,'ai_assistant',r.ai_assistant,
        'basis',jsonb_build_object('utm',r.basis_utm,'referrer',r.basis_referrer,'staff',r.basis_staff,
          'corrected',r.basis_corrected,'unknown',r.basis_unknown)) ORDER BY r.ord) FROM cohort_rows r)),
    'sales',jsonb_build_object(
      'total',(SELECT count(*) FROM period_sales),
      'channels',(SELECT jsonb_agg(jsonb_build_object('channel',r.key,'contracts',r.contracts,'linked_manually',r.linked_manually,
        'amount_missing',r.amount_missing,'amounts',r.amounts) ORDER BY r.ord) FROM sales_rows r),
      'reconciliation',jsonb_build_object(
        'by_channel_plus_without_lead',(SELECT coalesce(sum(r.contracts),0) FROM sales_rows r),
        'report_sales',report_sales,
        'difference',(SELECT coalesce(sum(r.contracts),0) FROM sales_rows r)-report_sales,
        'matches',(SELECT coalesce(sum(r.contracts),0) FROM sales_rows r)=report_sales)),
    'spend',jsonb_build_object(
      'inside_period',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'period_start',s.period_start,'period_end',s.period_end,
        'amount_minor',s.amount_minor::TEXT,'currency',s.currency,'campaign',s.campaign,'note',s.note,'created_at',s.created_at)
        ORDER BY s.period_start,s.created_at,s.id) FROM spend_json s WHERE s.inside),'[]'::JSONB),
      'inside_totals',coalesce((SELECT jsonb_agg(jsonb_build_object('currency',x.currency,'amount_minor',x.amount::TEXT) ORDER BY x.currency)
        FROM (SELECT s.currency,sum(s.amount_minor) AS amount FROM spend_json s WHERE s.inside GROUP BY s.currency) x),'[]'::JSONB),
      'partially_overlapping',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'period_start',s.period_start,'period_end',s.period_end,
        'amount_minor',s.amount_minor::TEXT,'currency',s.currency,'campaign',s.campaign,'note',s.note,'created_at',s.created_at)
        ORDER BY s.period_start,s.created_at,s.id) FROM spend_json s WHERE NOT s.inside),'[]'::JSONB)))
  INTO result;
  RETURN result;
END $$;

-- ---------------------------------------------------------------------------
-- f) the leads list
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.marketing_leads_v1(p_from DATE,p_to DATE,p_channel TEXT DEFAULT NULL,p_campaign TEXT DEFAULT NULL,
  p_stage TEXT DEFAULT NULL,p_has_contract BOOLEAN DEFAULT NULL,p_unknown_only BOOLEAN DEFAULT FALSE,
  p_no_owner BOOLEAN DEFAULT FALSE,p_cursor_created_at TIMESTAMPTZ DEFAULT NULL,p_cursor_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 50)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor RECORD; result JSONB; campaign_value TEXT:=NULLIF(btrim(p_campaign),'');
BEGIN
  SELECT * INTO actor FROM platform_private.marketing_admin_actor();
  IF p_from IS NULL OR p_to IS NULL OR p_from>p_to OR p_from<DATE '1900-01-01' OR p_to>DATE '2100-12-31'
    OR p_to-p_from>365 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50
    OR (p_cursor_created_at IS NULL)<>(p_cursor_id IS NULL)
    OR (p_channel IS NOT NULL AND p_channel NOT IN ('instagram_ads','instagram','website_search','referral','other','unknown'))
    OR (p_stage IS NOT NULL AND p_stage NOT IN ('new','contacting','qualified','meeting_scheduled','meeting_completed',
      'potential','handed_off','closed'))
    OR (campaign_value IS NOT NULL AND length(campaign_value)>100)
  THEN RAISE EXCEPTION 'marketing_leads_invalid' USING ERRCODE='22023'; END IF;
  WITH filtered AS MATERIALIZED (
    SELECT c.* FROM platform_private.marketing_cohort(actor.organization_id,p_from,p_to) c
    WHERE (p_channel IS NULL OR c.channel=p_channel)
      AND (NOT coalesce(p_unknown_only,FALSE) OR c.channel='unknown')
      AND (campaign_value IS NULL OR c.campaign=campaign_value)
      AND (p_stage IS NULL OR c.stage=p_stage)
      AND (p_has_contract IS NULL OR (c.contract_signed_on IS NOT NULL)=p_has_contract)
      AND (NOT coalesce(p_no_owner,FALSE) OR c.owner_membership_id IS NULL)
  ), page AS MATERIALIZED (
    SELECT f.* FROM filtered f
    WHERE p_cursor_created_at IS NULL OR (f.created_at,f.lead_id)<(p_cursor_created_at,p_cursor_id)
    ORDER BY f.created_at DESC,f.lead_id DESC LIMIT p_limit+1
  ), shown AS (
    SELECT p.*,row_number() OVER (ORDER BY p.created_at DESC,p.lead_id DESC) AS n FROM page p
  )
  SELECT jsonb_build_object('organization_id',actor.organization_id,'from',p_from,'to',p_to,
    'total',(SELECT count(*) FROM filtered),
    'has_more',(SELECT count(*)>p_limit FROM page),
    'next_cursor',(SELECT CASE WHEN count(*)>p_limit THEN
      (SELECT jsonb_build_object('created_at',s.created_at,'id',s.lead_id) FROM shown s WHERE s.n=p_limit) END FROM page),
    'rows',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'lead_id',s.lead_id,'name',s.client_name,'phone',s.client_phone,'created_at',s.created_at,'source_key',s.source_key,
      'channel',s.channel,'basis',s.basis,'corrected',s.corrected,'ai_assistant',s.ai_assistant,'campaign',s.campaign,
      'landing_path',s.landing_path,'stage',s.stage,'lifecycle_state',s.lifecycle_state,
      'contract_signed_on',s.contract_signed_on,'contract_linked_manually',s.contract_linked AND s.contract_signed_on IS NOT NULL,
      'paid',CASE WHEN s.paid THEN jsonb_build_object('amount_minor',s.paid_amount_minor::TEXT,'currency',s.paid_currency,
        'source',s.paid_source) END,
      'owner',(SELECT jsonb_build_object('membership_id',m.id,'name',left(p.display_name,300))
        FROM platform.organization_memberships m JOIN platform.profiles p ON p.id=m.profile_id
        WHERE m.organization_id=actor.organization_id AND m.id=s.owner_membership_id)) ORDER BY s.n)
      FROM shown s WHERE s.n<=p_limit),'[]'::JSONB))
  INTO result;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION platform_private.marketing_admin_actor(),platform_private.marketing_cohort(UUID,DATE,DATE)
  FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
REVOKE ALL ON FUNCTION platform.marketing_spend_add_v1(UUID,DATE,DATE,BIGINT,TEXT,TEXT,TEXT),
  platform.marketing_spend_cancel_v1(UUID,UUID),platform.marketing_overview_v1(DATE,DATE),
  platform.marketing_leads_v1(DATE,DATE,TEXT,TEXT,TEXT,BOOLEAN,BOOLEAN,BOOLEAN,TIMESTAMPTZ,UUID,INTEGER)
  FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.marketing_spend_add_v1(UUID,DATE,DATE,BIGINT,TEXT,TEXT,TEXT),
  platform.marketing_spend_cancel_v1(UUID,UUID),platform.marketing_overview_v1(DATE,DATE),
  platform.marketing_leads_v1(DATE,DATE,TEXT,TEXT,TEXT,BOOLEAN,BOOLEAN,BOOLEAN,TIMESTAMPTZ,UUID,INTEGER)
  TO authenticated;

-- Every function is a definer with the empty search_path; the four client functions are callable by
-- authenticated only, the two private helpers by nobody; the spend table is closed to every client
-- role, forced-RLS without policies, append-only.
DO $a265_verify$
DECLARE routine RECORD;
BEGIN
  FOR routine IN SELECT p.oid::REGPROCEDURE AS signature,p.prosecdef,p.proconfig,p.provolatile FROM pg_catalog.pg_proc p
    WHERE p.oid IN ('platform.marketing_spend_add_v1(uuid,date,date,bigint,text,text,text)'::regprocedure,
      'platform.marketing_spend_cancel_v1(uuid,uuid)'::regprocedure,
      'platform.marketing_overview_v1(date,date)'::regprocedure,
      'platform.marketing_leads_v1(date,date,text,text,text,boolean,boolean,boolean,timestamp with time zone,uuid,integer)'::regprocedure,
      'platform_private.marketing_admin_actor()'::regprocedure,
      'platform_private.marketing_cohort(uuid,date,date)'::regprocedure)
  LOOP
    IF NOT routine.prosecdef OR routine.proconfig IS DISTINCT FROM ARRAY['search_path=""']
      OR has_function_privilege('anon',routine.signature,'EXECUTE')
      OR has_function_privilege('service_role',routine.signature,'EXECUTE')
      OR has_function_privilege('authenticated',routine.signature,'EXECUTE')
        IS DISTINCT FROM (routine.signature::TEXT LIKE 'platform.%')
      OR (routine.signature::TEXT LIKE 'platform.marketing_%' AND routine.signature::TEXT NOT LIKE 'platform.marketing_spend_%'
        AND routine.provolatile<>'s')
    THEN RAISE EXCEPTION 'a265_marketing_reads_verification_failed: %',routine.signature; END IF;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid='platform_private.marketing_manual_spend'::REGCLASS
      AND c.relrowsecurity AND c.relforcerowsecurity)
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_policy pol WHERE pol.polrelid='platform_private.marketing_manual_spend'::REGCLASS)
    OR has_table_privilege('authenticated','platform_private.marketing_manual_spend','SELECT')
    OR has_table_privilege('service_role','platform_private.marketing_manual_spend','SELECT')
    OR (SELECT count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid='platform_private.marketing_manual_spend'::REGCLASS
      AND NOT t.tgisinternal AND t.tgname IN ('marketing_manual_spend_append_only','marketing_manual_spend_no_truncate'))<>2
  THEN RAISE EXCEPTION 'a265_marketing_reads_verification_failed: manual spend table posture'; END IF;
END
$a265_verify$;

COMMENT ON TABLE platform_private.marketing_manual_spend IS
  'Ручной расход (265): только добавление; отмена — строка с cancels_spend_id на исходную. Читают и пишут только admin RPC раздела «Маркетинг».';
COMMENT ON FUNCTION platform.marketing_overview_v1(DATE, DATE) IS
  'Обзор «Маркетинга» (265, admin): когорта заявок по дате заявки (любой lifecycle) по каналам и продажи периода по дате договора — разными блоками, со сверкой с staff_sales_count_v1 и ручным расходом.';
COMMENT ON FUNCTION platform.marketing_leads_v1(DATE, DATE, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, TIMESTAMPTZ, UUID, INTEGER) IS
  'Список заявок «Маркетинга» (265, admin): когорта периода, курсор (created_at, id), страница ≤ 50; без текстов переписок, заметок, документов, данных дела и куратора.';

NOTIFY pgrst,'reload schema';
COMMIT;
