-- 311: след «Подключение WhatsApp» в журнале платформы (решение владельца 20.10.2026:
-- «Do this task here»). docs/PLAN_CHANGES.md «2026-10-20 · «Подключение WhatsApp» пишет
-- в журнал платформы (миграция 311)».
--
-- Forward-only и аддитивно: одна клиентская функция и две подписи в allowlist журнала;
-- ни таблица, ни существующая функция, ни чьи-то права не меняются. SECURITY DEFINER,
-- пустой search_path, EXECUTE только `authenticated`, функция живёт в `platform`
-- (шаблон 292 и 296).
--
-- Зачем. Блок «Настройки → Интеграции → Подключение WhatsApp» (#1275) на каждое нажатие
-- «Подключить» и «Получить код» пишет только строку журнала приложения
-- `whatsapp_connect_audit`: она пропадает при ротации логов и не видна в «Журнале
-- действий». `platform.audit_events` принимает записи только из функций базы, а выпуск
-- приложения миграций не применяет, поэтому нужна эта миграция.
--
--  a) `platform.record_whatsapp_connect_v1(p_kind)`: `qr` («Подключить», показ QR) или
--     `pairing_code` («Получить код по номеру»). Личность - из токена сессии
--     (`current_actor_authority`: подпись, организация и членство совпадают с claims
--     `platform_organization_id` и `platform_membership_id`), роль - действующий
--     системный Admin этой организации (`staff_membership_identity`, `system_role =
--     'admin'`): так же, как у «Подключить» в приложении. Всё остальное - студент,
--     Sales, куратор, сотрудник без роли, чужая организация, сессия без членства,
--     anon - получает 42501 (`whatsapp_connect_forbidden`) до проверки вида. Любой
--     другой вид у Admin - 22023 (`whatsapp_connect_kind_invalid`).
--  b) Запись. Ровно одна строка `platform.audit_events` на вызов: действие
--     `whatsapp.connect.qr` или `whatsapp.connect.code` (вид в имени, потому что
--     безопасная строка журнала значений состояния не несёт), объект `organization`
--     (WhatsApp-сессия одна на организацию; тип объекта уже в allowlist), актор - сам
--     Admin (профиль, членство, `auth:<uid>`), `after_state` - только `{"kind": ...}`.
--     Номер телефона, QR, код сопряжения и любые данные WAHA в функцию не передаются
--     и не хранятся: у неё один параметр. Повтор вызова - ещё одна строка (каждое
--     нажатие - отдельный след); идентификатор запроса создаёт сама функция.
--     Расписка - вид и время зафиксированной строки, а не эхо входа.
--  c) «Журнал действий». `p7a_safe_audit_actions()` получает оба действия приёмом
--     rename-and-union (255, 291, 302). Остальные функции проекции не трогаются:
--     `p7a_safe_audit_resource_types()` уже содержит `organization`, а
--     `p7a_changed_field_codes()` отдаёт для новых действий ветку по умолчанию
--     `['record_status']`, как у 291 и 302. Приложение показывает их словами
--     («Запрошен QR для подключения WhatsApp», «Запрошен код для подключения
--     WhatsApp»).
--
-- Порядок выката. Приложение, которое не знает новых действий, показывает такую строку
-- журнала как нераспознанную (`recognized: false`), а не роняет страницу; поэтому
-- миграция может идти до приложения. Приложение без миграции получает от вызова
-- ошибку и по-прежнему пишет строку журнала приложения.
BEGIN;

-- ---------------------------------------------------------------------------
-- Якоря: объекты, на которые опирается функция, и свободные имена.
-- ---------------------------------------------------------------------------
DO $a311_anchor$
BEGIN
  IF to_regclass('platform.audit_events') IS NULL
    OR to_regprocedure('platform.current_actor_authority()') IS NULL
    OR to_regprocedure('platform_private.staff_membership_identity(uuid,uuid)') IS NULL
    OR to_regprocedure('platform_private.p7a_safe_audit_actions()') IS NULL
    OR to_regprocedure('platform_private.p7a_safe_audit_resource_types()') IS NULL
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'platform' AND c.table_name = 'audit_events' AND c.column_name = 'actor_membership_id')
    OR NOT ('organization' = ANY (platform_private.p7a_safe_audit_resource_types()))
  THEN
    RAISE EXCEPTION 'a311_anchor_drift';
  END IF;
  IF to_regprocedure('platform.record_whatsapp_connect_v1(text)') IS NOT NULL
    OR to_regprocedure('platform_private.p7a_safe_audit_actions_pre_whatsapp_connect_audit()') IS NOT NULL
    OR 'whatsapp.connect.qr' = ANY (platform_private.p7a_safe_audit_actions())
    OR 'whatsapp.connect.code' = ANY (platform_private.p7a_safe_audit_actions())
  THEN
    RAISE EXCEPTION 'a311_already_applied' USING ERRCODE = '55000';
  END IF;
END
$a311_anchor$;

