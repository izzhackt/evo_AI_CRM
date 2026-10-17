-- 292_platform_telephony_lead_feed — «Телефония Beeline KG» срез T5: строки звонков
-- в «Ленте» карточки лида и результат звонка одним нажатием.
-- Контракт: docs/EVO_TELEPHONY_PLAN_2026-10-16.md §6.1, §9.1, §9.4, §11, §12, §16
-- (срез T5), ADR 0033; docs/PLAN_CHANGES.md (запись «Телефония T5»). Только чтение
-- звонков лида и запись результата. Звонков не набирает, записей не отдаёт, задач
-- не создаёт и ничего не включает: оба действия закрыты флагами настроек (все по
-- умолчанию выключены), пока флаги не включит админ после проверки на настоящем пути.
--
-- Что делает:
--  * telephony_calls.result_callback_on — дата, выбранная у результата «Перезвонить»
--    (план §9.4: «по умолчанию завтра»). Дата есть тогда и только тогда, когда
--    result_code = 'callback'. Задачу «Перезвонить» из этой даты создаёт срез T8
--    (задачи, срок, замена, автозакрытие; PLAN_CHANGES «Телефония T5», п. 6): T5
--    записывает выбор сотрудника, а не обещает напоминание, которого ещё нет.
--  * platform.telephony_lead_calls_v1(организация, лид, лимит, с, до) — строки звонков
--    для «Ленты» лида: направление, время, разговор, итог, сотрудник, маска номера,
--    «запись есть» (без ссылки и без плеера), результат и признак «результат можно
--    поставить или изменить». Окно времени (с — включительно, до — исключая) нужно
--    постраничной ленте: заметки читаются страницами, звонки приходят в окне страницы.
--    Видимость строки следует lead.read по лиду, как у заметок и переписки (план
--    §11); открывает ui_enabled. Номер клиента наружу не отдаётся: только маска
--    страны и последних цифр (278).
--  * platform.telephony_set_result_v1(организация, звонок, результат, дата) — «Дозвонился»
--    / «Перезвонить» + дата / «Не интересно». Право telephony.call.dial; закрыто
--    флагами ui_enabled и dial_enabled (§9.1); менеджер ставит результат только
--    у звонка, в котором говорил сам, руководитель (telephony.manage) и админ — у
--    любого видимого. Только отвеченный звонок (правило 1 §6.1), не из первичного
--    импорта; поставленный результат меняется в течение суток (§9.4); не
--    поставленный предлагается неделю, иначе исторические звонки засорили бы ленту
--    (PLAN_CHANGES «Телефония T5», п. 5). Каждое изменение — в журнал действий
--    (telephony.result.set, telephony_call; allowlist — миграция 291), повтор того же
--    результата ничего не пишет.
--  * Два частных помощника (окно результата и «участвовал ли сотрудник»), закрытых
--    для всех клиентских ролей; миграция сама проверяет права в конце.
-- Повторный запуск целой миграции отказывает (ADD COLUMN, CREATE FUNCTION), ничего не меняя.
BEGIN;

-- ---------------------------------------------------------------------------
-- Дата выбора у результата «Перезвонить».
-- ---------------------------------------------------------------------------
ALTER TABLE platform_private.telephony_calls
  ADD COLUMN result_callback_on DATE
    CONSTRAINT telephony_calls_result_callback_on_range_check CHECK (
      result_callback_on IS NULL
      OR (isfinite(result_callback_on) AND result_callback_on BETWEEN DATE '2020-01-01' AND DATE '2200-01-01')
    );
ALTER TABLE platform_private.telephony_calls
  ADD CONSTRAINT telephony_calls_result_callback_check CHECK (
    COALESCE(result_code = 'callback', FALSE) = (result_callback_on IS NOT NULL)
  );
COMMENT ON COLUMN platform_private.telephony_calls.result_callback_on IS
  'Telephony T5: the day the employee chose for «Перезвонить» (plan 9.4). Set exactly when result_code = callback; the follow-up task is created by slice T8.';

-- ---------------------------------------------------------------------------
-- Помощники (частные; без прав для клиентских ролей).
-- ---------------------------------------------------------------------------

