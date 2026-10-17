-- 296_platform_telephony_settings — «Телефония Beeline KG» срез T4b: чтение и
-- правка «Настроек → Телефония» сотрудником с правом telephony.manage.
-- Контракт: docs/EVO_TELEPHONY_PLAN_2026-10-16.md §5.5, §6.3, §6.4, §9.1, §11,
-- §12, §16 (срез T4b); ADR 0033; docs/PLAN_CHANGES.md (запись «Телефония T4b»);
-- права и журнал — миграция 291 (T2), справочник и здоровье — 293 (T4a).
-- Таблицы настроек, справочника и состояния уже есть (288, 293). Здесь только
-- функции для сотрудника с cookie-сессией (роль authenticated); службе
-- (service_role) они недоступны, фоновые функции T4a остаются как были.
--
-- Что делает:
--  * platform_private.telephony_manage_actor(org) — сотрудник текущей сессии с
--    правом telephony.manage на ресурсе «организация» (staff_can_access: админ
--    и держатель роли «Телефония — руководитель»); студент и чужая организация
--    отказываются 42501;
--  * platform_private.telephony_settings_json(строка) — настройки организации в
--    одном виде (флаги, часы, получатель эскалаций, набор, потолки);
--  * platform_private.telephony_health_snapshot(org) — данные здоровья
--    интеграции, перенесённые из platform.telephony_integration_health_v1 (293)
--    без изменений: тело то же, проверка роли осталась в публичной функции, а
--    сама функция теперь тонкая обёртка над снимком (CREATE OR REPLACE с той же
--    подписью и теми же правами; ответ не меняется — набор сравнивает оба
--    ответа);
--  * platform.telephony_manage_overview_v1(org) — всё для экрана: настройки,
--    здоровье, пользователи ВАТС из последней сверки справочника (логин,
--    внутренний номер, имя, сотрудник EVO, число ног без сотрудника), сотрудники
--    EVO, которых можно выбрать, получатель эскалаций. При первом чтении
--    создаёт строку настроек со значениями по умолчанию (все флаги
--    выключены): «нет строки» и «строка по умолчанию» для функций T1b и T4a
--    значат одно и то же;
--  * platform.telephony_settings_save_v1(org, версия, патч, request_id) — правка
--    настроек одним патчем: флаги (разбор, интерфейс, набор, задачи
--    «Перезвонить», лиды по неизвестным номерам, первичный импорт, пауза
--    исходящих), рабочие дни и часы, срок перезвона, получатель эскалаций
--    (только тот, у кого действует telephony.manage), разрешённые префиксы,
--    лимиты набора, потолки автоматики. Версия обязательна (PT409 при чужой),
--    повтор того же request_id отдаёт ту же квитанцию, другой ввод под тем же
--    id — конфликт. Автоматика и первичный импорт не включаются без разбора
--    звонков (PT412). Включение любого флага автоматики снимает отметку
--    «остановлена по потолку» (план §9.1: включает снова админ после проверки);
--  * platform.telephony_extension_map_v1(org, пользователь ВАТС, прежний
--    сотрудник, новый сотрудник или NULL, request_id) — сопоставление
--    пользователя ВАТС и сотрудника EVO подтверждает человек: сверка T4a
--    сотрудника не назначает. Прежний сотрудник — то, что человек видел на
--    экране (PT409, если уже изменено); один сотрудник — не больше одного
--    действующего пользователя ВАТС (PT409); выключенного в ВАТС пользователя
--    назначить нельзя (PT412), снять сопоставление можно. Прошлые ноги звонков
--    сотрудника не получают: сопоставление действует на звонки, которые придут
--    после него (экран показывает число ног без сотрудника).
-- Журнал: telephony.settings.change и telephony.mapping.change над типом
-- telephony_settings (миграция 291); в состояниях журнала только коды изменённых
-- полей, значения настроек (числа, флаги, префиксы) и идентификаторы, без
-- логина пользователя ВАТС, имён и номеров.
--
-- Замки: SECURITY DEFINER, пустой search_path, EXECUTE только у authenticated;
-- помощники без прав у всех ролей; самопроверка в конце откатывает миграцию,
-- если это не так. Безопасно для production: новые функции и одна замена
-- функции здоровья на тонкую обёртку с тем же ответом; ни таблиц, ни столбцов,
-- ни политик, ни данных миграция не меняет; ни один флаг не включается.
BEGIN;

DO $tel296_preconditions$
BEGIN
  IF to_regclass('platform_private.telephony_settings') IS NULL
    OR to_regclass('platform_private.telephony_runtime_state') IS NULL
    OR to_regclass('platform_private.telephony_extensions') IS NULL
    OR to_regclass('platform_private.telephony_call_legs') IS NULL
    OR to_regclass('platform_private.telephony_calls') IS NULL
    OR to_regclass('platform_private.telephony_event_work') IS NULL
    OR to_regclass('platform_private.telephony_pbx_events') IS NULL
    OR to_regprocedure('platform.telephony_integration_health_v1(uuid)') IS NULL
    OR to_regprocedure('platform_private.telephony_rights_verify()') IS NULL
    OR to_regprocedure('platform_private.staff_can_access(uuid,uuid,text,text,uuid)') IS NULL
    OR to_regprocedure('platform.current_actor_authority()') IS NULL THEN
    RAISE EXCEPTION 'telephony_t4b_requires_t4a' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'platform_private' AND table_name = 'telephony_settings' AND column_name = 'backfill_enabled') THEN
    RAISE EXCEPTION 'telephony_t4b_requires_t4a' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname IN ('telephony_manage_overview_v1', 'telephony_settings_save_v1', 'telephony_extension_map_v1',
        'telephony_manage_actor', 'telephony_settings_json', 'telephony_settings_flat', 'telephony_health_snapshot')
      AND n.nspname IN ('platform', 'platform_private')
  ) THEN
    RAISE EXCEPTION 'telephony_t4b_functions_already_exist' USING ERRCODE = '55000';
  END IF;
