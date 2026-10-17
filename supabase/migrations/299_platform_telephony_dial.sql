-- 299_platform_telephony_dial — «Телефония Beeline KG» срез T7: кнопка «Позвонить»
-- (EVO → ВАТС `makecall`): проверки набора в базе, идемпотентность, лимиты, журнал.
-- Контракт: docs/EVO_TELEPHONY_PLAN_2026-10-16.md §5.4, §6.4, §6.5, §8, §9.1, §11, §12,
-- §16 (срез T7), ADR 0033; docs/PLAN_CHANGES.md (запись «Телефония T7»). Только
-- функции: таблица наборов (`telephony_dial_requests`), настройки (префиксы и лимиты),
-- сопоставление сотрудников и право `telephony.call.dial` уже есть (288, 291, 296), как и
-- слова журнала (`telephony.dial`, тип `telephony_dial_request`, миграция 291). Сам звонок
-- в ВАТС делает сервер приложения (`POST /crmapi/v1/makecall`), не база; база решает,
-- МОЖНО ЛИ звонить, и записывает, ЧТО из этого вышло. Слияние ничего не открывает:
-- набор закрыт флагами `ui_enabled` и `dial_enabled` (по умолчанию выключены),
-- `outbound_paused` и группой ключей ВАТС в env.
--
-- Номер клиента берётся только на сервере: браузер присылает идентификатор лида и
-- `request_id`, а полный номер и логин ВАТС отдаёт ровно одна функция и только
-- серверу (`telephony_dial_target_v1`, service_role), как ссылку на запись в T6.
--
-- Что делает:
--  * platform.telephony_dial_options_v1(организация) — для authenticated. Для страниц:
--    показывать ли кнопку «Позвонить» (`enabled`: настройки есть, `ui_enabled` и
--    `dial_enabled` включены, `outbound_paused` нет, у сотрудника есть
--    `telephony.call.dial`) и сопоставлен ли он с пользователем ВАТС (`mapped`).
--    Без права и при выключенных флагах — `enabled = false`, а не ошибка: страница
--    просто не рисует кнопку. Номеров и логинов в ответе нет.
--  * platform.telephony_dial_begin_v1(организация, лид, request_id) — для authenticated.
--    Порядок: форма (22023) → сессия сотрудника не Student (42501) → право
--    `telephony.call.dial` (42501) → флаги (нет строки настроек, выключен `ui_enabled`
--    или `dial_enabled`, включён `outbound_paused` → 55000) → очередь по организации
--    (advisory-замок: лимиты считаются точно) → ПОВТОР `request_id` этого сотрудника
--    (прежний результат, второго набора нет; `request_id` другого лида — PT409) →
--    лид виден сотруднику (`lead.read`; нет или не виден — одинаково P0002) → номер
--    клиента → отказы с записью: `lead_no_phone`, `number_invalid`,
--    `prefix_not_allowed`, `number_blocked`, `not_mapped`, `rate_gap`, `limit_user_day`,
--    `limit_org_hour`, `limit_org_day`. Отказ записывается строкой набора
--    (`status = 'refused'`, без номера и логина) и одной строкой журнала
--    `telephony.dial`; при согласии создаётся строка `requested` с номером E.164 и
--    логином ВАТС (они нужны будущей привязке звонка к набору: приём 289 и сверка 293 их
--    пока НЕ читают, см. PLAN_CHANGES «Телефония T7», п. 14б). Не больше двадцати
--    записанных отказов одного сотрудника за скользящую минуту: дальше PT429 и ничего не
--    записывается (иначе отказы можно плодить без конца). Ответ: только идентификатор
--    набора и слова, ни номера, ни логина.
--  * platform.telephony_dial_target_v1(организация, набор, сотрудник) — только
--    service_role. Отдаёт `{pbxUser, phone}` набора в состоянии `requested` этого
--    сотрудника не старше двух минут: единственное место, где номер читается.
--  * platform.telephony_dial_finish_v1(организация, набор, сотрудник, итог, callid,
--    HTTP-статус, код ошибки, код отказа) — только service_role. Единственный переход
--    `requested` → `sent` (нужен `callid`) | `unconfirmed` (ответ 2xx без `callid`,
--    таймаут, обрыв: звонок мог уйти, второго набора нет) | `failed` (ВАТС ответила
--    ошибкой) | `refused` (`pbx_offline`, `pbx_user_not_found`: проверка статуса
--    сотрудника перед набором, §5.4). Звонка не было, поэтому у `refused` номер и логин в
--    строке набора стираются (`client_phone`, `pbx_user` = NULL). Повтор итога ничего не
--    меняет и не пишется в журнал. Итог — одна строка журнала `telephony.dial`
--    (идентификаторы и коды, без номера, логина и `callid`).
--  * Набор, у которого итог так и не пришёл (процесс упал между вызовами), при повторе
--    с тем же `request_id` через две минуты становится `unconfirmed` (`finish_lost`) и
--    получает свою строку журнала; он продолжает считаться в лимитах.
--  * Два частных помощника: проверка номера (`telephony_dial_number_blocked`) и запись
--    отказа (`telephony_dial_record_refusal`); оба закрыты для всех клиентских ролей.
--
-- Лимиты (§6.5, значения — в `telephony_settings`): не чаще одного набора в
-- `limit_user_gap_seconds` секунд и не больше `limit_user_day` за скользящие 24 часа на
-- сотрудника; не больше `limit_org_hour` за скользящий час и `limit_org_day` за
-- скользящие 24 часа на организацию. В лимиты входят все наборы, кроме отказов
-- (`requested`, `sent`, `unconfirmed`, `failed`): неподтверждённый звонок мог состояться
-- и стоит денег. Отказы не засчитываются в суточные и часовые лимиты, но отказ проверки статуса
-- сотрудника (`pbx_offline`, `pbx_user_not_found`) идёт в паузу между наборами: он стоит
-- запроса к ВАТС, и сотрудник с выключенным устройством не должен опрашивать её без конца.
-- Номер (§6.5): E.164 из карточки клиента (строго: с «+», «00» или в национальной форме
-- КР), разрешённые префиксы из настроек (по умолчанию только +996), а короткие,
-- служебные и платные диапазоны блокируются всегда (`telephony_dial_number_blocked`).
-- Список диапазонов консервативный и расширяется новой миграцией.
--
-- Безопасно для production: только новые функции, ни таблиц, ни столбцов, ни данных,
-- ни политик; ни один флаг не включается. Повторный запуск целой миграции отказывает
-- (CREATE FUNCTION), ничего не меняя.
BEGIN;

