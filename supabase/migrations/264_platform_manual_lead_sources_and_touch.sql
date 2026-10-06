-- «Маркетинг» М1, шаг 2 (docs/EVO_MARKETING_PLAN_2026-10-06.md §3.1–3.2, запись PLAN_CHANGES
-- «2026-10-06 — раздел «Маркетинг»…»): ручные источники, касание сотрудника и одно правило канала.
--
--  a) platform.create_manual_sales_lead: та же сигнатура и тот же ACL, тело то же до последнего
--     знака, кроме списка источников: к office/phone_call/referral/website/other добавлены
--     'instagram' («Instagram Direct») и 'whatsapp_manual' («WhatsApp (вручную)»). Тело берётся из
--     живого определения (после 156) и правится одной заменой с проверкой якоря, как делает
--     156; фильтры очереди «Заявки» (221/250: website, whatsapp) не меняются — новые ключи в
--     неё не попадают (Э8.11); сам 'whatsapp' в ручной список по-прежнему не добавляется.
--  b) platform_private.attribution_signal и platform_private.lead_channels — ОДНО правило канала
--     (§3.2), которым пользуются все чтения: последнее staff_correction сильнее всего; иначе
--     ПЕРВОЕ касание (staff_manual или website_form, кроме is_repeat) по времени записи; у
--     автоматического касания канал даёт метка (utm), без метки — хост реферера, иначе «не известно».
--     Повторная заявка сайта (is_repeat, 263) добавляет касание, но канал не меняет — даже у лида,
--     у которого касаний до неё не было: он остаётся «не известно». Меняется без переписывания данных.
--  c) platform.record_lead_touch(lead, channel, kind, request_id): сотрудник пишет «Откуда
--     узнал» отдельным вызовом после создания лида (сигнатура create_manual_sales_lead не
--     меняется). Право — staff_can_access(..., 'lead.sales.workflow.manage', 'lead', id): те же
--     ворота, что у правки рабочего процесса лида (продажи на своих лидах и admin). Повтор по
--     request_id безопасен.
--  d) platform.read_lead_channel_v1(lead): проекция {channel, basis, corrected, at} для всех, кто
--     читает лид; сырых меток, страниц входа и реферера в ней нет.
-- Касание — само по себе append-only запись с автором и временем; отдельного события аудита нет
-- (audit_events_action_check не принимает новых действий без 255-подобного расширения журнала).
BEGIN;

-- ---------------------------------------------------------------------------
-- a) manual source allowlist
-- ---------------------------------------------------------------------------
DO $a264_manual$
DECLARE
  signature CONSTANT TEXT := 'platform.create_manual_sales_lead(uuid,uuid,text,text,text,text,uuid,text,text,date)';
  old_list CONSTANT TEXT := $$p_source_key NOT IN ('office','phone_call','referral','website','other')$$;
  new_list CONSTANT TEXT := $$p_source_key NOT IN ('office','phone_call','referral','website','other','instagram','whatsapp_manual')$$;
  old_source TEXT; new_source TEXT; definition TEXT; occurrences INTEGER;
BEGIN
  SELECT p.prosrc INTO STRICT old_source FROM pg_catalog.pg_proc p WHERE p.oid=signature::regprocedure;
  occurrences:=(length(old_source)-length(replace(old_source,old_list,'')))/length(old_list);
  IF occurrences<>1 THEN
    RAISE EXCEPTION 'a264_manual_source_anchor_mismatch: % (% instead of 1)',signature,occurrences;
  END IF;
  definition:=pg_get_functiondef(signature::regprocedure);
  EXECUTE replace(definition,old_list,new_list);
  SELECT p.prosrc INTO STRICT new_source FROM pg_catalog.pg_proc p WHERE p.oid=signature::regprocedure;
  IF replace(new_source,new_list,old_list) IS DISTINCT FROM old_source OR new_source=old_source THEN
    RAISE EXCEPTION 'a264_manual_source_verification_failed: body changed beyond the source list';
  END IF;
END
$a264_manual$;