-- Окно результата (§9.4): результат ставят у отвеченного звонка не из первичного
-- импорта; поставленный меняется в течение 24 часов, не поставленный предлагается
-- 7 суток. Чистая функция времени: «сейчас» передаётся аргументом.
CREATE FUNCTION platform_private.telephony_result_window_open(
  p_outcome TEXT, p_created_via TEXT, p_started_at TIMESTAMPTZ, p_result_code TEXT,
  p_result_at TIMESTAMPTZ, p_now TIMESTAMPTZ
) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT COALESCE(
    p_outcome = 'answered' AND p_created_via <> 'backfill'
    AND CASE WHEN p_result_code IS NULL THEN p_started_at >= p_now - INTERVAL '7 days'
             ELSE p_result_at >= p_now - INTERVAL '24 hours' END,
    FALSE)
$$;

-- Сотрудник говорил по этому звонку: ответил первым (calls.membership_id) или его
-- нога принята теми же признаками, что правило 1 §6.1 (ACCEPTED, перевод, Success с
-- ненулевой длительностью, разговор из сверки). Нога, которую только вызывали
-- (missed, cancelled, ringing), и нога группы без сотрудника не в счёт. Право «свои»
-- на результат — только это.
CREATE FUNCTION platform_private.telephony_call_taken_by(p_org UUID, p_call_id UUID, p_membership UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT p_membership IS NOT NULL AND (
    EXISTS (SELECT 1 FROM platform_private.telephony_calls c
      WHERE c.organization_id = p_org AND c.id = p_call_id AND c.membership_id = p_membership)
    OR EXISTS (SELECT 1 FROM platform_private.telephony_call_legs l
      WHERE l.organization_id = p_org AND l.call_id = p_call_id AND l.membership_id = p_membership
        AND l.state IN ('accepted', 'completed', 'transferred')
        AND (l.accepted_at IS NOT NULL OR l.state = 'transferred'
          OR (l.status = 'success' AND COALESCE(l.webhook_total_seconds, 0) > 0)
          OR COALESCE(l.talk_seconds, 0) > 0)))
$$;

-- ---------------------------------------------------------------------------
-- Строки звонков для «Ленты» лида.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.telephony_lead_calls_v1(
  p_organization_id UUID,
  p_lead_id UUID,
  p_limit INTEGER DEFAULT 50,
  p_since TIMESTAMPTZ DEFAULT NULL,
  p_until TIMESTAMPTZ DEFAULT NULL
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
  v_result_on BOOLEAN;
  v_all BOOLEAN;
  v_now TIMESTAMPTZ := statement_timestamp();
  v_rows JSONB;
  v_calls JSONB;
BEGIN
  IF p_organization_id IS NULL OR p_lead_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
     OR (p_since IS NOT NULL AND NOT isfinite(p_since)) OR (p_until IS NOT NULL AND NOT isfinite(p_until))
     OR (p_since IS NOT NULL AND p_until IS NOT NULL AND p_since >= p_until) THEN
    RAISE EXCEPTION 'telephony_calls_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT a.membership_id INTO v_actor FROM platform.current_actor_authority() a
   WHERE a.organization_id = p_organization_id AND a.platform_role IS DISTINCT FROM 'student' LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'telephony_calls_forbidden' USING ERRCODE = '42501';
  END IF;
  -- Видимость строки звонка следует lead.read по лиду (план §11).
  IF NOT platform_private.staff_can_access(p_organization_id, v_actor.membership_id, 'lead.read', 'lead', p_lead_id) THEN
    RAISE EXCEPTION 'telephony_calls_forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT l.client_id INTO v_client FROM platform.leads l
   WHERE l.organization_id = p_organization_id AND l.id = p_lead_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'telephony_calls_forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_settings FROM platform_private.telephony_settings s WHERE s.organization_id = p_organization_id;
  -- Нет строки настроек или выключен ui_enabled: телефонии в интерфейсе нет (§9.1).
  IF NOT FOUND OR NOT v_settings.ui_enabled THEN
    RETURN jsonb_build_object('enabled', FALSE, 'canSetResult', FALSE, 'hasMore', FALSE, 'calls', '[]'::JSONB);
  END IF;

  v_result_on := v_settings.dial_enabled
    AND platform_private.staff_can_access(p_organization_id, v_actor.membership_id, 'telephony.call.dial',
      'organization', p_organization_id);
  v_all := platform_private.staff_can_access(p_organization_id, v_actor.membership_id, 'telephony.manage',
    'organization', p_organization_id);

  -- Звонки лида и звонки его клиента, у которых лида на момент звонка не было
  -- (§6.2: «открытых нет — lead_id пуст»): иначе звонок до появления лида не виден нигде.
  SELECT COALESCE(jsonb_agg(r.obj ORDER BY r.started_at DESC, r.id DESC), '[]'::JSONB) INTO v_rows
  FROM (
    SELECT c.id, c.started_at, jsonb_build_object(
      'callId', c.id,
      'direction', c.direction,
      'state', c.state,
      'outcome', c.outcome,
      'outcomeSource', c.outcome_source,
      'startedAt', c.started_at,
      'answeredAt', c.answered_at,
      'endedAt', c.ended_at,
      'talkSeconds', c.talk_seconds,
      'phone', CASE WHEN c.client_phone IS NULL THEN NULL
        ELSE platform_private.whatsapp_masked_phone(ltrim(c.client_phone, '+')) END,
      'managerName', mp.display_name,
      'participants', COALESCE(parts.items, '[]'::JSONB),
      'recording', c.recording_state,
      'resultCode', c.result_code,
      'resultAt', c.result_at,
      'resultByName', rp.display_name,
      'callbackOn', c.result_callback_on,
      'resultEditable', COALESCE(
        v_result_on
        AND platform_private.telephony_result_window_open(c.outcome, c.created_via, c.started_at, c.result_code,
          c.result_at, v_now)
        AND (v_all OR platform_private.telephony_call_taken_by(c.organization_id, c.id, v_actor.membership_id)),
        FALSE)
    ) AS obj
    FROM platform_private.telephony_calls c
    LEFT JOIN platform.organization_memberships mm
      ON mm.organization_id = c.organization_id AND mm.id = c.membership_id
    LEFT JOIN platform.profiles mp ON mp.id = mm.profile_id
    LEFT JOIN platform.organization_memberships rm
      ON rm.organization_id = c.organization_id AND rm.id = c.result_by
    LEFT JOIN platform.profiles rp ON rp.id = rm.profile_id
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object('name', leg.display_name, 'state', leg.state)
        ORDER BY leg.leg_started_at, leg.display_name, leg.id) AS items
      FROM (
        SELECT l.id, l.leg_started_at, l.state, lp.display_name
        FROM platform_private.telephony_call_legs l
        JOIN platform.organization_memberships lm
          ON lm.organization_id = l.organization_id AND lm.id = l.membership_id
        JOIN platform.profiles lp ON lp.id = lm.profile_id
        WHERE l.organization_id = c.organization_id AND l.call_id = c.id AND l.membership_id IS NOT NULL
        ORDER BY l.leg_started_at, lp.display_name, l.id
        LIMIT 6
      ) leg
    ) parts ON TRUE
    WHERE c.organization_id = p_organization_id
      AND (c.lead_id = p_lead_id OR (c.lead_id IS NULL AND c.client_id = v_client))
      AND (p_since IS NULL OR c.started_at >= p_since)
      AND (p_until IS NULL OR c.started_at < p_until)
    ORDER BY c.started_at DESC, c.id DESC
    LIMIT p_limit + 1
  ) r;

  SELECT COALESCE(jsonb_agg(t.e ORDER BY t.ord), '[]'::JSONB) INTO v_calls
  FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS t(e, ord) WHERE t.ord <= p_limit;

  RETURN jsonb_build_object(
    'enabled', TRUE,
    'canSetResult', v_result_on,
    'hasMore', jsonb_array_length(v_rows) > p_limit,
    'calls', v_calls);
