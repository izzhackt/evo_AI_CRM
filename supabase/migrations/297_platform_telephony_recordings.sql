-- 297_platform_telephony_recordings — «Телефония Beeline KG» срез T6: выдача и
-- погашение права слушать запись разговора, учёт ответов источника, список записей
-- звонков лида для «Ленты».
-- Контракт: docs/EVO_TELEPHONY_PLAN_2026-10-16.md §6.4, §7 (7.1–7.4), §11, §12, §16
-- (срез T6), ADR 0033 (решение 3: копий записей нет); docs/PLAN_CHANGES.md (запись
-- «Телефония T6»). Только функции: таблицы, ограничения и журнал (allowlist
-- `telephony.recording.listen` и тип объекта `telephony_call`) уже есть (288, 291).
-- Записи не хранит и не отдаёт сам: ссылку на запись читает ровно одна функция —
-- погашение для service_role — и отдаёт её серверу потокового прокси; браузер
-- получает только идентификатор разрешения и состояние.
--
-- Что делает:
--  * platform.telephony_recording_grant_v1(организация, нога) — для authenticated.
--    Проверяет в базе: сессию сотрудника (не Student), флаг ui_enabled, право
--    (`telephony.recording.listen.all`, либо `…listen.own` и участие сотрудника в
--    ЛЮБОЙ ноге звонка, §6.1 правило 6), состояние записи (`available`). Выдаёт
--    разрешение на 15 минут и 40 обращений либо возвращает действующее (тот же
--    сотрудник, та же нога). В журнал `platform.audit_events` пишет
--    `telephony.recording.listen` ТОЛЬКО при выдаче нового разрешения (кто, звонок,
--    когда), а не при каждом Range-запросе. Лимит выдач — 30 в час на сотрудника.
--    Ссылку не читает и не возвращает.
--  * platform.telephony_recording_consume_v1(организация, разрешение, сотрудник) —
--    только service_role. Атомарно проверяет срок, число обращений и принадлежность,
--    считает обращение и отдаёт серверу ссылку из строки ноги (единственное место, где
--    она читается). Если запись за это время перестала быть доступной, обращение не
--    засчитывается (откат).
--  * platform.telephony_recording_report_v1(организация, нога, результат) — только
--    service_role. `not_found`: ответ источника 404/410. Звонок не моложе 360 дней —
--    запись `expired`, ссылка обнуляется; моложе — ссылка СОХРАНЯЕТСЯ, растёт
--    not_found_count, после трёх ответов на протяжении не менее 6 часов запись
--    `unavailable` (§7.3). `ok`: источник отдал запись — счётчик сбрасывается.
--    Сводное состояние звонка пересчитывается по ногам.
--  * platform.telephony_lead_recordings_v1(организация, лид, звонки) — для
--    authenticated. Для «Ленты» лида: у каких звонков лида есть записи, какие у них
--    ноги (идентификатор и состояние) и может ли ЭТОТ сотрудник слушать. Видимость
--    следует lead.read по лиду, как у строк звонков (295); открывает ui_enabled.
--    Ссылки в ответе нет и быть не может (функция не читает её).
--  * Помощник platform_private.telephony_recording_scope — одно правило «все /
--    свои / нет» для выдачи и списка; закрыт для всех клиентских ролей.
--
-- Все изменения состояния — только через функции; прав на таблицы эта миграция не
-- выдаёт. Повторный запуск целой миграции отказывает (CREATE FUNCTION), ничего не меняя.
BEGIN;