END
$tel296_preconditions$;

-- ---------------------------------------------------------------------------
-- Сотрудник текущей сессии с telephony.manage на ресурсе «организация».
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.telephony_manage_actor(p_organization_id UUID)
RETURNS TABLE (membership_id UUID, profile_id UUID, auth_user_id UUID)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN QUERY
  SELECT a.membership_id, a.profile_id, a.auth_user_id
  FROM platform.current_actor_authority() a
  WHERE p_organization_id IS NOT NULL AND a.organization_id = p_organization_id
    AND a.platform_role IS DISTINCT FROM 'student'
    AND platform_private.staff_can_access(a.organization_id, a.membership_id, 'telephony.manage',
      'organization', p_organization_id)
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'telephony_manage_forbidden' USING ERRCODE = '42501';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Настройки организации одним видом (без номеров и текстов).
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.telephony_settings_json(p_settings platform_private.telephony_settings)
RETURNS JSONB LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'version', p_settings.version,
    'updatedAt', p_settings.updated_at,
    'flags', jsonb_build_object(
      'projectionEnabled', p_settings.projection_enabled,
      'uiEnabled', p_settings.ui_enabled,
      'dialEnabled', p_settings.dial_enabled,
      'missedTaskEnabled', p_settings.missed_task_enabled,
      'unknownLeadEnabled', p_settings.unknown_lead_enabled,
      'backfillEnabled', p_settings.backfill_enabled,
      'outboundPaused', p_settings.outbound_paused),
    'hours', jsonb_build_object(
      'timezone', p_settings.timezone,
      'workingDays', to_jsonb(p_settings.working_days),
      'workFrom', to_char(p_settings.work_from, 'HH24:MI'),
      'workTo', to_char(p_settings.work_to, 'HH24:MI'),
      'callbackWorkMinutes', p_settings.callback_work_minutes),
    'escalationMembershipId', p_settings.escalation_membership_id,
    'dial', jsonb_build_object(
      'prefixes', to_jsonb(p_settings.dial_prefixes),
      'limitUserDay', p_settings.limit_user_day,
      'limitUserGapSeconds', p_settings.limit_user_gap_seconds,
      'limitOrgHour', p_settings.limit_org_hour,
      'limitOrgDay', p_settings.limit_org_day),
    'ceilings', jsonb_build_object(
      'leadsHour', p_settings.ceiling_leads_hour,
      'leadsDay', p_settings.ceiling_leads_day,
      'tasksHour', p_settings.ceiling_tasks_hour,
      'tasksDay', p_settings.ceiling_tasks_day))
$$;

-- Те же настройки плоским объектом с именами ключей патча правки: так видно, что
-- изменилось (старое и новое значение по имени), и журнал хранит коды полей.
CREATE FUNCTION platform_private.telephony_settings_flat(p_settings platform_private.telephony_settings)
RETURNS JSONB LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'projectionEnabled', p_settings.projection_enabled,
    'uiEnabled', p_settings.ui_enabled,
    'dialEnabled', p_settings.dial_enabled,
    'missedTaskEnabled', p_settings.missed_task_enabled,
    'unknownLeadEnabled', p_settings.unknown_lead_enabled,
    'backfillEnabled', p_settings.backfill_enabled,
    'outboundPaused', p_settings.outbound_paused,
    'workingDays', to_jsonb(p_settings.working_days),
    'workFrom', to_char(p_settings.work_from, 'HH24:MI'),
    'workTo', to_char(p_settings.work_to, 'HH24:MI'),
    'callbackWorkMinutes', p_settings.callback_work_minutes,
    'escalationMembershipId', p_settings.escalation_membership_id,
    'dialPrefixes', to_jsonb(p_settings.dial_prefixes),
    'limitUserDay', p_settings.limit_user_day,
    'limitUserGapSeconds', p_settings.limit_user_gap_seconds,
    'limitOrgHour', p_settings.limit_org_hour,
    'limitOrgDay', p_settings.limit_org_day,
    'ceilingLeadsHour', p_settings.ceiling_leads_hour,
    'ceilingLeadsDay', p_settings.ceiling_leads_day,
    'ceilingTasksHour', p_settings.ceiling_tasks_hour,
    'ceilingTasksDay', p_settings.ceiling_tasks_day)
$$;