DO $tel299_preconditions$
BEGIN
  IF to_regclass('platform_private.telephony_dial_requests') IS NULL
    OR to_regclass('platform_private.telephony_settings') IS NULL
    OR to_regclass('platform_private.telephony_extensions') IS NULL
    OR to_regprocedure('platform_private.staff_can_access(uuid,uuid,text,text,uuid)') IS NULL
    OR to_regprocedure('platform_private.admissions_direct_phone(text)') IS NULL
    OR to_regprocedure('platform.current_actor_authority()') IS NULL
    OR to_regprocedure('platform_private.p7a_safe_audit_actions()') IS NULL
    OR to_regprocedure('platform.telephony_set_result_v1(uuid,uuid,text,date)') IS NULL THEN
    RAISE EXCEPTION 'telephony_t7_requires_current_chain' USING ERRCODE = '55000';
  END IF;
  IF NOT ('telephony.dial' = ANY (platform_private.p7a_safe_audit_actions())) THEN
    RAISE EXCEPTION 'telephony_t7_requires_journal_allowlist' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname IN ('telephony_dial_options_v1', 'telephony_dial_begin_v1', 'telephony_dial_target_v1',
        'telephony_dial_finish_v1', 'telephony_dial_number_blocked', 'telephony_dial_record_refusal')
      AND n.nspname IN ('platform', 'platform_private')
  ) THEN
    RAISE EXCEPTION 'telephony_t7_functions_already_exist' USING ERRCODE = '55000';
  END IF;
END
$tel299_preconditions$;