-- ---------------------------------------------------------------------------
-- b) the one channel rule
-- ---------------------------------------------------------------------------
-- Channel of ONE automatic touch from its marks. A touch with utm_source or utm_medium is judged by
-- the marks alone (an unrecognised mark is «unknown», never a guess from the referrer); a touch
-- without them is judged by the referrer host; nothing recognised is «unknown». AI assistants tag
-- their outbound links themselves (ChatGPT adds utm_source=chatgpt.com), so an AI utm_source with no
-- medium (or referral/organic) is «Сайт и поиск» + ИИ-ассистент by the mark, like an AI referrer host.
CREATE FUNCTION platform_private.attribution_signal(p_utm_source TEXT,p_utm_medium TEXT,p_referrer_host TEXT,
  OUT channel TEXT,OUT basis TEXT,OUT ai_assistant BOOLEAN)
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  WITH i AS (SELECT NULLIF(lower(btrim(p_utm_source)),'') AS src,NULLIF(lower(btrim(p_utm_medium)),'') AS med,
    NULLIF(lower(btrim(p_referrer_host)),'') AS host),
  r AS (SELECT i.*,
    CASE
      WHEN i.src IS NOT NULL OR i.med IS NOT NULL THEN
        CASE
          WHEN i.src IN ('instagram','ig') AND i.med IN ('paid_social','paid-social','paidsocial','cpc','ppc','paid') THEN 'instagram_ads'
          WHEN i.src IN ('instagram','ig','taplink') THEN 'instagram'
          WHEN i.src IN ('google','bing','yandex','duckduckgo') AND (i.med IS NULL OR i.med='organic') THEN 'website_search'
          WHEN i.src IN ('chatgpt.com','chatgpt','chat.openai.com','openai','perplexity.ai','perplexity','claude.ai',
              'gemini.google.com','gemini','copilot.microsoft.com','copilot')
            AND (i.med IS NULL OR i.med IN ('referral','organic')) THEN 'website_search'
          ELSE 'unknown'
        END
      WHEN i.host ~ '^(www\.|l\.|m\.)?instagram\.com$' OR i.host ~ '^([a-z0-9-]+\.)?taplink\.ws$' THEN 'instagram'
      WHEN i.host ~ '^(www\.)?(chatgpt\.com|chat\.openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com)$'
        OR i.host ~ '^(www\.)?google\.[a-z]{2,}(\.[a-z]{2,})?$' OR i.host ~ '^(www\.)?bing\.com$'
        OR i.host ~ '^(www\.)?yandex\.[a-z]{2,}(\.[a-z]{2,})?$' OR i.host ~ '^(www\.)?duckduckgo\.com$' THEN 'website_search'
      ELSE 'unknown'
    END AS channel
  FROM i)
  SELECT r.channel,
    CASE WHEN r.channel='unknown' THEN 'unknown' WHEN r.src IS NOT NULL OR r.med IS NOT NULL THEN 'utm' ELSE 'referrer' END,
    coalesce(r.channel='website_search' AND (
      (r.src IS NULL AND r.med IS NULL AND r.host ~ '^(www\.)?(chatgpt\.com|chat\.openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com)$')
      OR r.src IN ('chatgpt.com','chatgpt','chat.openai.com','openai','perplexity.ai','perplexity','claude.ai',
        'gemini.google.com','gemini','copilot.microsoft.com','copilot')),FALSE)
  FROM r
$$;