-- ---------------------------------------------------------------------------
-- Здоровье интеграции (тело перенесено из platform.telephony_integration_health_v1,
-- 293, без изменений; проверка роли service_role осталась в публичной функции).
-- Только числа, времена и слова: ни номеров, ни логинов, ни ссылок.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.telephony_health_snapshot(p_organization_id UUID)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_now TIMESTAMPTZ;
  s platform_private.telephony_settings%ROWTYPE;
  rs platform_private.telephony_runtime_state%ROWTYPE;
  v_active INTEGER; v_inactive INTEGER; v_unmapped INTEGER; v_seen TIMESTAMPTZ;
  v_recon INTEGER; v_total INTEGER; v_work JSONB; v_ev_total INTEGER; v_ev_rejected INTEGER; v_ev_incomplete INTEGER;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'telephony_invalid_request' USING ERRCODE = '22023';
  END IF;
  v_now := clock_timestamp();
  SELECT * INTO s FROM platform_private.telephony_settings x WHERE x.organization_id = p_organization_id;
  SELECT * INTO rs FROM platform_private.telephony_runtime_state x WHERE x.organization_id = p_organization_id;
  SELECT count(*) FILTER (WHERE e.active), count(*) FILTER (WHERE NOT e.active),
    count(*) FILTER (WHERE e.active AND e.membership_id IS NULL), max(e.last_seen_in_users_at)
  INTO v_active, v_inactive, v_unmapped, v_seen
  FROM platform_private.telephony_extensions e WHERE e.organization_id = p_organization_id;
  -- Расхождения за сутки: звонки, которых вебхук не принёс и которые создала сверка,
  -- против всех звонков за те же сутки (критерий выхода из фазы 1 — 99 %, §4).
  SELECT count(*) FILTER (WHERE c.created_via = 'reconcile'), count(*)
  INTO v_recon, v_total
  FROM platform_private.telephony_calls c
  WHERE c.organization_id = p_organization_id AND c.created_via IN ('webhook', 'reconcile', 'dial')
    AND c.started_at >= v_now - INTERVAL '24 hours';
  SELECT COALESCE(jsonb_object_agg(w.state, w.n), '{}'::JSONB) INTO v_work
  FROM (SELECT x.state, count(*) AS n FROM platform_private.telephony_event_work x
    WHERE x.organization_id = p_organization_id GROUP BY x.state) w;
  -- Принятые сообщения за сутки: сколько всего, сколько отклонено после проверки
  -- ключа (форма без значений) и сколько неполных (§12, строка «Телефония»).
  SELECT count(*), count(*) FILTER (WHERE e.validation_state = 'rejected'),
    count(*) FILTER (WHERE e.validation_state = 'incomplete')
  INTO v_ev_total, v_ev_rejected, v_ev_incomplete
  FROM platform_private.telephony_pbx_events e
  WHERE e.organization_id = p_organization_id AND e.received_at >= v_now - INTERVAL '24 hours';
  RETURN jsonb_build_object(
    'status', 'ok',
    'now', v_now,
    'flags', jsonb_build_object('projection_enabled', COALESCE(s.projection_enabled, FALSE),
      'outbound_paused', COALESCE(s.outbound_paused, FALSE), 'backfill_enabled', COALESCE(s.backfill_enabled, FALSE)),
    'directory', jsonb_build_object('active', v_active, 'inactive', v_inactive, 'unmapped', v_unmapped,
      'last_seen_at', v_seen),
    'schedule', jsonb_build_object(
      'retry_run_at', rs.retry_run_at, 'settle_run_at', rs.settle_run_at,
      'users_sync_run_at', rs.users_sync_run_at, 'users_sync_success_at', rs.users_sync_success_at,
      'reconcile_run_at', rs.reconcile_run_at, 'reconcile_success_at', rs.reconcile_success_at,
      'reconcile_cursor_at', rs.reconcile_cursor_at,
      'reconcile_lag_seconds', CASE WHEN rs.reconcile_cursor_at IS NULL THEN NULL
        ELSE greatest(0, floor(extract(epoch FROM (v_now - rs.reconcile_cursor_at))))::BIGINT END,
      'reconcile_daily_run_at', rs.reconcile_daily_run_at, 'reconcile_daily_success_at', rs.reconcile_daily_success_at,
      'backfill_run_at', rs.backfill_run_at, 'backfill_cursor_at', rs.backfill_cursor_at,
      'backfill_done_at', rs.backfill_done_at,
      'probe_run_at', rs.probe_run_at, 'probe_success_at', rs.probe_success_at),
    'pbx', jsonb_build_object('last_ok_at', rs.last_pbx_ok_at, 'last_error_at', rs.last_pbx_error_at,
      'last_error_code', rs.last_pbx_error_code, 'facts', rs.pbx_facts),
    'last_event_at', rs.last_event_at,
    'internal_calls_total', COALESCE(rs.internal_calls_total, 0),
    'evidence', jsonb_build_object('window_hours', 24, 'received', COALESCE(v_ev_total, 0),
      'rejected', COALESCE(v_ev_rejected, 0), 'incomplete', COALESCE(v_ev_incomplete, 0)),
    'automation_stop', jsonb_build_object('stopped_at', rs.automation_stopped_at, 'code', rs.automation_stop_code),
    'summaries', COALESCE(rs.mode_summaries, '{}'::JSONB),
    'divergence', jsonb_build_object('window_hours', 24, 'reconciled_calls', COALESCE(v_recon, 0),
      'calls', COALESCE(v_total, 0)),
    'work', v_work
  );
END
$$;

-- Служебная функция здоровья (293): та же подпись, те же права (OR REPLACE их
-- сохраняет), тот же ответ; проверки роли и организации остались здесь.
CREATE OR REPLACE FUNCTION platform.telephony_integration_health_v1(p_organization_id UUID)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role is required' USING ERRCODE = '42501';
  END IF;
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'telephony_invalid_request' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform.organizations o WHERE o.id = p_organization_id) THEN
    RAISE EXCEPTION 'telephony_unknown_organization' USING ERRCODE = '22023';
  END IF;
  RETURN platform_private.telephony_health_snapshot(p_organization_id);
END
$$;