-- ---------------------------------------------------------------------------
-- Помощник: что сотрудник может с записью звонка.
--   'all'  — право listen.all (любая запись организации);
--   'own'  — право listen.own и сотрудник участвует в любой ноге этого звонка;
--   NULL   — нельзя.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.telephony_recording_scope(p_org UUID, p_membership UUID, p_call_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_org IS NULL OR p_membership IS NULL OR p_call_id IS NULL THEN NULL
    WHEN platform_private.staff_can_access(p_org, p_membership, 'telephony.recording.listen.all',
      'organization', p_org) THEN 'all'
    WHEN platform_private.staff_can_access(p_org, p_membership, 'telephony.recording.listen.own',
      'organization', p_org)
      AND EXISTS (SELECT 1 FROM platform_private.telephony_call_legs l
        WHERE l.organization_id = p_org AND l.call_id = p_call_id AND l.membership_id = p_membership)
      THEN 'own'
    ELSE NULL END
$$;

-- ---------------------------------------------------------------------------
-- Выдача разрешения на прослушивание одной ноги.
-- Порядок отказов не выдаёт существования записи тому, кто не вправе её знать:
-- без флага, без права «все» и без участия в звонке ответ один — 42501.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.telephony_recording_grant_v1(
  p_organization_id UUID,
  p_leg_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor RECORD;
  v_settings platform_private.telephony_settings;
  v_leg_call UUID;
  v_leg_state TEXT;
  v_direction TEXT;
  v_all BOOLEAN;
  v_scope TEXT;
  v_grant platform_private.telephony_recording_grants;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_organization_id IS NULL OR p_leg_id IS NULL THEN
    RAISE EXCEPTION 'telephony_recording_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT a.membership_id, a.profile_id, a.auth_user_id INTO v_actor FROM platform.current_actor_authority() a
   WHERE a.organization_id = p_organization_id AND a.platform_role IS DISTINCT FROM 'student' LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'telephony_recording_forbidden' USING ERRCODE = '42501';
  END IF;
  -- Нет строки настроек или ui_enabled = false: телефонии в интерфейсе нет (§9.1).
  SELECT * INTO v_settings FROM platform_private.telephony_settings s WHERE s.organization_id = p_organization_id;
  IF NOT FOUND OR NOT v_settings.ui_enabled THEN
    RAISE EXCEPTION 'telephony_recording_forbidden' USING ERRCODE = '42501';
  END IF;
  v_all := platform_private.staff_can_access(p_organization_id, v_actor.membership_id,
    'telephony.recording.listen.all', 'organization', p_organization_id);
  IF NOT v_all AND NOT platform_private.staff_can_access(p_organization_id, v_actor.membership_id,
       'telephony.recording.listen.own', 'organization', p_organization_id) THEN
    RAISE EXCEPTION 'telephony_recording_forbidden' USING ERRCODE = '42501';
  END IF;

  -- Ссылка здесь не читается: берутся только звонок и состояние ноги.
  SELECT l.call_id, l.recording_state INTO v_leg_call, v_leg_state FROM platform_private.telephony_call_legs l
   WHERE l.organization_id = p_organization_id AND l.id = p_leg_id;
  IF NOT FOUND THEN
    -- Существование знает только тот, кто вправе слушать любую запись; остальным — как «нельзя».
    IF v_all THEN
      RAISE EXCEPTION 'telephony_recording_not_found' USING ERRCODE = 'P0002';
    END IF;
    RAISE EXCEPTION 'telephony_recording_forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT c.direction INTO v_direction FROM platform_private.telephony_calls c
   WHERE c.organization_id = p_organization_id AND c.id = v_leg_call;
  v_scope := platform_private.telephony_recording_scope(p_organization_id, v_actor.membership_id, v_leg_call);
  IF v_scope IS NULL THEN
    RAISE EXCEPTION 'telephony_recording_forbidden' USING ERRCODE = '42501';
  END IF;

  -- Состояние записи (§7.3): слушать можно только доступную.
  IF v_leg_state = 'expired' THEN
    RAISE EXCEPTION 'telephony_recording_expired' USING ERRCODE = 'PT410';
  ELSIF v_leg_state = 'unavailable' THEN
    RAISE EXCEPTION 'telephony_recording_unavailable' USING ERRCODE = 'P0002';
  ELSIF v_leg_state <> 'available' THEN
    RAISE EXCEPTION 'telephony_recording_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Выдачи одного сотрудника идут по очереди: параллельные Range-запросы плеера не
  -- создают двух разрешений и двух строк журнала, а лимит считается точно.
  PERFORM pg_advisory_xact_lock(hashtextextended('telephony_recording_grant:' || v_actor.membership_id::TEXT, 0));

  SELECT * INTO v_grant FROM platform_private.telephony_recording_grants g
   WHERE g.organization_id = p_organization_id AND g.membership_id = v_actor.membership_id
     AND g.leg_id = p_leg_id AND g.expires_at > v_now AND g.use_count < g.max_uses
   ORDER BY g.granted_at DESC, g.id DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('status', 'reused', 'grantId', v_grant.id, 'expiresAt', v_grant.expires_at,
      'scope', v_scope);
  END IF;

  -- Лимит выдач: 30 в час на сотрудника (§7.2).
  IF (SELECT count(*) FROM platform_private.telephony_recording_grants g
       WHERE g.organization_id = p_organization_id AND g.membership_id = v_actor.membership_id
         AND g.granted_at > v_now - INTERVAL '1 hour') >= 30 THEN
    RAISE EXCEPTION 'telephony_recording_rate_limited' USING ERRCODE = 'PT429';
  END IF;

  INSERT INTO platform_private.telephony_recording_grants (organization_id, membership_id, leg_id, granted_at,
    expires_at, max_uses)
  VALUES (p_organization_id, v_actor.membership_id, p_leg_id, v_now, v_now + INTERVAL '15 minutes', 40)
  RETURNING * INTO v_grant;

  -- Журнал: кто, какой звонок, когда. Без номера, без имён, без ссылки (§13).
  INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal, action,
    resource_type, resource_id, before_state, after_state, reason, request_id, created_at, actor_membership_id)
  VALUES (p_organization_id, 'user', v_actor.profile_id, 'auth:' || v_actor.auth_user_id::TEXT,
    'telephony.recording.listen', 'telephony_call', v_leg_call,
    '{}'::JSONB,
    jsonb_build_object('legId', p_leg_id, 'grantId', v_grant.id, 'scope', v_scope, 'direction', v_direction),
    'Телефония: прослушивание записи', gen_random_uuid(), v_now, v_actor.membership_id);

  RETURN jsonb_build_object('status', 'issued', 'grantId', v_grant.id, 'expiresAt', v_grant.expires_at,
    'scope', v_scope);
END
$$;

-- ---------------------------------------------------------------------------
-- Погашение разрешения: только сервер потокового прокси (service_role). Единственное
-- место, где читается ссылка на запись.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.telephony_recording_consume_v1(
  p_organization_id UUID,
  p_grant_id UUID,
  p_membership_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_grant platform_private.telephony_recording_grants;
  v_leg platform_private.telephony_call_legs;
  v_settings platform_private.telephony_settings;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role is required' USING ERRCODE = '42501';
  END IF;
  IF p_organization_id IS NULL OR p_grant_id IS NULL OR p_membership_id IS NULL THEN
    RAISE EXCEPTION 'telephony_recording_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_settings FROM platform_private.telephony_settings s WHERE s.organization_id = p_organization_id;
  IF NOT FOUND OR NOT v_settings.ui_enabled THEN
    RAISE EXCEPTION 'telephony_recording_forbidden' USING ERRCODE = '42501';
  END IF;

  -- Обращение считается атомарно: срок, лимит и принадлежность проверяет сам UPDATE.
  UPDATE platform_private.telephony_recording_grants g
     SET use_count = g.use_count + 1, last_used_at = v_now
   WHERE g.organization_id = p_organization_id AND g.id = p_grant_id AND g.membership_id = p_membership_id
     AND g.expires_at > v_now AND g.use_count < g.max_uses
  RETURNING * INTO v_grant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'telephony_recording_grant_invalid' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_leg FROM platform_private.telephony_call_legs l
   WHERE l.organization_id = p_organization_id AND l.id = v_grant.leg_id;
  -- Запись могла перестать быть доступной после выдачи: исключение откатывает обращение.
  IF NOT FOUND OR v_leg.recording_state = 'none' THEN
    RAISE EXCEPTION 'telephony_recording_not_found' USING ERRCODE = 'P0002';
  ELSIF v_leg.recording_state = 'expired' THEN
    RAISE EXCEPTION 'telephony_recording_expired' USING ERRCODE = 'PT410';
  ELSIF v_leg.recording_state <> 'available' OR v_leg.recording_link IS NULL THEN
    RAISE EXCEPTION 'telephony_recording_unavailable' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object('legId', v_leg.id, 'callId', v_leg.call_id, 'link', v_leg.recording_link,
    'notFoundCount', v_leg.not_found_count);
END
$$;

-- ---------------------------------------------------------------------------
-- Ответ источника: 404/410 (`not_found`) или запись отдана (`ok`). Только service_role.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.telephony_recording_report_v1(
  p_organization_id UUID,
  p_leg_id UUID,
  p_result TEXT
) RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_call_id UUID;
  v_cur_state TEXT;
  v_cur_count INTEGER;
  v_cur_first TIMESTAMPTZ;
  v_started TIMESTAMPTZ;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_count INTEGER;
  v_first TIMESTAMPTZ;
  v_state TEXT;
  v_summary TEXT;
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role is required' USING ERRCODE = '42501';
  END IF;
  IF p_organization_id IS NULL OR p_leg_id IS NULL OR p_result IS NULL OR p_result NOT IN ('ok', 'not_found') THEN
    RAISE EXCEPTION 'telephony_recording_invalid' USING ERRCODE = '22023';
  END IF;
  -- Ссылку эта функция не читает: берутся только состояние и счётчик.
  SELECT l.call_id, l.recording_state, l.not_found_count, l.first_not_found_at
    INTO v_call_id, v_cur_state, v_cur_count, v_cur_first
    FROM platform_private.telephony_call_legs l
   WHERE l.organization_id = p_organization_id AND l.id = p_leg_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'telephony_recording_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Менять есть что только у доступной записи: ссылку, которой уже нет, не оживляем, а
  -- «временно недоступную» обновляет сверка (293).
  IF v_cur_state <> 'available' THEN
    RETURN jsonb_build_object('state', v_cur_state, 'changed', FALSE, 'notFoundCount', v_cur_count);
  END IF;

  IF p_result = 'ok' THEN
    IF v_cur_count > 0 THEN
      UPDATE platform_private.telephony_call_legs x
         SET not_found_count = 0, first_not_found_at = NULL, updated_at = v_now
       WHERE x.organization_id = p_organization_id AND x.id = p_leg_id;
      RETURN jsonb_build_object('state', 'available', 'changed', TRUE, 'notFoundCount', 0);
    END IF;
    RETURN jsonb_build_object('state', 'available', 'changed', FALSE, 'notFoundCount', 0);
  END IF;

  SELECT c.started_at INTO v_started FROM platform_private.telephony_calls c
   WHERE c.organization_id = p_organization_id AND c.id = v_call_id;
  IF v_now - v_started >= INTERVAL '360 days' THEN
    -- Срок хранения у Beeline вышел: запись удалена, ссылка обнуляется (§7.3).
    UPDATE platform_private.telephony_call_legs x
       SET recording_link = NULL, recording_state = 'expired', not_found_count = 0, first_not_found_at = NULL,
           recording_next_check_at = NULL, updated_at = v_now
     WHERE x.organization_id = p_organization_id AND x.id = p_leg_id;
    v_state := 'expired';
    v_count := 0;
  ELSE
    -- Звонок моложе: запись может быть не загружена или тенант дал сбой; ссылку не трогаем.
    v_count := v_cur_count + 1;
    v_first := COALESCE(v_cur_first, v_now);
    v_state := CASE WHEN v_count >= 3 AND v_now - v_first >= INTERVAL '6 hours' THEN 'unavailable'
      ELSE 'available' END;
    UPDATE platform_private.telephony_call_legs x
       SET not_found_count = v_count, first_not_found_at = v_first, recording_state = v_state, updated_at = v_now
     WHERE x.organization_id = p_organization_id AND x.id = p_leg_id;
  END IF;

  -- Сводное состояние звонка по ногам (как в 289 и 293).
  SELECT CASE WHEN bool_or(l.recording_state = 'available') THEN 'available'
      WHEN bool_or(l.recording_state = 'unavailable') THEN 'unavailable'
      WHEN bool_or(l.recording_state = 'expired') THEN 'expired' ELSE 'none' END
    INTO v_summary
    FROM platform_private.telephony_call_legs l
   WHERE l.organization_id = p_organization_id AND l.call_id = v_call_id;
  UPDATE platform_private.telephony_calls c
     SET recording_state = v_summary, updated_at = v_now
   WHERE c.organization_id = p_organization_id AND c.id = v_call_id AND c.recording_state IS DISTINCT FROM v_summary;

  RETURN jsonb_build_object('state', v_state, 'changed', TRUE, 'notFoundCount', v_count);
END
$$;

-- ---------------------------------------------------------------------------
-- Записи звонков лида для «Ленты»: ноги с записью и право слушать.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.telephony_lead_recordings_v1(
  p_organization_id UUID,
  p_lead_id UUID,
  p_call_ids UUID[]
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor RECORD;
  v_client UUID;
  v_settings platform_private.telephony_settings;
  v_all BOOLEAN;
  v_own BOOLEAN;
  v_calls JSONB;
BEGIN
  IF p_organization_id IS NULL OR p_lead_id IS NULL OR p_call_ids IS NULL
     OR cardinality(p_call_ids) NOT BETWEEN 1 AND 100
     OR EXISTS (SELECT 1 FROM unnest(p_call_ids) AS x(id) WHERE x.id IS NULL) THEN
    RAISE EXCEPTION 'telephony_recordings_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT a.membership_id INTO v_actor FROM platform.current_actor_authority() a
   WHERE a.organization_id = p_organization_id AND a.platform_role IS DISTINCT FROM 'student' LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'telephony_recordings_forbidden' USING ERRCODE = '42501';
  END IF;
  -- Видимость строки следует lead.read по лиду, как у строк звонков (295, план §11).
  IF NOT platform_private.staff_can_access(p_organization_id, v_actor.membership_id, 'lead.read', 'lead', p_lead_id) THEN
    RAISE EXCEPTION 'telephony_recordings_forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT l.client_id INTO v_client FROM platform.leads l
   WHERE l.organization_id = p_organization_id AND l.id = p_lead_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'telephony_recordings_forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_settings FROM platform_private.telephony_settings s WHERE s.organization_id = p_organization_id;
  IF NOT FOUND OR NOT v_settings.ui_enabled THEN
    RETURN jsonb_build_object('enabled', FALSE, 'calls', '[]'::JSONB);
  END IF;

  v_all := platform_private.staff_can_access(p_organization_id, v_actor.membership_id,
    'telephony.recording.listen.all', 'organization', p_organization_id);
  v_own := platform_private.staff_can_access(p_organization_id, v_actor.membership_id,
    'telephony.recording.listen.own', 'organization', p_organization_id);

  -- Те же звонки, что в ленте (295): звонки лида и звонки его клиента без лида на момент звонка.
  SELECT COALESCE(jsonb_agg(r.obj ORDER BY r.started_at DESC, r.id DESC), '[]'::JSONB) INTO v_calls
  FROM (
    SELECT c.id, c.started_at, jsonb_build_object(
      'callId', c.id,
      'canListen', v_all OR (v_own AND EXISTS (SELECT 1 FROM platform_private.telephony_call_legs m
        WHERE m.organization_id = c.organization_id AND m.call_id = c.id AND m.membership_id = v_actor.membership_id)),
      'legs', (SELECT jsonb_agg(jsonb_build_object('legId', lg.id, 'state', lg.recording_state)
          ORDER BY lg.leg_started_at, lg.id)
        FROM (
          SELECT l.id, l.recording_state, l.leg_started_at
          FROM platform_private.telephony_call_legs l
          WHERE l.organization_id = c.organization_id AND l.call_id = c.id AND l.recording_state <> 'none'
          ORDER BY l.leg_started_at, l.id
          LIMIT 6
        ) lg)
    ) AS obj
    FROM platform_private.telephony_calls c
    WHERE c.organization_id = p_organization_id
      AND c.id = ANY (p_call_ids)
      AND (c.lead_id = p_lead_id OR (c.lead_id IS NULL AND c.client_id = v_client))
      AND c.recording_state <> 'none'
      AND EXISTS (SELECT 1 FROM platform_private.telephony_call_legs z
        WHERE z.organization_id = c.organization_id AND z.call_id = c.id AND z.recording_state <> 'none')
  ) r;

  RETURN jsonb_build_object('enabled', TRUE, 'calls', v_calls);
END
$$;

-- ---------------------------------------------------------------------------
-- Права: помощник закрыт для всех клиентских ролей; выдача и список — для
-- authenticated (право и флаг проверяются внутри); погашение и учёт — только
-- service_role.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION platform_private.telephony_recording_scope(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
REVOKE ALL ON FUNCTION
  platform.telephony_recording_grant_v1(UUID, UUID),
  platform.telephony_recording_consume_v1(UUID, UUID, UUID),
  platform.telephony_recording_report_v1(UUID, UUID, TEXT),
  platform.telephony_lead_recordings_v1(UUID, UUID, UUID[])
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
GRANT EXECUTE ON FUNCTION
  platform.telephony_recording_grant_v1(UUID, UUID),
  platform.telephony_lead_recordings_v1(UUID, UUID, UUID[])
  TO authenticated;
GRANT EXECUTE ON FUNCTION
  platform.telephony_recording_consume_v1(UUID, UUID, UUID),
  platform.telephony_recording_report_v1(UUID, UUID, TEXT)
  TO service_role;

COMMENT ON FUNCTION platform_private.telephony_recording_scope(UUID, UUID, UUID) IS
  'Telephony T6: all = telephony.recording.listen.all; own = listen.own and the employee is on ANY leg of the call (plan 6.1 rule 6); NULL = not allowed.';
COMMENT ON FUNCTION platform.telephony_recording_grant_v1(UUID, UUID) IS
  'Telephony T6: 15-minute, 40-use permission to stream one recording leg, or the current one. Needs ui_enabled and listen.all, or listen.own with a leg on the call. Audited once (telephony.recording.listen) per new permission, not per Range request. 30 new permissions per hour per employee. Never reads or returns the recording link.';
COMMENT ON FUNCTION platform.telephony_recording_consume_v1(UUID, UUID, UUID) IS
  'Telephony T6: service-only. Counts one use of a permission and returns the recording link to the streaming proxy; the only place the link is read. A recording that is no longer available is refused and the use is not counted.';
COMMENT ON FUNCTION platform.telephony_recording_report_v1(UUID, UUID, TEXT) IS
  'Telephony T6: service-only answer of the source. not_found: a call of 360 days or more is expired and its link is cleared; a younger call keeps its link, counts the answer and becomes unavailable after three answers over at least six hours. ok: the counter is reset.';
COMMENT ON FUNCTION platform.telephony_lead_recordings_v1(UUID, UUID, UUID[]) IS
  'Telephony T6: recording legs (id and state) of the lead calls for the feed and whether this employee may listen. Needs lead.read; empty unless ui_enabled. No link.';

-- Проверка в конце: права ровно такие, как задумано.
DO $tel297_verify$
DECLARE
  r TEXT;
  f REGPROCEDURE;
  p pg_catalog.pg_proc%ROWTYPE;
BEGIN
  FOR f IN SELECT x.oid::REGPROCEDURE FROM pg_catalog.pg_proc x
    JOIN pg_catalog.pg_namespace n ON n.oid = x.pronamespace
    WHERE n.nspname = 'platform' AND x.proname IN ('telephony_recording_grant_v1', 'telephony_recording_consume_v1',
      'telephony_recording_report_v1', 'telephony_lead_recordings_v1') LOOP
    SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid = f;
    IF NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
      OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) THEN
      RAISE EXCEPTION 'telephony_recordings_function_posture: %', f USING ERRCODE = '55000';
    END IF;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['anon', 'service_role', 'supabase_auth_admin', 'evo_ai_agent'] LOOP
    IF has_function_privilege(r, 'platform.telephony_recording_grant_v1(uuid,uuid)', 'EXECUTE')
       OR has_function_privilege(r, 'platform.telephony_lead_recordings_v1(uuid,uuid,uuid[])', 'EXECUTE') THEN
      RAISE EXCEPTION 'telephony_recordings_acl_drift: %', r USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF NOT has_function_privilege('authenticated', 'platform.telephony_recording_grant_v1(uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'platform.telephony_lead_recordings_v1(uuid,uuid,uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'telephony_recordings_acl_drift: authenticated' USING ERRCODE = '55000';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'supabase_auth_admin', 'evo_ai_agent'] LOOP
    IF has_function_privilege(r, 'platform.telephony_recording_consume_v1(uuid,uuid,uuid)', 'EXECUTE')
       OR has_function_privilege(r, 'platform.telephony_recording_report_v1(uuid,uuid,text)', 'EXECUTE') THEN
      RAISE EXCEPTION 'telephony_recordings_service_acl_drift: %', r USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF NOT has_function_privilege('service_role', 'platform.telephony_recording_consume_v1(uuid,uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'platform.telephony_recording_report_v1(uuid,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'telephony_recordings_service_acl_drift: service_role' USING ERRCODE = '55000';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'supabase_auth_admin', 'evo_ai_agent'] LOOP
    IF has_function_privilege(r, 'platform_private.telephony_recording_scope(uuid,uuid,uuid)', 'EXECUTE') THEN
      RAISE EXCEPTION 'telephony_recordings_helper_acl_drift: %', r USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF has_function_privilege('public', 'platform_private.telephony_recording_scope(uuid,uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('public', 'platform.telephony_recording_grant_v1(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('public', 'platform.telephony_recording_consume_v1(uuid,uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('public', 'platform.telephony_recording_report_v1(uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('public', 'platform.telephony_lead_recordings_v1(uuid,uuid,uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'telephony_recordings_acl_drift: public' USING ERRCODE = '55000';
  END IF;
END
$tel297_verify$;

COMMIT;