-- The channel of leads, by the rule in the header. Every read of «откуда пришёл» goes through here.
-- basis: utm | referrer | staff | corrected | unknown. No access check: private, callers decide.
CREATE FUNCTION platform_private.lead_channels(p_organization_id UUID,p_lead_ids UUID[] DEFAULT NULL)
RETURNS TABLE(lead_id UUID,channel TEXT,basis TEXT,corrected BOOLEAN,ai_assistant BOOLEAN,touch_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  WITH scoped AS MATERIALIZED (
    SELECT l.id FROM platform.leads l
    WHERE l.organization_id=p_organization_id AND (p_lead_ids IS NULL OR l.id=ANY(p_lead_ids))
  ), corrections AS (
    SELECT DISTINCT ON (t.lead_id) t.lead_id,t.staff_channel,t.created_at
    FROM platform_private.lead_attribution_touches t JOIN scoped s ON s.id=t.lead_id
    WHERE t.organization_id=p_organization_id AND t.touch_kind='staff_correction'
    ORDER BY t.lead_id,t.created_at DESC,t.id DESC
  ), firsts AS (
    SELECT DISTINCT ON (t.lead_id) t.* FROM platform_private.lead_attribution_touches t JOIN scoped s ON s.id=t.lead_id
    WHERE t.organization_id=p_organization_id AND t.touch_kind IN ('website_form','staff_manual') AND NOT t.is_repeat
    ORDER BY t.lead_id,t.created_at,t.id
  )
  SELECT s.id,
    CASE WHEN c.lead_id IS NOT NULL THEN c.staff_channel WHEN f.id IS NULL THEN 'unknown'
      WHEN f.touch_kind='staff_manual' THEN f.staff_channel ELSE sig.channel END,
    CASE WHEN c.lead_id IS NOT NULL THEN 'corrected' WHEN f.id IS NULL THEN 'unknown'
      WHEN f.touch_kind='staff_manual' THEN CASE WHEN f.staff_channel='unknown' THEN 'unknown' ELSE 'staff' END
      ELSE sig.basis END,
    c.lead_id IS NOT NULL,
    c.lead_id IS NULL AND coalesce(sig.ai_assistant,FALSE),
    coalesce(c.created_at,f.created_at)
  FROM scoped s
  LEFT JOIN corrections c ON c.lead_id=s.id
  LEFT JOIN firsts f ON f.lead_id=s.id
  LEFT JOIN LATERAL platform_private.attribution_signal(f.utm_source,f.utm_medium,f.referrer_host) sig
    ON f.touch_kind='website_form'
$$;

-- The projection every reader of «откуда пришёл» gets: nothing raw.
CREATE FUNCTION platform_private.lead_channel_json(p_organization_id UUID,p_lead_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object('channel',c.channel,'basis',c.basis,'corrected',c.corrected,'at',c.touch_at)
  FROM platform_private.lead_channels(p_organization_id,ARRAY[p_lead_id]) c
$$;
REVOKE ALL ON FUNCTION platform_private.attribution_signal(TEXT,TEXT,TEXT),
  platform_private.lead_channels(UUID,UUID[]),platform_private.lead_channel_json(UUID,UUID)
  FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- c) platform.record_lead_touch
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.record_lead_touch(p_lead_id UUID,p_channel TEXT,p_kind TEXT,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE target_organization UUID; actor RECORD; prior platform_private.lead_attribution_touches%ROWTYPE;
  touch platform_private.lead_attribution_touches%ROWTYPE;
BEGIN
  IF p_lead_id IS NULL OR p_request_id IS NULL OR p_kind IS NULL OR p_kind NOT IN ('staff_manual','staff_correction')
    OR p_channel IS NULL OR p_channel NOT IN ('instagram_ads','instagram','website_search','referral','other','unknown')
  THEN RAISE EXCEPTION 'lead_touch_invalid' USING ERRCODE='22023'; END IF;
  SELECT l.organization_id INTO target_organization FROM platform.leads l WHERE l.id=p_lead_id;
  PERFORM 1 FROM platform.organizations o WHERE o.id=target_organization FOR KEY SHARE;
  SELECT a.* INTO actor FROM platform.current_actor_authority() a
    WHERE a.organization_id=target_organization AND a.membership_id IS NOT NULL
      AND a.platform_role IS DISTINCT FROM 'student'
      AND platform_private.staff_can_access(a.organization_id,a.membership_id,'lead.sales.workflow.manage','lead',p_lead_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'lead_touch_forbidden' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('lead-touch-request:'||p_request_id::TEXT,0));
  SELECT * INTO prior FROM platform_private.lead_attribution_touches t WHERE t.touch_kind=p_kind AND t.request_id=p_request_id;
  IF FOUND THEN
    IF prior.organization_id<>target_organization OR prior.lead_id<>p_lead_id
      OR prior.staff_channel IS DISTINCT FROM p_channel OR prior.created_by IS DISTINCT FROM actor.membership_id
    THEN RAISE EXCEPTION 'lead_touch_request_conflict' USING ERRCODE='22023'; END IF;
    touch:=prior;
  ELSE
    INSERT INTO platform_private.lead_attribution_touches(organization_id,lead_id,touch_kind,evidence,staff_channel,request_id,created_by)
      VALUES(target_organization,p_lead_id,p_kind,'staff_asserted',p_channel,p_request_id,actor.membership_id)
      RETURNING * INTO touch;
  END IF;
  RETURN jsonb_build_object('status','saved','touch_id',touch.id,'lead_id',touch.lead_id,'kind',touch.touch_kind,
    'channel',touch.staff_channel,'request_id',touch.request_id,'created_at',touch.created_at,
    'resolved',platform_private.lead_channel_json(target_organization,p_lead_id));
END $$;

-- ---------------------------------------------------------------------------
-- d) platform.read_lead_channel_v1: the projection for everyone who reads the lead
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.read_lead_channel_v1(p_lead_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE target_organization UUID; actor RECORD;
BEGIN
  SELECT l.organization_id INTO target_organization FROM platform.leads l WHERE p_lead_id IS NOT NULL AND l.id=p_lead_id;
  SELECT a.* INTO actor FROM platform.current_actor_authority() a
    WHERE a.organization_id=target_organization AND a.membership_id IS NOT NULL
      AND a.platform_role IS DISTINCT FROM 'student'
      AND platform_private.staff_can_access(a.organization_id,a.membership_id,'lead.read','lead',p_lead_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'lead_channel_forbidden' USING ERRCODE='42501'; END IF;
  RETURN platform_private.lead_channel_json(target_organization,p_lead_id);
END $$;

REVOKE ALL ON FUNCTION platform.record_lead_touch(UUID,TEXT,TEXT,UUID),platform.read_lead_channel_v1(UUID)
  FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.record_lead_touch(UUID,TEXT,TEXT,UUID),platform.read_lead_channel_v1(UUID) TO authenticated;

-- Definers with the empty search_path; client functions callable by authenticated only; private
-- helpers by nobody; create_manual_sales_lead keeps its signature and its ACL.
DO $a264_verify$
DECLARE routine RECORD;
BEGIN
  FOR routine IN SELECT p.oid::REGPROCEDURE AS signature,p.prosecdef,p.proconfig FROM pg_catalog.pg_proc p
    WHERE p.oid IN ('platform.record_lead_touch(uuid,text,text,uuid)'::regprocedure,
      'platform.read_lead_channel_v1(uuid)'::regprocedure,
      'platform.create_manual_sales_lead(uuid,uuid,text,text,text,text,uuid,text,text,date)'::regprocedure,
      'platform_private.attribution_signal(text,text,text)'::regprocedure,
      'platform_private.lead_channels(uuid,uuid[])'::regprocedure,
      'platform_private.lead_channel_json(uuid,uuid)'::regprocedure)
  LOOP
    IF routine.proconfig IS DISTINCT FROM ARRAY['search_path=""']
      OR has_function_privilege('anon',routine.signature,'EXECUTE')
      OR has_function_privilege('service_role',routine.signature,'EXECUTE')
      OR has_function_privilege('authenticated',routine.signature,'EXECUTE')
        IS DISTINCT FROM (routine.signature::TEXT LIKE 'platform.%')
      OR (routine.signature::TEXT NOT LIKE 'platform_private.attribution_signal%' AND NOT routine.prosecdef)
    THEN RAISE EXCEPTION 'a264_manual_sources_verification_failed: %',routine.signature; END IF;
  END LOOP;
  IF strpos(pg_get_functiondef('platform.create_manual_sales_lead(uuid,uuid,text,text,text,text,uuid,text,text,date)'::regprocedure),
      '''other'',''instagram'',''whatsapp_manual''') = 0
    OR (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.pronamespace='platform'::REGNAMESPACE AND p.proname='create_manual_sales_lead')<>1
  THEN RAISE EXCEPTION 'a264_manual_sources_verification_failed: source list'; END IF;
  -- The rule table, pinned.
  IF (SELECT count(*) FROM (VALUES
      ('instagram','paid_social',NULL,'instagram_ads'),('ig','cpc',NULL,'instagram_ads'),
      ('instagram','social',NULL,'instagram'),('taplink',NULL,NULL,'instagram'),
      ('google','organic',NULL,'website_search'),('yandex',NULL,NULL,'website_search'),
      ('newsletter','email',NULL,'unknown'),(NULL,NULL,'l.instagram.com','instagram'),
      (NULL,NULL,'evoadmissions.taplink.ws','instagram'),(NULL,NULL,'www.google.com','website_search'),
      (NULL,NULL,'chatgpt.com','website_search'),('chatgpt.com',NULL,'chatgpt.com','website_search'),
      ('perplexity','cpc',NULL,'unknown'),(NULL,NULL,'mail.google.com','unknown'),(NULL,NULL,NULL,'unknown'))
      AS t(s,m,h,expected) WHERE (platform_private.attribution_signal(t.s,t.m,t.h)).channel IS DISTINCT FROM t.expected)<>0
  THEN RAISE EXCEPTION 'a264_manual_sources_verification_failed: channel rule table'; END IF;
END
$a264_verify$;

COMMENT ON FUNCTION platform_private.lead_channels(UUID,UUID[]) IS
  'Единое правило канала (264, §3.2 плана «Маркетинг»): последнее исправление сотрудника, иначе первое касание (повторная заявка не в счёт); метка, затем реферер, иначе не известно. Все чтения идут через него.';
COMMENT ON FUNCTION platform.record_lead_touch(UUID,TEXT,TEXT,UUID) IS
  '«Откуда узнал» (264): касание сотрудника staff_manual/staff_correction; право lead.sales.workflow.manage на лиде, повтор по request_id безопасен.';
COMMENT ON FUNCTION platform.read_lead_channel_v1(UUID) IS
  'Проекция канала лида (264): {channel, basis, corrected, at} для читающих лид; сырых меток нет.';

NOTIFY pgrst,'reload schema';
COMMIT;