-- ---------------------------------------------------------------------------
-- Экран «Настройки → Телефония»: чтение.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.telephony_manage_overview_v1(p_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor RECORD;
  s platform_private.telephony_settings%ROWTYPE;
  v_extensions JSONB; v_staff JSONB; v_escalation JSONB;
BEGIN
  SELECT * INTO v_actor FROM platform_private.telephony_manage_actor(p_organization_id);
  -- Строка настроек создаётся при первом чтении: все флаги по умолчанию выключены.
  INSERT INTO platform_private.telephony_settings (organization_id) VALUES (p_organization_id)
  ON CONFLICT (organization_id) DO NOTHING;
  SELECT * INTO s FROM platform_private.telephony_settings x WHERE x.organization_id = p_organization_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', e.id, 'login', e.pbx_user, 'extension', e.extension, 'name', e.pbx_display_name,
      'active', e.active, 'membershipId', e.membership_id, 'membershipName', p.display_name,
      'lastSeenAt', e.last_seen_in_users_at,
      'legsWithoutStaff', (SELECT count(*) FROM platform_private.telephony_call_legs l
        WHERE l.organization_id = e.organization_id AND l.membership_id IS NULL
          AND lower(l.pbx_user) = lower(e.pbx_user)))
      ORDER BY e.active DESC, e.extension NULLS LAST, lower(e.pbx_user), e.id), '[]'::JSONB)
  INTO v_extensions
  FROM platform_private.telephony_extensions e
  LEFT JOIN platform.organization_memberships m ON m.organization_id = e.organization_id AND m.id = e.membership_id
  LEFT JOIN platform.profiles p ON p.id = m.profile_id
  WHERE e.organization_id = p_organization_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'membershipId', m.id, 'name', p.display_name,
      'canManage', platform_private.staff_can_access(m.organization_id, m.id, 'telephony.manage',
        'organization', m.organization_id))
      ORDER BY lower(p.display_name), m.id), '[]'::JSONB)
  INTO v_staff
  FROM platform.organization_memberships m
  JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = p_organization_id AND m.status = 'active' AND p.status = 'active'
    AND m."current_role" IS DISTINCT FROM 'student';

  IF s.escalation_membership_id IS NULL THEN
    v_escalation := NULL;
  ELSE
    SELECT jsonb_build_object('membershipId', m.id, 'name', p.display_name,
      'allowed', m.status = 'active' AND p.status = 'active'
        AND platform_private.staff_can_access(m.organization_id, m.id, 'telephony.manage', 'organization', m.organization_id))
    INTO v_escalation
    FROM platform.organization_memberships m
    JOIN platform.profiles p ON p.id = m.profile_id
    WHERE m.organization_id = p_organization_id AND m.id = s.escalation_membership_id;
  END IF;

  RETURN jsonb_build_object(
    'schemaVersion', 1,
    'organizationId', p_organization_id,
    'now', clock_timestamp(),
    'settings', platform_private.telephony_settings_json(s),
    'escalation', v_escalation,
    'health', platform_private.telephony_health_snapshot(p_organization_id),
    'extensions', v_extensions,
    'staff', v_staff);
END
$$;