END
$$;

-- ---------------------------------------------------------------------------
-- Результат звонка одним нажатием.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.telephony_set_result_v1(
  p_organization_id UUID,
  p_call_id UUID,
  p_result_code TEXT,
  p_callback_on DATE DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor RECORD;
  v_settings platform_private.telephony_settings;
  v_call platform_private.telephony_calls;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_today DATE;
  v_visible BOOLEAN;
  v_exists BOOLEAN;
BEGIN
  -- «Недозвон» ставит система (T8), сотрудник — только три нажатия; дата есть
  -- тогда и только тогда, когда «Перезвонить».
  IF p_organization_id IS NULL OR p_call_id IS NULL OR p_result_code IS NULL
     OR p_result_code NOT IN ('reached', 'callback', 'not_interested')
     OR (p_result_code = 'callback') <> (p_callback_on IS NOT NULL) THEN
    RAISE EXCEPTION 'telephony_result_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT a.membership_id, a.profile_id, a.auth_user_id INTO v_actor FROM platform.current_actor_authority() a
   WHERE a.organization_id = p_organization_id AND a.platform_role IS DISTINCT FROM 'student' LIMIT 1;
  IF NOT FOUND OR NOT platform_private.staff_can_access(p_organization_id, v_actor.membership_id,
       'telephony.call.dial', 'organization', p_organization_id) THEN
    RAISE EXCEPTION 'telephony_result_forbidden' USING ERRCODE = '42501';
  END IF;
  -- Результат — часть «Позвонить» (§9.1): нужны оба флага; клиент не решает.
  SELECT * INTO v_settings FROM platform_private.telephony_settings s WHERE s.organization_id = p_organization_id;
  IF NOT FOUND OR NOT (v_settings.ui_enabled AND v_settings.dial_enabled) THEN
    RAISE EXCEPTION 'telephony_result_disabled' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_call FROM platform_private.telephony_calls c
   WHERE c.organization_id = p_organization_id AND c.id = p_call_id FOR UPDATE;
  v_exists := FOUND;
  -- Звонок без лида и клиента не виден ни в одной ленте: результата у него нет.
  -- Нет звонка и «не вижу лид» отвечают одинаково (P0002): наличие чужого звонка не выдаётся.
  IF v_exists THEN
    v_visible := v_call.client_id IS NOT NULL AND (
      (v_call.lead_id IS NOT NULL AND platform_private.staff_can_access(p_organization_id, v_actor.membership_id,
        'lead.read', 'lead', v_call.lead_id))
      OR (v_call.lead_id IS NULL AND EXISTS (
        SELECT 1 FROM platform.leads l
        WHERE l.organization_id = p_organization_id AND l.client_id = v_call.client_id
          AND platform_private.staff_can_access(p_organization_id, v_actor.membership_id, 'lead.read', 'lead', l.id))));
  END IF;
  IF NOT v_exists OR NOT COALESCE(v_visible, FALSE) THEN
    RAISE EXCEPTION 'telephony_call_unavailable' USING ERRCODE = 'P0002';
  END IF;

  -- «Свои» — звонок, в котором говорил сам; «все» — у держателя telephony.manage (§11).
  IF NOT (platform_private.telephony_call_taken_by(p_organization_id, p_call_id, v_actor.membership_id)
          OR platform_private.staff_can_access(p_organization_id, v_actor.membership_id, 'telephony.manage',
            'organization', p_organization_id)) THEN
    RAISE EXCEPTION 'telephony_result_forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_call.outcome IS DISTINCT FROM 'answered' THEN
    RAISE EXCEPTION 'telephony_result_not_answered' USING ERRCODE = 'PT409';
  END IF;
  IF NOT platform_private.telephony_result_window_open(v_call.outcome, v_call.created_via, v_call.started_at,
       v_call.result_code, v_call.result_at, v_now) THEN
    RAISE EXCEPTION 'telephony_result_closed' USING ERRCODE = 'PT409';
  END IF;
  IF p_callback_on IS NOT NULL THEN
    v_today := (v_now AT TIME ZONE 'Asia/Bishkek')::DATE;
    IF NOT isfinite(p_callback_on) OR p_callback_on < v_today OR p_callback_on > v_today + 365 THEN
      RAISE EXCEPTION 'telephony_result_date_invalid' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Тот же результат и та же дата: ничего не меняется и не пишется в журнал.
  IF v_call.result_code IS NOT DISTINCT FROM p_result_code
     AND v_call.result_callback_on IS NOT DISTINCT FROM p_callback_on THEN
    RETURN jsonb_build_object('status', 'unchanged', 'callId', v_call.id, 'resultCode', v_call.result_code,
      'resultAt', v_call.result_at, 'callbackOn', v_call.result_callback_on);
  END IF;

  UPDATE platform_private.telephony_calls c
     SET result_code = p_result_code, result_by = v_actor.membership_id, result_at = v_now,
         result_callback_on = p_callback_on, updated_at = v_now
   WHERE c.organization_id = p_organization_id AND c.id = p_call_id;

  -- Журнал: идентификаторы и коды, без номера клиента и без имён.
  INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal, action,
    resource_type, resource_id, before_state, after_state, reason, request_id, created_at, actor_membership_id)
  VALUES (p_organization_id, 'user', v_actor.profile_id, 'auth:' || v_actor.auth_user_id::TEXT,
    'telephony.result.set', 'telephony_call', p_call_id,
    jsonb_build_object('resultCode', v_call.result_code, 'callbackOn', v_call.result_callback_on),
    jsonb_build_object('resultCode', p_result_code, 'callbackOn', p_callback_on, 'direction', v_call.direction,
      'leadId', v_call.lead_id),
    'Телефония: результат звонка', gen_random_uuid(), v_now, v_actor.membership_id);

  RETURN jsonb_build_object('status', 'saved', 'callId', p_call_id, 'resultCode', p_result_code,
    'resultAt', v_now, 'callbackOn', p_callback_on);