-- ---------------------------------------------------------------------------
-- a) + b) platform.record_whatsapp_connect_v1
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.record_whatsapp_connect_v1(p_kind TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  recorded_at TIMESTAMPTZ;
BEGIN
  -- Кто звонит: действующий системный Admin организации из токена этой сессии.
  SELECT a.auth_user_id, a.profile_id, a.membership_id, a.organization_id INTO actor
  FROM platform.current_actor_authority() AS a
  JOIN platform_private.staff_membership_identity(a.organization_id, a.membership_id) AS i ON TRUE
  WHERE i.system_role = 'admin'
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp_connect_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('qr', 'pairing_code') THEN
    RAISE EXCEPTION 'whatsapp_connect_kind_invalid' USING ERRCODE = '22023';
  END IF;

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_membership_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state, reason, request_id
  ) VALUES (
    actor.organization_id, 'user', actor.profile_id, actor.membership_id,
    'auth:' || actor.auth_user_id::TEXT,
    CASE p_kind WHEN 'qr' THEN 'whatsapp.connect.qr' ELSE 'whatsapp.connect.code' END,
    'organization', actor.organization_id, NULL,
    jsonb_build_object('kind', p_kind),
    CASE p_kind WHEN 'qr' THEN 'WhatsApp connection: QR requested' ELSE 'WhatsApp connection: pairing code requested' END,
    gen_random_uuid()
  ) RETURNING created_at INTO recorded_at;

  RETURN jsonb_build_object('kind', p_kind, 'recorded_at', recorded_at);
END
$$;

REVOKE ALL ON FUNCTION platform.record_whatsapp_connect_v1(TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
GRANT EXECUTE ON FUNCTION platform.record_whatsapp_connect_v1(TEXT) TO authenticated;
COMMENT ON FUNCTION platform.record_whatsapp_connect_v1(TEXT) IS
  'Migration 311: the active system Admin of the session''s organization leaves one audit_events row per «Подключение WhatsApp» request: p_kind qr (whatsapp.connect.qr) or pairing_code (whatsapp.connect.code), object organization, after_state {kind} only. No phone number, QR or pairing code is accepted or stored. Anyone else: 42501; another kind: 22023.';

-- ---------------------------------------------------------------------------
-- c) «Журнал действий»: оба действия в allowlist (rename-and-union)
-- ---------------------------------------------------------------------------
ALTER FUNCTION platform_private.p7a_safe_audit_actions()
  RENAME TO p7a_safe_audit_actions_pre_whatsapp_connect_audit;
CREATE FUNCTION platform_private.p7a_safe_audit_actions()
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.array_agg(DISTINCT allowed.action ORDER BY allowed.action)
  FROM pg_catalog.unnest(
    platform_private.p7a_safe_audit_actions_pre_whatsapp_connect_audit()
      || ARRAY[
    'whatsapp.connect.code',
    'whatsapp.connect.qr'
      ]::TEXT[]
  ) AS allowed(action)
$$;

REVOKE ALL ON FUNCTION
  platform_private.p7a_safe_audit_actions_pre_whatsapp_connect_audit(),
  platform_private.p7a_safe_audit_actions()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- Проверка в конце: действия в allowlist, прежний список цел, права функции и
-- её форма (definer, пустой search_path), закрытые обёртки.
-- ---------------------------------------------------------------------------
DO $a311_verify$
DECLARE
  f pg_catalog.pg_proc%ROWTYPE;
BEGIN
  IF NOT ('whatsapp.connect.qr' = ANY (platform_private.p7a_safe_audit_actions()))
    OR NOT ('whatsapp.connect.code' = ANY (platform_private.p7a_safe_audit_actions()))
    OR 'whatsapp.connect.qr' = ANY (platform_private.p7a_safe_audit_actions_pre_whatsapp_connect_audit())
    OR 'whatsapp.connect.code' = ANY (platform_private.p7a_safe_audit_actions_pre_whatsapp_connect_audit())
    OR NOT ('case.direction.set' = ANY (platform_private.p7a_safe_audit_actions()))
    OR cardinality(platform_private.p7a_safe_audit_actions())
      <> cardinality(platform_private.p7a_safe_audit_actions_pre_whatsapp_connect_audit()) + 2
  THEN
    RAISE EXCEPTION 'a311_verify_allowlist' USING ERRCODE = '55000';
  END IF;

  SELECT p.* INTO f FROM pg_catalog.pg_proc p
  WHERE p.oid = 'platform.record_whatsapp_connect_v1(text)'::regprocedure;
  IF NOT f.prosecdef OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
    OR NOT has_function_privilege('authenticated', f.oid, 'EXECUTE')
    OR has_function_privilege('anon', f.oid, 'EXECUTE')
    OR has_function_privilege('service_role', f.oid, 'EXECUTE')
    OR has_function_privilege('supabase_auth_admin', f.oid, 'EXECUTE')
    OR has_function_privilege('evo_ai_agent', f.oid, 'EXECUTE')
    OR has_function_privilege('anon',
      'platform_private.p7a_safe_audit_actions()'::regprocedure, 'EXECUTE')
    OR has_function_privilege('authenticated',
      'platform_private.p7a_safe_audit_actions()'::regprocedure, 'EXECUTE')
  THEN
    RAISE EXCEPTION 'a311_verify_function' USING ERRCODE = '55000';
  END IF;
END
$a311_verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