-- ---------------------------------------------------------------------------
-- Правка настроек одним патчем.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.telephony_settings_save_v1(
  p_organization_id UUID, p_expected_version BIGINT, p_patch JSONB, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor RECORD;
  v_fp TEXT;
  v_prior platform.audit_events%ROWTYPE;
  v_old platform_private.telephony_settings%ROWTYPE;
  v_new platform_private.telephony_settings%ROWTYPE;
  v_receipt JSONB;
  v_changed TEXT[];
  v_before JSONB;
  v_after JSONB;
  v_old_flat JSONB;
  v_new_flat JSONB;
  v_days SMALLINT[];
  v_prefixes TEXT[];
  v_from TIME; v_to TIME;
  v_escalation UUID;
  v_clear_stop BOOLEAN := FALSE;
  v_cleared BOOLEAN := FALSE;
  v_constraint TEXT;
  v_bool_keys CONSTANT TEXT[] := ARRAY['projectionEnabled', 'uiEnabled', 'dialEnabled', 'missedTaskEnabled',
    'unknownLeadEnabled', 'backfillEnabled', 'outboundPaused'];
  v_int_keys CONSTANT TEXT[] := ARRAY['callbackWorkMinutes', 'limitUserDay', 'limitUserGapSeconds', 'limitOrgHour',
    'limitOrgDay', 'ceilingLeadsHour', 'ceilingLeadsDay', 'ceilingTasksHour', 'ceilingTasksDay'];
  v_all_keys CONSTANT TEXT[] := ARRAY['projectionEnabled', 'uiEnabled', 'dialEnabled', 'missedTaskEnabled',
    'unknownLeadEnabled', 'backfillEnabled', 'outboundPaused', 'callbackWorkMinutes', 'limitUserDay',
    'limitUserGapSeconds', 'limitOrgHour', 'limitOrgDay', 'ceilingLeadsHour', 'ceilingLeadsDay', 'ceilingTasksHour',
    'ceilingTasksDay', 'workingDays', 'workFrom', 'workTo', 'escalationMembershipId', 'dialPrefixes'];
BEGIN
  SELECT * INTO v_actor FROM platform_private.telephony_manage_actor(p_organization_id);
  IF p_request_id IS NULL OR p_expected_version IS NULL OR p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object'
    OR p_patch = '{}'::JSONB THEN
    RAISE EXCEPTION 'telephony_settings_invalid' USING ERRCODE = '22023';
  END IF;
  -- Только известные ключи нужных видов; ничего не приводится, пока вид не проверен.
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_patch) k WHERE k <> ALL (v_all_keys))
    OR EXISTS (SELECT 1 FROM jsonb_each(p_patch) e WHERE e.key = ANY (v_bool_keys) AND jsonb_typeof(e.value) <> 'boolean')
    OR EXISTS (SELECT 1 FROM jsonb_each(p_patch) e WHERE e.key = ANY (v_int_keys)
      AND (jsonb_typeof(e.value) <> 'number' OR (e.value #>> '{}') !~ '^[0-9]{1,5}$'))
    OR (p_patch ? 'workingDays' AND (jsonb_typeof(p_patch -> 'workingDays') <> 'array'
      OR jsonb_array_length(p_patch -> 'workingDays') NOT BETWEEN 1 AND 14
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_patch -> 'workingDays') d
        WHERE jsonb_typeof(d) <> 'number' OR (d #>> '{}') !~ '^[1-7]$')))
    OR (p_patch ? 'dialPrefixes' AND (jsonb_typeof(p_patch -> 'dialPrefixes') <> 'array'
      OR jsonb_array_length(p_patch -> 'dialPrefixes') NOT BETWEEN 1 AND 40
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_patch -> 'dialPrefixes') d
        WHERE jsonb_typeof(d) <> 'string' OR (d #>> '{}') !~ '^\+[1-9][0-9]{0,3}$')))
    OR (p_patch ? 'workFrom' AND (jsonb_typeof(p_patch -> 'workFrom') <> 'string'
      OR (p_patch ->> 'workFrom') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'))
    OR (p_patch ? 'workTo' AND (jsonb_typeof(p_patch -> 'workTo') <> 'string'
      OR (p_patch ->> 'workTo') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'))
    OR (p_patch ? 'escalationMembershipId' AND jsonb_typeof(p_patch -> 'escalationMembershipId') <> 'null'
      AND (jsonb_typeof(p_patch -> 'escalationMembershipId') <> 'string'
        OR (p_patch ->> 'escalationMembershipId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) THEN
    RAISE EXCEPTION 'telephony_settings_invalid' USING ERRCODE = '22023';
  END IF;

  v_fp := encode(sha256(convert_to(jsonb_build_object('expectedVersion', p_expected_version,
    'patch', p_patch)::TEXT, 'UTF8')), 'hex');
  -- Замок организации берётся до поиска повтора: второй такой же запрос (двойное
  -- нажатие, повтор после обрыва) ждёт первого и находит его квитанцию, а не
  -- упирается в сдвинувшуюся версию.
  PERFORM pg_advisory_xact_lock(hashtextextended('telephony_settings:' || p_organization_id::TEXT, 296));
  -- Повтор того же запроса: прежняя квитанция. Тот же id с другим вводом или
  -- от другого человека — конфликт.
  SELECT * INTO v_prior FROM platform.audit_events e WHERE e.request_id = p_request_id;
  IF FOUND THEN
    IF v_prior.organization_id = p_organization_id AND v_prior.action = 'telephony.settings.change'
      AND v_prior.actor_profile_id = v_actor.profile_id AND v_prior.after_state ->> 'fingerprint' = v_fp THEN
      RETURN (v_prior.after_state - 'fingerprint' - 'values') || jsonb_build_object('replayed', TRUE);
    END IF;
    RAISE EXCEPTION 'telephony_request_conflict' USING ERRCODE = '23505';
  END IF;

  INSERT INTO platform_private.telephony_settings (organization_id) VALUES (p_organization_id)
  ON CONFLICT (organization_id) DO NOTHING;
  SELECT * INTO v_old FROM platform_private.telephony_settings x
  WHERE x.organization_id = p_organization_id FOR UPDATE;
  IF p_expected_version IS DISTINCT FROM v_old.version THEN
    RAISE EXCEPTION 'telephony_settings_version_conflict' USING ERRCODE = 'PT409';
  END IF;

  IF p_patch ? 'workingDays' THEN
    SELECT array_agg(DISTINCT (d #>> '{}')::SMALLINT ORDER BY (d #>> '{}')::SMALLINT) INTO v_days
    FROM jsonb_array_elements(p_patch -> 'workingDays') d;
  END IF;
  IF p_patch ? 'dialPrefixes' THEN
    SELECT array_agg(DISTINCT (d #>> '{}') COLLATE "C" ORDER BY (d #>> '{}') COLLATE "C") INTO v_prefixes
    FROM jsonb_array_elements(p_patch -> 'dialPrefixes') d;
    -- Повтор значения в списке не ошибка пользователя: он схлопывается.
  END IF;
  v_from := CASE WHEN p_patch ? 'workFrom' THEN (p_patch ->> 'workFrom')::TIME ELSE v_old.work_from END;
  v_to := CASE WHEN p_patch ? 'workTo' THEN (p_patch ->> 'workTo')::TIME ELSE v_old.work_to END;
  v_escalation := CASE WHEN NOT (p_patch ? 'escalationMembershipId') THEN v_old.escalation_membership_id
    WHEN jsonb_typeof(p_patch -> 'escalationMembershipId') = 'null' THEN NULL
    ELSE (p_patch ->> 'escalationMembershipId')::UUID END;

  -- Получатель эскалаций: активный сотрудник организации, у которого действует
  -- telephony.manage (админ или держатель роли «Телефония — руководитель»;
  -- PLAN_CHANGES T2, пункт 6). Проверяется только при смене значения: уже
  -- стоящий получатель, потерявший право, не мешает правке других полей.
  IF v_escalation IS NOT NULL AND v_escalation IS DISTINCT FROM v_old.escalation_membership_id THEN
    IF NOT EXISTS (
      SELECT 1 FROM platform.organization_memberships m
      JOIN platform.profiles p ON p.id = m.profile_id
      WHERE m.organization_id = p_organization_id AND m.id = v_escalation
        AND m.status = 'active' AND p.status = 'active' AND m."current_role" IS DISTINCT FROM 'student'
        AND platform_private.staff_can_access(m.organization_id, m.id, 'telephony.manage',
          'organization', m.organization_id)
    ) THEN
      RAISE EXCEPTION 'telephony_escalation_invalid' USING ERRCODE = '22023';
    END IF;
  END IF;

  v_new := v_old;
  v_new.projection_enabled := COALESCE((p_patch ->> 'projectionEnabled')::BOOLEAN, v_old.projection_enabled);
  v_new.ui_enabled := COALESCE((p_patch ->> 'uiEnabled')::BOOLEAN, v_old.ui_enabled);
  v_new.dial_enabled := COALESCE((p_patch ->> 'dialEnabled')::BOOLEAN, v_old.dial_enabled);
  v_new.missed_task_enabled := COALESCE((p_patch ->> 'missedTaskEnabled')::BOOLEAN, v_old.missed_task_enabled);
  v_new.unknown_lead_enabled := COALESCE((p_patch ->> 'unknownLeadEnabled')::BOOLEAN, v_old.unknown_lead_enabled);
  v_new.backfill_enabled := COALESCE((p_patch ->> 'backfillEnabled')::BOOLEAN, v_old.backfill_enabled);
  v_new.outbound_paused := COALESCE((p_patch ->> 'outboundPaused')::BOOLEAN, v_old.outbound_paused);
  v_new.working_days := COALESCE(v_days, v_old.working_days);
  v_new.work_from := v_from;
  v_new.work_to := v_to;
  v_new.callback_work_minutes := COALESCE((p_patch ->> 'callbackWorkMinutes')::INTEGER, v_old.callback_work_minutes);
  v_new.escalation_membership_id := v_escalation;
  v_new.dial_prefixes := COALESCE(v_prefixes, v_old.dial_prefixes);
  v_new.limit_user_day := COALESCE((p_patch ->> 'limitUserDay')::INTEGER, v_old.limit_user_day);
  v_new.limit_user_gap_seconds := COALESCE((p_patch ->> 'limitUserGapSeconds')::INTEGER, v_old.limit_user_gap_seconds);
  v_new.limit_org_hour := COALESCE((p_patch ->> 'limitOrgHour')::INTEGER, v_old.limit_org_hour);
  v_new.limit_org_day := COALESCE((p_patch ->> 'limitOrgDay')::INTEGER, v_old.limit_org_day);
  v_new.ceiling_leads_hour := COALESCE((p_patch ->> 'ceilingLeadsHour')::INTEGER, v_old.ceiling_leads_hour);
  v_new.ceiling_leads_day := COALESCE((p_patch ->> 'ceilingLeadsDay')::INTEGER, v_old.ceiling_leads_day);
  v_new.ceiling_tasks_hour := COALESCE((p_patch ->> 'ceilingTasksHour')::INTEGER, v_old.ceiling_tasks_hour);
  v_new.ceiling_tasks_day := COALESCE((p_patch ->> 'ceilingTasksDay')::INTEGER, v_old.ceiling_tasks_day);

  -- Автоматика и первичный импорт работают только поверх разбора звонков.
  IF (v_new.missed_task_enabled OR v_new.unknown_lead_enabled OR v_new.backfill_enabled)
    AND NOT v_new.projection_enabled THEN
    RAISE EXCEPTION 'telephony_projection_required' USING ERRCODE = 'PT412';
  END IF;

  -- Что действительно изменилось (по именам патча).
  v_old_flat := platform_private.telephony_settings_flat(v_old);
  v_new_flat := platform_private.telephony_settings_flat(v_new);
  SELECT COALESCE(array_agg(k.key ORDER BY k.key COLLATE "C"), '{}'::TEXT[]),
    COALESCE(jsonb_object_agg(k.key, v_old_flat -> k.key), '{}'::JSONB),
    COALESCE(jsonb_object_agg(k.key, v_new_flat -> k.key), '{}'::JSONB)
  INTO v_changed, v_before, v_after
  FROM jsonb_object_keys(v_new_flat) AS k(key)
  WHERE v_old_flat -> k.key IS DISTINCT FROM v_new_flat -> k.key;

  -- Ничего не изменилось: версия и журнал не двигаются.
  IF cardinality(v_changed) = 0 THEN
    RETURN jsonb_build_object('status', 'unchanged', 'version', v_old.version, 'changed', '[]'::JSONB,
      'settings', platform_private.telephony_settings_json(v_old), 'replayed', FALSE);
  END IF;

  BEGIN
    UPDATE platform_private.telephony_settings x SET
      projection_enabled = v_new.projection_enabled, ui_enabled = v_new.ui_enabled,
      dial_enabled = v_new.dial_enabled, missed_task_enabled = v_new.missed_task_enabled,
      unknown_lead_enabled = v_new.unknown_lead_enabled, backfill_enabled = v_new.backfill_enabled,
      outbound_paused = v_new.outbound_paused, working_days = v_new.working_days,
      work_from = v_new.work_from, work_to = v_new.work_to, callback_work_minutes = v_new.callback_work_minutes,
      escalation_membership_id = v_new.escalation_membership_id, dial_prefixes = v_new.dial_prefixes,
      limit_user_day = v_new.limit_user_day, limit_user_gap_seconds = v_new.limit_user_gap_seconds,
      limit_org_hour = v_new.limit_org_hour, limit_org_day = v_new.limit_org_day,
      ceiling_leads_hour = v_new.ceiling_leads_hour, ceiling_leads_day = v_new.ceiling_leads_day,
      ceiling_tasks_hour = v_new.ceiling_tasks_hour, ceiling_tasks_day = v_new.ceiling_tasks_day,
      version = x.version + 1, updated_at = statement_timestamp(), updated_by_membership_id = v_actor.membership_id
    WHERE x.organization_id = p_organization_id
    RETURNING * INTO v_new;
  EXCEPTION WHEN check_violation THEN
    -- Наружу только имя ограничения: значения строки в DETAIL ошибки не идут.
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    RAISE EXCEPTION 'telephony_settings_invalid' USING ERRCODE = '22023',
      DETAIL = COALESCE(v_constraint, 'check');
  END;

  -- Автоматику, остановленную потолком, снова включает админ после проверки:
  -- включение флага автоматики снимает отметку остановки.
  v_clear_stop := (v_new.missed_task_enabled AND NOT v_old.missed_task_enabled)
    OR (v_new.unknown_lead_enabled AND NOT v_old.unknown_lead_enabled);
  IF v_clear_stop THEN
    UPDATE platform_private.telephony_runtime_state r SET automation_stopped_at = NULL, automation_stop_code = NULL,
      updated_at = statement_timestamp()
    WHERE r.organization_id = p_organization_id AND r.automation_stopped_at IS NOT NULL;
    v_cleared := FOUND;
  END IF;

  v_receipt := jsonb_build_object('status', 'saved', 'version', v_new.version, 'changed', to_jsonb(v_changed),
    'automationStopCleared', v_cleared, 'settings', platform_private.telephony_settings_json(v_new));
  INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal, action,
    resource_type, resource_id, before_state, after_state, reason, request_id)
  VALUES (p_organization_id, 'user', v_actor.profile_id, 'auth:' || v_actor.auth_user_id::TEXT,
    'telephony.settings.change', 'telephony_settings', p_organization_id,
    jsonb_build_object('version', v_old.version, 'values', v_before),
    jsonb_build_object('status', 'saved', 'version', v_new.version, 'changed', to_jsonb(v_changed),
      'values', v_after, 'automationStopCleared', v_cleared, 'settings', platform_private.telephony_settings_json(v_new),
      'fingerprint', v_fp),
    'Телефония: настройки изменены', p_request_id);
  RETURN v_receipt || jsonb_build_object('replayed', FALSE);
END
$$;

-- ---------------------------------------------------------------------------
-- Сопоставление пользователя ВАТС и сотрудника EVO.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.telephony_extension_map_v1(
  p_organization_id UUID, p_extension_id UUID, p_previous_membership_id UUID,
  p_membership_id UUID, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor RECORD;
  v_fp TEXT;
  v_prior platform.audit_events%ROWTYPE;
  v_ext platform_private.telephony_extensions%ROWTYPE;
  v_unmapped INTEGER;
  v_receipt JSONB;
BEGIN
  SELECT * INTO v_actor FROM platform_private.telephony_manage_actor(p_organization_id);
  IF p_extension_id IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'telephony_mapping_invalid' USING ERRCODE = '22023';
  END IF;
  v_fp := encode(sha256(convert_to(jsonb_build_object('extensionId', p_extension_id,
    'previous', p_previous_membership_id, 'membershipId', p_membership_id)::TEXT, 'UTF8')), 'hex');
  -- Замок до поиска повтора, как в сохранении настроек.
  PERFORM pg_advisory_xact_lock(hashtextextended('telephony_mapping:' || p_organization_id::TEXT, 296));
  SELECT * INTO v_prior FROM platform.audit_events e WHERE e.request_id = p_request_id;
  IF FOUND THEN
    IF v_prior.organization_id = p_organization_id AND v_prior.action = 'telephony.mapping.change'
      AND v_prior.actor_profile_id = v_actor.profile_id AND v_prior.after_state ->> 'fingerprint' = v_fp THEN
      RETURN (v_prior.after_state - 'fingerprint') || jsonb_build_object('replayed', TRUE);
    END IF;
    RAISE EXCEPTION 'telephony_request_conflict' USING ERRCODE = '23505';
  END IF;

  SELECT * INTO v_ext FROM platform_private.telephony_extensions x
  WHERE x.organization_id = p_organization_id AND x.id = p_extension_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'telephony_extension_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Человек подтверждает то, что видел: если сопоставление уже изменили — PT409.
  IF v_ext.membership_id IS DISTINCT FROM p_previous_membership_id THEN
    RAISE EXCEPTION 'telephony_mapping_changed' USING ERRCODE = 'PT409';
  END IF;
  IF v_ext.membership_id IS NOT DISTINCT FROM p_membership_id THEN
    SELECT count(*) INTO v_unmapped FROM platform_private.telephony_extensions x
    WHERE x.organization_id = p_organization_id AND x.active AND x.membership_id IS NULL;
    RETURN jsonb_build_object('status', 'unchanged', 'extensionId', p_extension_id,
      'membershipId', v_ext.membership_id, 'unmapped', v_unmapped, 'replayed', FALSE);
  END IF;

  IF p_membership_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM platform.organization_memberships m
      JOIN platform.profiles p ON p.id = m.profile_id
      WHERE m.organization_id = p_organization_id AND m.id = p_membership_id
        AND m.status = 'active' AND p.status = 'active' AND m."current_role" IS DISTINCT FROM 'student'
    ) THEN
      RAISE EXCEPTION 'telephony_membership_invalid' USING ERRCODE = '22023';
    END IF;
    IF NOT v_ext.active THEN
      RAISE EXCEPTION 'telephony_extension_inactive' USING ERRCODE = 'PT412';
    END IF;
    IF EXISTS (SELECT 1 FROM platform_private.telephony_extensions x
      WHERE x.organization_id = p_organization_id AND x.active AND x.membership_id = p_membership_id
        AND x.id <> p_extension_id) THEN
      RAISE EXCEPTION 'telephony_membership_taken' USING ERRCODE = 'PT409';
    END IF;
  END IF;

  UPDATE platform_private.telephony_extensions x SET membership_id = p_membership_id,
    updated_at = statement_timestamp()
  WHERE x.organization_id = p_organization_id AND x.id = p_extension_id;
  SELECT count(*) INTO v_unmapped FROM platform_private.telephony_extensions x
  WHERE x.organization_id = p_organization_id AND x.active AND x.membership_id IS NULL;
  v_receipt := jsonb_build_object('status', 'saved', 'extensionId', p_extension_id,
    'membershipId', p_membership_id, 'unmapped', v_unmapped);
  INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal, action,
    resource_type, resource_id, before_state, after_state, reason, request_id)
  VALUES (p_organization_id, 'user', v_actor.profile_id, 'auth:' || v_actor.auth_user_id::TEXT,
    'telephony.mapping.change', 'telephony_settings', p_organization_id,
    jsonb_build_object('extensionId', p_extension_id, 'membershipId', v_ext.membership_id),
    v_receipt || jsonb_build_object('fingerprint', v_fp),
    'Телефония: сопоставление пользователя ВАТС изменено', p_request_id);
  RETURN v_receipt || jsonb_build_object('replayed', FALSE);
END
$$;

-- ---------------------------------------------------------------------------
-- Права: помощники без грантов; публичные функции для сотрудника — только
-- authenticated (право telephony.manage каждая проверяет внутри); служебная
-- функция здоровья (293) остаётся только у service_role.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  platform_private.telephony_manage_actor(UUID),
  platform_private.telephony_settings_json(platform_private.telephony_settings),
  platform_private.telephony_settings_flat(platform_private.telephony_settings),
  platform_private.telephony_health_snapshot(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;

REVOKE ALL ON FUNCTION
  platform.telephony_manage_overview_v1(UUID),
  platform.telephony_settings_save_v1(UUID, BIGINT, JSONB, UUID),
  platform.telephony_extension_map_v1(UUID, UUID, UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
GRANT EXECUTE ON FUNCTION
  platform.telephony_manage_overview_v1(UUID),
  platform.telephony_settings_save_v1(UUID, BIGINT, JSONB, UUID),
  platform.telephony_extension_map_v1(UUID, UUID, UUID, UUID, UUID)
  TO authenticated;

COMMENT ON FUNCTION platform.telephony_manage_overview_v1(UUID) IS
  'Telephony T4b: telephony.manage holder reads the settings screen (settings, health, PBX users, staff to choose from). Creates the default OFF settings row on first read.';
COMMENT ON FUNCTION platform.telephony_settings_save_v1(UUID, BIGINT, JSONB, UUID) IS
  'Telephony T4b: telephony.manage holder changes settings by one versioned patch (PT409 on a stale version, idempotent by request id). Automation and import need projection (PT412); enabling automation clears the ceiling stop mark.';
COMMENT ON FUNCTION platform.telephony_extension_map_v1(UUID, UUID, UUID, UUID, UUID) IS
  'Telephony T4b: telephony.manage holder confirms the PBX user to EVO staff mapping (the T4a sync never assigns). One staff member per active PBX user; past legs are not reassigned.';

-- Самопроверка: публичные функции — definer, пустой search_path, EXECUTE только
-- у authenticated; служебная функция здоровья — только у service_role; помощники
-- закрыты всем ролям.
DO $tel296_verify$
DECLARE f REGPROCEDURE; p pg_catalog.pg_proc%ROWTYPE;
BEGIN
  FOR f IN SELECT x.oid::REGPROCEDURE FROM pg_catalog.pg_proc x
    JOIN pg_catalog.pg_namespace n ON n.oid = x.pronamespace
    WHERE n.nspname = 'platform' AND x.proname IN ('telephony_manage_overview_v1', 'telephony_settings_save_v1',
      'telephony_extension_map_v1') LOOP
    SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid = f;
    IF NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
      OR NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      OR has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('service_role', p.oid, 'EXECUTE')
      OR has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
      OR has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')
      OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) THEN
      RAISE EXCEPTION 'telephony_t4b_public_function_posture: %', f USING ERRCODE = '55000';
    END IF;
  END LOOP;
  SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid = 'platform.telephony_integration_health_v1(uuid)'::REGPROCEDURE;
  IF NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
    OR NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
    OR has_function_privilege('anon', p.oid, 'EXECUTE')
    OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
    OR has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
    OR has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')
    OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) THEN
    RAISE EXCEPTION 'telephony_t4b_health_function_posture' USING ERRCODE = '55000';
  END IF;
  FOR f IN SELECT x.oid::REGPROCEDURE FROM pg_catalog.pg_proc x
    JOIN pg_catalog.pg_namespace n ON n.oid = x.pronamespace
    WHERE n.nspname = 'platform_private' AND x.proname IN ('telephony_manage_actor', 'telephony_settings_json',
      'telephony_settings_flat', 'telephony_health_snapshot') LOOP
    SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid = f;
    IF has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
      OR has_function_privilege('service_role', p.oid, 'EXECUTE')
      OR has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
      OR has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')
      OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[] THEN
      RAISE EXCEPTION 'telephony_t4b_private_function_posture: %', f USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$tel296_verify$;

COMMIT;