END
$$;

-- ---------------------------------------------------------------------------
-- Права: помощники закрыты для всех клиентских ролей, публичные функции — только
-- для authenticated (право и флаги проверяются внутри).
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  platform_private.telephony_result_window_open(TEXT, TEXT, TIMESTAMPTZ, TEXT, TIMESTAMPTZ, TIMESTAMPTZ),
  platform_private.telephony_call_taken_by(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
REVOKE ALL ON FUNCTION
  platform.telephony_lead_calls_v1(UUID, UUID, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ),
  platform.telephony_set_result_v1(UUID, UUID, TEXT, DATE)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
GRANT EXECUTE ON FUNCTION
  platform.telephony_lead_calls_v1(UUID, UUID, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ),
  platform.telephony_set_result_v1(UUID, UUID, TEXT, DATE)
  TO authenticated;

COMMENT ON FUNCTION platform.telephony_lead_calls_v1(UUID, UUID, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ) IS
  'Telephony T5: call rows for the lead card feed (masked number, no recording link, no player). Needs lead.read on the lead; empty unless ui_enabled.';
COMMENT ON FUNCTION platform.telephony_set_result_v1(UUID, UUID, TEXT, DATE) IS
  'Telephony T5: one-tap call result (reached / callback + day / not_interested). Needs telephony.call.dial, ui_enabled and dial_enabled; manager: calls he talked on; telephony.manage: any visible call; audited as telephony.result.set.';
COMMENT ON FUNCTION platform_private.telephony_result_window_open(TEXT, TEXT, TIMESTAMPTZ, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) IS
  'Telephony T5: a result may be set on an answered, non-backfill call for 7 days and changed for 24 hours after it was set.';
COMMENT ON FUNCTION platform_private.telephony_call_taken_by(UUID, UUID, UUID) IS
  'Telephony T5: the employee talked on this call (first to answer, or an accepted/completed/transferred leg).';

-- Проверка в конце: права ровно такие, как задумано.
DO $tel292_verify$
DECLARE
  r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'service_role', 'supabase_auth_admin', 'evo_ai_agent'] LOOP
    IF has_function_privilege(r, 'platform.telephony_lead_calls_v1(uuid,uuid,integer,timestamptz,timestamptz)', 'EXECUTE')
       OR has_function_privilege(r, 'platform.telephony_set_result_v1(uuid,uuid,text,date)', 'EXECUTE') THEN
      RAISE EXCEPTION 'telephony_lead_feed_acl_drift: %', r USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF has_function_privilege('public', 'platform.telephony_lead_calls_v1(uuid,uuid,integer,timestamptz,timestamptz)', 'EXECUTE')
     OR has_function_privilege('public', 'platform.telephony_set_result_v1(uuid,uuid,text,date)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'platform.telephony_lead_calls_v1(uuid,uuid,integer,timestamptz,timestamptz)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'platform.telephony_set_result_v1(uuid,uuid,text,date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'telephony_lead_feed_acl_drift: authenticated' USING ERRCODE = '55000';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'supabase_auth_admin', 'evo_ai_agent'] LOOP
    IF has_function_privilege(r, 'platform_private.telephony_result_window_open(text,text,timestamptz,text,timestamptz,timestamptz)', 'EXECUTE')
       OR has_function_privilege(r, 'platform_private.telephony_call_taken_by(uuid,uuid,uuid)', 'EXECUTE') THEN
      RAISE EXCEPTION 'telephony_lead_feed_helper_acl_drift: %', r USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$tel292_verify$;

COMMIT;