-- ---------------------------------------------------------------------------
-- Номер, на который звонить нельзя никогда (§6.5): короткий, служебный, платный.
-- Принимает номер в E.164 («+…»). Чистая функция.
--  * короче 9 цифр целиком (код страны и номер): экстренные и служебные короткие номера
--    в E.164 не бывают, а у крошечных территорий звонят крайне редко;
--  * внемережевые коды ITU: +800 (международный бесплатный), +808, +870–878 (спутниковые и
--    персональные), +881–883 (спутниковые и международные сети), +888, +979 (международные
--    платные услуги);
--  * Кыргызстан: +996 800… (бесплатные) и +996 900… (платные услуги);
--  * Россия и Казахстан (+7): 800 (бесплатные) и 809 (платные);
--  * США и Канада (+1): 900 и 976 (платные);
--  * Великобритания (+44): 9xx (платные), 70 (персональные номера);
--  * Германия (+49): 900, 137, 180 и 118 (платные и справочные).
-- Список консервативный: расширяется новой миграцией.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.telephony_dial_number_blocked(p_e164 TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_e164 IS NULL
    OR p_e164 !~ '^\+[1-9][0-9]{8,14}$'
    OR p_e164 ~ '^\+(800|808|87[0-8]|88[1-3]|888|979)'
    OR p_e164 ~ '^\+996(800|900)'
    OR p_e164 ~ '^\+7(800|809)'
    OR p_e164 ~ '^\+1(900|976)'
    OR p_e164 ~ '^\+44(9|70)'
    OR p_e164 ~ '^\+49(900|137|180|118)'
$$;

-- ---------------------------------------------------------------------------
-- Отказ набора: строка набора (без номера и логина) и одна строка журнала.
-- Возвращает ответ для begin. Закрыт для всех клиентских ролей.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.telephony_dial_record_refusal(
  p_organization_id UUID,
  p_request_id UUID,
  p_membership_id UUID,
  p_profile_id UUID,
  p_auth_user_id UUID,
  p_client_id UUID,
  p_lead_id UUID,
  p_code TEXT,
  p_now TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $$
DECLARE
  v_row platform_private.telephony_dial_requests;
BEGIN
  INSERT INTO platform_private.telephony_dial_requests (organization_id, request_id, membership_id, client_id, lead_id,
    status, refusal_code, created_at, updated_at)
  VALUES (p_organization_id, p_request_id, p_membership_id, p_client_id, p_lead_id, 'refused', p_code, p_now, p_now)
  RETURNING * INTO v_row;
  INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal, action,
    resource_type, resource_id, before_state, after_state, reason, request_id, created_at, actor_membership_id)
  VALUES (p_organization_id, 'user', p_profile_id, 'auth:' || p_auth_user_id::TEXT,
    'telephony.dial', 'telephony_dial_request', v_row.id,
    '{}'::JSONB,
    jsonb_build_object('status', 'refused', 'code', p_code, 'leadId', p_lead_id, 'dialRequestId', v_row.id),
    'Телефония: отказ набора', gen_random_uuid(), p_now, p_membership_id);
  RETURN jsonb_build_object('status', 'refused', 'dialRequestId', v_row.id, 'code', p_code);
END
$$;

-- ---------------------------------------------------------------------------
-- Показывать ли кнопку «Позвонить» этому сотруднику и сопоставлен ли он в ВАТС.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.telephony_dial_options_v1(p_organization_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor RECORD;
  v_settings platform_private.telephony_settings;
  v_enabled BOOLEAN;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'telephony_dial_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT a.membership_id INTO v_actor FROM platform.current_actor_authority() a
   WHERE a.organization_id = p_organization_id AND a.platform_role IS DISTINCT FROM 'student' LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'telephony_dial_forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_settings FROM platform_private.telephony_settings s WHERE s.organization_id = p_organization_id;
  -- Нет строки настроек — набора нет (§9.1); без права кнопка не рисуется, ошибки нет.
  v_enabled := FOUND AND v_settings.ui_enabled AND v_settings.dial_enabled AND NOT v_settings.outbound_paused
    AND platform_private.staff_can_access(p_organization_id, v_actor.membership_id, 'telephony.call.dial',
      'organization', p_organization_id);
  IF NOT v_enabled THEN
    RETURN jsonb_build_object('enabled', FALSE, 'mapped', FALSE);
  END IF;
  RETURN jsonb_build_object('enabled', TRUE, 'mapped', EXISTS (
    SELECT 1 FROM platform_private.telephony_extensions x
     WHERE x.organization_id = p_organization_id AND x.membership_id = v_actor.membership_id AND x.active));
END
$$;

-- ---------------------------------------------------------------------------
-- Начало набора: все проверки, идемпотентность, лимиты, запись.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.telephony_dial_begin_v1(
  p_organization_id UUID,
  p_lead_id UUID,
  p_request_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor RECORD;
  v_settings platform_private.telephony_settings;
  v_row platform_private.telephony_dial_requests;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_client UUID;
  v_raw_phone TEXT;
  v_e164 TEXT;
  v_user TEXT;
  v_code TEXT;
  v_user_day INTEGER;
  v_org_hour INTEGER;
  v_org_day INTEGER;
  v_last TIMESTAMPTZ;
BEGIN
  IF p_organization_id IS NULL OR p_lead_id IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'telephony_dial_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT a.membership_id, a.profile_id, a.auth_user_id INTO v_actor FROM platform.current_actor_authority() a
   WHERE a.organization_id = p_organization_id AND a.platform_role IS DISTINCT FROM 'student' LIMIT 1;
  IF NOT FOUND OR NOT platform_private.staff_can_access(p_organization_id, v_actor.membership_id,
       'telephony.call.dial', 'organization', p_organization_id) THEN
    RAISE EXCEPTION 'telephony_dial_forbidden' USING ERRCODE = '42501';
  END IF;
  -- Набор — часть «Позвонить» (§9.1): нужны оба флага, а при паузе исходящих набора нет;
  -- нет строки настроек — выключено. Клиент не решает.
  SELECT * INTO v_settings FROM platform_private.telephony_settings s WHERE s.organization_id = p_organization_id;
  IF NOT FOUND OR NOT (v_settings.ui_enabled AND v_settings.dial_enabled) OR v_settings.outbound_paused THEN
    RAISE EXCEPTION 'telephony_dial_disabled' USING ERRCODE = '55000';
  END IF;

  -- Наборы организации идут по очереди: лимиты и «не чаще одного в N секунд» считаются
  -- точно, а повтор request_id не создаёт двух строк.
  PERFORM pg_advisory_xact_lock(hashtextextended('telephony_dial:' || p_organization_id::TEXT, 0));

  -- Повтор: прежний результат этого сотрудника, второго набора нет.
  SELECT * INTO v_row FROM platform_private.telephony_dial_requests d
   WHERE d.organization_id = p_organization_id AND d.membership_id = v_actor.membership_id
     AND d.request_id = p_request_id;
  IF FOUND THEN
    IF v_row.lead_id IS DISTINCT FROM p_lead_id THEN
      RAISE EXCEPTION 'telephony_dial_request_conflict' USING ERRCODE = 'PT409';
    END IF;
    IF v_row.status = 'requested' AND v_now - v_row.created_at >= INTERVAL '2 minutes' THEN
      -- Итог так и не пришёл (процесс упал между вызовами): звонок мог уйти, второго не будет.
      UPDATE platform_private.telephony_dial_requests d
         SET status = 'unconfirmed', pbx_error_code = 'finish_lost', updated_at = v_now
       WHERE d.organization_id = p_organization_id AND d.id = v_row.id
      RETURNING * INTO v_row;
      INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal, action,
        resource_type, resource_id, before_state, after_state, reason, request_id, created_at, actor_membership_id)
      VALUES (p_organization_id, 'user', v_actor.profile_id, 'auth:' || v_actor.auth_user_id::TEXT,
        'telephony.dial', 'telephony_dial_request', v_row.id,
        jsonb_build_object('status', 'requested'),
        jsonb_build_object('status', 'unconfirmed', 'code', 'finish_lost', 'leadId', v_row.lead_id,
          'dialRequestId', v_row.id),
        'Телефония: набор без итога', gen_random_uuid(), v_now, v_actor.membership_id);
    END IF;
    RETURN jsonb_build_object('status', 'replayed', 'dialRequestId', v_row.id, 'requestStatus', v_row.status,
      'code', COALESCE(v_row.refusal_code, v_row.pbx_error_code));
  END IF;

  -- Лид виден сотруднику (lead.read, как лента звонков): нет лида и «не вижу лид» отвечают
  -- одинаково, наличие чужого лида не выдаётся.
  SELECT l.client_id INTO v_client FROM platform.leads l
   WHERE l.organization_id = p_organization_id AND l.id = p_lead_id;
  IF NOT FOUND OR NOT platform_private.staff_can_access(p_organization_id, v_actor.membership_id,
       'lead.read', 'lead', p_lead_id) THEN
    RAISE EXCEPTION 'telephony_dial_lead_unavailable' USING ERRCODE = 'P0002';
  END IF;

  -- Номер клиента: только из карточки, на сервере; браузер его не присылает.
  SELECT c.phone INTO v_raw_phone FROM platform.clients c
   WHERE c.organization_id = p_organization_id AND c.id = v_client;
  v_e164 := CASE WHEN v_raw_phone IS NULL THEN NULL ELSE platform_private.admissions_direct_phone(v_raw_phone) END;
  SELECT x.pbx_user INTO v_user FROM platform_private.telephony_extensions x
   WHERE x.organization_id = p_organization_id AND x.membership_id = v_actor.membership_id AND x.active
   ORDER BY x.created_at, x.id LIMIT 1;

  -- Первый сработавший отказ (порядок важен для слов в интерфейсе).
  IF v_raw_phone IS NULL OR btrim(v_raw_phone) = '' THEN
    v_code := 'lead_no_phone';
  ELSIF v_e164 IS NULL THEN
    v_code := 'number_invalid';
  ELSIF NOT EXISTS (SELECT 1 FROM unnest(v_settings.dial_prefixes) AS p WHERE left(v_e164, length(p)) = p) THEN
    v_code := 'prefix_not_allowed';
  ELSIF platform_private.telephony_dial_number_blocked(v_e164) THEN
    v_code := 'number_blocked';
  ELSIF v_user IS NULL THEN
    v_code := 'not_mapped';
  END IF;

  IF v_code IS NULL THEN
    -- Лимиты (§6.5): считаются наборы, кроме отказов, за скользящие окна.
    SELECT count(*) FILTER (WHERE d.status <> 'refused' AND d.membership_id = v_actor.membership_id),
           count(*) FILTER (WHERE d.status <> 'refused' AND d.created_at > v_now - INTERVAL '1 hour'),
           count(*) FILTER (WHERE d.status <> 'refused'),
           -- Пауза между наборами: не только наборы, но и отказ проверки статуса (запрос к ВАТС).
           max(d.created_at) FILTER (WHERE d.membership_id = v_actor.membership_id
             AND (d.status <> 'refused' OR d.refusal_code IN ('pbx_offline', 'pbx_user_not_found')))
      INTO v_user_day, v_org_hour, v_org_day, v_last
      FROM platform_private.telephony_dial_requests d
     WHERE d.organization_id = p_organization_id
       AND d.created_at > v_now - INTERVAL '24 hours';
    IF v_last IS NOT NULL AND v_now - v_last < make_interval(secs => v_settings.limit_user_gap_seconds) THEN
      v_code := 'rate_gap';
    ELSIF v_user_day >= v_settings.limit_user_day THEN
      v_code := 'limit_user_day';
    ELSIF v_org_hour >= v_settings.limit_org_hour THEN
      v_code := 'limit_org_hour';
    ELSIF v_org_day >= v_settings.limit_org_day THEN
      v_code := 'limit_org_day';
    END IF;
  END IF;

  IF v_code IS NOT NULL THEN
    -- Отказы тоже строка и запись журнала: больше двадцати за минуту у одного сотрудника не
    -- записываются (PT429), чтобы прямыми вызовами их нельзя было плодить без конца. Повтор
    -- request_id (выше) этим не затрагивается; пока отказов меньше двадцати, всё как раньше.
    IF (SELECT count(*) FROM platform_private.telephony_dial_requests d
         WHERE d.organization_id = p_organization_id AND d.membership_id = v_actor.membership_id
           AND d.status = 'refused' AND d.created_at > v_now - INTERVAL '1 minute') >= 20 THEN
      RAISE EXCEPTION 'telephony_dial_throttled' USING ERRCODE = 'PT429';
    END IF;
    RETURN platform_private.telephony_dial_record_refusal(p_organization_id, p_request_id, v_actor.membership_id,
      v_actor.profile_id, v_actor.auth_user_id, v_client, p_lead_id, v_code, v_now);
  END IF;

  INSERT INTO platform_private.telephony_dial_requests (organization_id, request_id, membership_id, client_id, lead_id,
    pbx_user, client_phone, status, created_at, updated_at)
  VALUES (p_organization_id, p_request_id, v_actor.membership_id, v_client, p_lead_id, v_user, v_e164, 'requested',
    v_now, v_now)
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('status', 'accepted', 'dialRequestId', v_row.id);
END
$$;

-- ---------------------------------------------------------------------------
-- Данные для вызова ВАТС: только сервер. Единственное место, где номер клиента и логин
-- ВАТС читаются из строки набора.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.telephony_dial_target_v1(
  p_organization_id UUID,
  p_dial_request_id UUID,
  p_membership_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row platform_private.telephony_dial_requests;
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role is required' USING ERRCODE = '42501';
  END IF;
  IF p_organization_id IS NULL OR p_dial_request_id IS NULL OR p_membership_id IS NULL THEN
    RAISE EXCEPTION 'telephony_dial_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_row FROM platform_private.telephony_dial_requests d
   WHERE d.organization_id = p_organization_id AND d.id = p_dial_request_id AND d.membership_id = p_membership_id
     AND d.status = 'requested' AND d.created_at > clock_timestamp() - INTERVAL '2 minutes';
  IF NOT FOUND OR v_row.pbx_user IS NULL OR v_row.client_phone IS NULL THEN
    RAISE EXCEPTION 'telephony_dial_target_unavailable' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object('pbxUser', v_row.pbx_user, 'phone', v_row.client_phone);
END
$$;

-- ---------------------------------------------------------------------------
-- Итог набора: один переход requested → sent | unconfirmed | failed | refused.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.telephony_dial_finish_v1(
  p_organization_id UUID,
  p_dial_request_id UUID,
  p_membership_id UUID,
  p_outcome TEXT,
  p_pbx_callid TEXT,
  p_pbx_http_status INTEGER,
  p_error_code TEXT,
  p_refusal_code TEXT
) RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row platform_private.telephony_dial_requests;
  v_profile UUID;
  v_auth UUID;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role is required' USING ERRCODE = '42501';
  END IF;
  -- Форма итога: у каждого своя комбинация полей, остальные пусты.
  IF p_organization_id IS NULL OR p_dial_request_id IS NULL OR p_membership_id IS NULL OR p_outcome IS NULL
     OR p_outcome NOT IN ('sent', 'unconfirmed', 'failed', 'refused')
     OR (p_outcome = 'sent') <> (p_pbx_callid IS NOT NULL)
     OR (p_pbx_callid IS NOT NULL AND (char_length(p_pbx_callid) NOT BETWEEN 1 AND 200
       OR p_pbx_callid <> btrim(p_pbx_callid) OR p_pbx_callid ~ '[[:cntrl:]]'))
     OR (p_outcome IN ('failed', 'unconfirmed')) <> (p_error_code IS NOT NULL)
     OR (p_error_code IS NOT NULL AND p_error_code !~ '^[a-z][a-z0-9_]{0,63}$')
     OR (p_outcome = 'refused') <> (p_refusal_code IS NOT NULL)
     OR (p_refusal_code IS NOT NULL AND p_refusal_code NOT IN ('pbx_offline', 'pbx_user_not_found'))
     OR (p_pbx_http_status IS NOT NULL AND p_pbx_http_status NOT BETWEEN 100 AND 599) THEN
    RAISE EXCEPTION 'telephony_dial_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM platform_private.telephony_dial_requests d
   WHERE d.organization_id = p_organization_id AND d.id = p_dial_request_id AND d.membership_id = p_membership_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'telephony_dial_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Итог уже есть: повтор ничего не меняет и не пишется в журнал.
  IF v_row.status <> 'requested' THEN
    RETURN jsonb_build_object('status', v_row.status, 'changed', FALSE);
  END IF;

  -- Отказ проверки статуса: звонка не было, номер и логин в строке не нужны и стираются.
  UPDATE platform_private.telephony_dial_requests d
     SET status = p_outcome, pbx_callid = p_pbx_callid, pbx_http_status = p_pbx_http_status,
         pbx_error_code = p_error_code, refusal_code = p_refusal_code, updated_at = v_now,
         client_phone = CASE WHEN p_outcome = 'refused' THEN NULL ELSE client_phone END,
         pbx_user = CASE WHEN p_outcome = 'refused' THEN NULL ELSE pbx_user END
   WHERE d.organization_id = p_organization_id AND d.id = p_dial_request_id;

  SELECT m.profile_id, pr.auth_user_id INTO v_profile, v_auth
    FROM platform.organization_memberships m
    JOIN platform.profiles pr ON pr.id = m.profile_id
   WHERE m.organization_id = p_organization_id AND m.id = p_membership_id;
  -- Журнал: идентификаторы и коды, без номера клиента, логина ВАТС и callid.
  INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal, action,
    resource_type, resource_id, before_state, after_state, reason, request_id, created_at, actor_membership_id)
  VALUES (p_organization_id, 'user', v_profile, 'auth:' || COALESCE(v_auth, v_profile)::TEXT,
    'telephony.dial', 'telephony_dial_request', v_row.id,
    jsonb_build_object('status', 'requested'),
    jsonb_build_object('status', p_outcome, 'code', COALESCE(p_refusal_code, p_error_code),
      'httpStatus', p_pbx_http_status, 'leadId', v_row.lead_id, 'dialRequestId', v_row.id),
    CASE p_outcome WHEN 'refused' THEN 'Телефония: отказ набора' ELSE 'Телефония: набор из CRM' END,
    gen_random_uuid(), v_now, p_membership_id);

  RETURN jsonb_build_object('status', p_outcome, 'changed', TRUE);
END
$$;

-- ---------------------------------------------------------------------------
-- Права: помощники закрыты для всех клиентских ролей; options и begin — для
-- authenticated (право и флаги проверяются внутри); target и finish — только
-- service_role.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  platform_private.telephony_dial_number_blocked(TEXT),
  platform_private.telephony_dial_record_refusal(UUID, UUID, UUID, UUID, UUID, UUID, UUID, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
REVOKE ALL ON FUNCTION
  platform.telephony_dial_options_v1(UUID),
  platform.telephony_dial_begin_v1(UUID, UUID, UUID),
  platform.telephony_dial_target_v1(UUID, UUID, UUID),
  platform.telephony_dial_finish_v1(UUID, UUID, UUID, TEXT, TEXT, INTEGER, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
GRANT EXECUTE ON FUNCTION
  platform.telephony_dial_options_v1(UUID),
  platform.telephony_dial_begin_v1(UUID, UUID, UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION
  platform.telephony_dial_target_v1(UUID, UUID, UUID),
  platform.telephony_dial_finish_v1(UUID, UUID, UUID, TEXT, TEXT, INTEGER, TEXT, TEXT)
  TO service_role;

COMMENT ON FUNCTION platform_private.telephony_dial_number_blocked(TEXT) IS
  'Telephony T7: E.164 numbers that are never dialled: shorter than 9 digits, ITU non-geographic codes, and a conservative list of premium and service ranges (plan 6.5).';
COMMENT ON FUNCTION platform_private.telephony_dial_record_refusal(UUID, UUID, UUID, UUID, UUID, UUID, UUID, TEXT, TIMESTAMPTZ) IS
  'Telephony T7: records a refused dial (row without number or PBX login, one telephony.dial journal row) and returns the begin answer.';
COMMENT ON FUNCTION platform.telephony_dial_options_v1(UUID) IS
  'Telephony T7: whether the Call button is shown to this employee (flags ui_enabled and dial_enabled on, not paused, telephony.call.dial) and whether they are mapped to a PBX user. No number, no login.';
COMMENT ON FUNCTION platform.telephony_dial_begin_v1(UUID, UUID, UUID) IS
  'Telephony T7: all dial checks in the database (right, flags, idempotency by request id, lead visibility, number from the card, allowed prefixes, blocked ranges, PBX mapping, per-employee and per-organization limits, at most twenty recorded refusals per employee per minute: PT429 beyond). Records a refusal or a requested row; answers ids and words only, never a number or a PBX login.';
COMMENT ON FUNCTION platform.telephony_dial_target_v1(UUID, UUID, UUID) IS
  'Telephony T7: service-only. The PBX login and the client number of a requested dial of this employee, younger than two minutes; the only place the number is read from the dial row.';
COMMENT ON FUNCTION platform.telephony_dial_finish_v1(UUID, UUID, UUID, TEXT, TEXT, INTEGER, TEXT, TEXT) IS
  'Telephony T7: service-only. The single transition requested -> sent (call id) | unconfirmed | failed | refused (pbx_offline, pbx_user_not_found), with one telephony.dial journal row; a refused row loses the number and the PBX login (no call was made); a repeat changes nothing.';

-- Проверка в конце: права ровно такие, как задумано.
DO $tel299_verify$
DECLARE
  r TEXT;
  f REGPROCEDURE;
  p pg_catalog.pg_proc%ROWTYPE;
BEGIN
  FOR f IN SELECT x.oid::REGPROCEDURE FROM pg_catalog.pg_proc x
    JOIN pg_catalog.pg_namespace n ON n.oid = x.pronamespace
    WHERE n.nspname = 'platform' AND x.proname IN ('telephony_dial_options_v1', 'telephony_dial_begin_v1',
      'telephony_dial_target_v1', 'telephony_dial_finish_v1') LOOP
    SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid = f;
    IF NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
      OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) THEN
      RAISE EXCEPTION 'telephony_dial_function_posture: %', f USING ERRCODE = '55000';
    END IF;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['anon', 'service_role', 'supabase_auth_admin', 'evo_ai_agent'] LOOP
    IF has_function_privilege(r, 'platform.telephony_dial_options_v1(uuid)', 'EXECUTE')
       OR has_function_privilege(r, 'platform.telephony_dial_begin_v1(uuid,uuid,uuid)', 'EXECUTE') THEN
      RAISE EXCEPTION 'telephony_dial_acl_drift: %', r USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF NOT has_function_privilege('authenticated', 'platform.telephony_dial_options_v1(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'platform.telephony_dial_begin_v1(uuid,uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'telephony_dial_acl_drift: authenticated' USING ERRCODE = '55000';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'supabase_auth_admin', 'evo_ai_agent'] LOOP
    IF has_function_privilege(r, 'platform.telephony_dial_target_v1(uuid,uuid,uuid)', 'EXECUTE')
       OR has_function_privilege(r, 'platform.telephony_dial_finish_v1(uuid,uuid,uuid,text,text,integer,text,text)', 'EXECUTE') THEN
      RAISE EXCEPTION 'telephony_dial_service_acl_drift: %', r USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF NOT has_function_privilege('service_role', 'platform.telephony_dial_target_v1(uuid,uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'platform.telephony_dial_finish_v1(uuid,uuid,uuid,text,text,integer,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'telephony_dial_service_acl_drift: service_role' USING ERRCODE = '55000';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'supabase_auth_admin', 'evo_ai_agent'] LOOP
    IF has_function_privilege(r, 'platform_private.telephony_dial_number_blocked(text)', 'EXECUTE')
       OR has_function_privilege(r, 'platform_private.telephony_dial_record_refusal(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,timestamptz)', 'EXECUTE') THEN
      RAISE EXCEPTION 'telephony_dial_helper_acl_drift: %', r USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF has_function_privilege('public', 'platform_private.telephony_dial_number_blocked(text)', 'EXECUTE')
     OR has_function_privilege('public', 'platform_private.telephony_dial_record_refusal(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,timestamptz)', 'EXECUTE')
     OR has_function_privilege('public', 'platform.telephony_dial_options_v1(uuid)', 'EXECUTE')
     OR has_function_privilege('public', 'platform.telephony_dial_begin_v1(uuid,uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('public', 'platform.telephony_dial_target_v1(uuid,uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('public', 'platform.telephony_dial_finish_v1(uuid,uuid,uuid,text,text,integer,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'telephony_dial_acl_drift: public' USING ERRCODE = '55000';
  END IF;
END
$tel299_verify$;

COMMIT;
