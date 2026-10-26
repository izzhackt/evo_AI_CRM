-- 323: «Отчёты Looker Studio»: хранение двух ссылок организации — отчёт «Маркетинга» и отчёт «Финансов»
-- (решения владельца 26.10.2026: «Да, Looker Studio» для отчётов; финансы из Google Таблицы финансиста; маркетинг
-- через Windsor.ai; «Финансы» видят «Админы + бухгалтер»; «Маркетинг — как сейчас». Контракт среза —
-- docs/EVO_LOOKER_REPORTS_PLAN_2026-10-27.md §4; docs/PLAN_CHANGES.md «2026-10-27 · Отчёты Looker Studio:
-- реализация (миграция 323)»). Хуки набора в `scripts/test-postgres-authorization.sh` привязаны к имени файла, не к
-- номеру: при сдвиге порядка слияний файл перенумеровывается вместе с `a323_*` и маркером набора.
--
-- Зачем. CRM не строит графики сама: она показывает готовый отчёт Looker Studio во встроенном окне. Какой именно
-- отчёт, решает администратор в «Настройки → Отчёты». Хранится не адрес, а ИДЕНТИФИКАТОРЫ отчёта и страницы
-- (адрес встраивания CRM всегда собирает сама по шаблону), поэтому сохранить произвольный адрес нельзя ни через
-- форму, ни прямым вызовом функции. Looker Studio к базе CRM НЕ подключается: эта миграция не открывает ни одной
-- таблицы наружу и не отдаёт Google ничего.
--
-- Forward-only, ничего не удаляет и не меняет: одна приватная таблица, две функции схемы `platform` для
-- authenticated, действие журнала `report.link.change` (приём rename-and-union, как 255/291/311/315/317/320;
-- тип объекта `organization` в списке уже есть). Повторный запуск: a323_already_applied (55000).
--
--   platform_private.organization_report_links(organization_id, report_key, report_id, page_id, version,
--     updated_at, updated_by_membership_id)  PK (organization_id, report_key); report_key только
--     'marketing' | 'finance'; report_id NULL = отчёт не подключён; page_id только вместе с report_id;
--     идентификаторы проверяются CHECK теми же правилами, что функция правки. RLS включена и принудительна,
--     права отозваны у всех клиентских ролей: читает и пишет только определитель двух функций ниже.
--
--   platform.organization_report_link_v1(организация, ключ отчёта) -> JSONB   STABLE, ничего не пишет
--     «marketing» читает только системный Admin организации (положительная проверка, как
--     `marketing_admin_actor`, 265); «finance» читает Admin ИЛИ сотрудник, у которого право
--     `finance.read.full` действует на ВСЮ организацию (назначение роли с областью `organization`): `own`,
--     `department`, `direction` и `record` отказ. Проверка — своя закрытая функция
--     `platform_private.report_link_finance_org_access`, а не `staff_can_access(.., 'organization', org)` из
--     `staff_monthly_payment_summary_access` (156): у `finance.read.full` в `staff_resource_kinds` нет вида
--     `organization` ({student_case, finance_record}), поэтому `staff_can_access` с этим видом отвечает FALSE
--     всем, в том числе системному Admin (проверено на цепочке 001..322; это прежнее поведение 156, здесь оно не
--     меняется). Наша функция повторяет ветку области `organization` матчера 155 (`staff_context_can_access`),
--     не зависит от списка видов и читается и страницей, и меню.
--     Ответ: schemaVersion, organizationId, reportKey, configured, reportId, pageId, version, updatedAt.
--     Строки ещё нет: configured false, reportId/pageId null, version 0 («строки не было»). Имени того, кто
--     менял, в ответе нет: журнал читает только Admin.
--
--   platform.organization_report_link_save_v1(организация, ключ, ожидаемая версия, report_id, page_id, id запроса)
--     -> JSONB   VOLATILE; только системный Admin (бухгалтер ссылку не меняет). Замок организации, затем
--     повтор по id запроса (тот же ввод того же человека — прежняя квитанция `replayed: true`; иной ввод или
--     иной человек — 23505), затем строка под замком: нет строки = версия 0, чужая версия — PT409. Тот же ввод
--     — `unchanged` без новой версии и без записи журнала. Иначе INSERT с версией 1 или UPDATE с версией + 1.
--     report_id NULL — «убрать отчёт» (строка остаётся, configured false). Журнал: `report.link.change`,
--     объект `organization`.
--   Ошибки: 42501 — не тот человек, организация NULL или чужая; 22023 — неизвестный ключ, плохой
--   идентификатор, версия или id запроса; PT409 — версия строки не та; 23505 — id запроса уже занят иным вводом.
--
-- Режим просмотра роли («Admin смотрит как менеджер») для базы неотличим от Admin — это cookie приложения; его
-- отказ стоит в приложении (действие сервера до любого вызова). Решение «кому показать окно» принимает
-- CRM-правило; «кому показать данные» — сам Google, и эти списки ничем не связаны (план §6, §10).
--
-- Порядок выката. Миграция идёт ДО приложения (ledger-apply, потом выкат): прежнее приложение таблицу не трогает;
-- новое без миграции показало бы «Не удалось прочитать настройку отчёта» и скрыло бы пункт «Финансы» только
-- у бухгалтера при ошибке чтения, а у Admin пункт не зависит от базы.
BEGIN;

-- ---------------------------------------------------------------------------
-- Якоря: объекты, на которые опирается миграция, и отказ при повторном применении.
-- ---------------------------------------------------------------------------
DO $a323_anchor$
BEGIN
  IF to_regclass('platform.organizations') IS NULL
    OR to_regclass('platform.organization_memberships') IS NULL
    OR to_regclass('platform.audit_events') IS NULL
    OR to_regprocedure('platform.current_actor_authority()') IS NULL
    OR to_regclass('platform.staff_role_assignments') IS NULL
    OR to_regclass('platform.staff_role_definitions') IS NULL
    OR to_regclass('platform.role_bundle_versions') IS NULL
    OR to_regclass('platform.role_bundle_permissions') IS NULL
    OR to_regprocedure('platform_private.staff_membership_identity(uuid,uuid)') IS NULL
    OR to_regprocedure('platform_private.p7a_safe_audit_actions()') IS NULL
    OR to_regprocedure('platform_private.p7a_safe_audit_resource_types()') IS NULL
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'platform' AND c.table_name = 'audit_events' AND c.column_name = 'actor_membership_id')
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'platform' AND c.table_name = 'audit_events' AND c.column_name = 'resulting_version')
    OR NOT ('organization' = ANY (platform_private.p7a_safe_audit_resource_types()))
  THEN
    RAISE EXCEPTION 'a323_anchor_drift: the objects this migration builds on are missing' USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('platform.organization_report_link_v1(uuid,text)') IS NOT NULL
    OR to_regprocedure('platform.organization_report_link_save_v1(uuid,text,bigint,text,text,uuid)') IS NOT NULL
    OR to_regprocedure('platform_private.report_link_finance_org_access(uuid,uuid)') IS NOT NULL
    OR to_regclass('platform_private.organization_report_links') IS NOT NULL
    OR to_regprocedure('platform_private.p7a_safe_audit_actions_pre_report_links()') IS NOT NULL
    OR 'report.link.change' = ANY (platform_private.p7a_safe_audit_actions())
  THEN
    RAISE EXCEPTION 'a323_already_applied' USING ERRCODE = '55000';
  END IF;
END
$a323_anchor$;

-- ---------------------------------------------------------------------------
-- Таблица: одна строка на организацию и отчёт. Идентификаторы с запасом по формату: у отчётов Google встречаются
-- короткие, UUID и `p_…`, страница — короткая; адреса, `/`, `"`, пробелы и `?` не проходят.
-- ---------------------------------------------------------------------------
CREATE TABLE platform_private.organization_report_links (
  organization_id UUID NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  report_key TEXT NOT NULL CHECK (report_key IN ('marketing', 'finance')),
  report_id TEXT CHECK (report_id IS NULL OR report_id ~ '^[A-Za-z0-9_-]{8,100}$'),
  page_id TEXT CHECK (page_id IS NULL OR page_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  version BIGINT NOT NULL CHECK (version > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_by_membership_id UUID NOT NULL,
  PRIMARY KEY (organization_id, report_key),
  CONSTRAINT organization_report_links_page_needs_report CHECK (page_id IS NULL OR report_id IS NOT NULL),
  CONSTRAINT organization_report_links_updated_by_fkey FOREIGN KEY (organization_id, updated_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id) ON DELETE RESTRICT
);
COMMENT ON TABLE platform_private.organization_report_links IS
  'Migration 323: the Looker Studio report of «Маркетинг» and «Финансы», one row per organization and key. Only identifiers are stored (the embed address is built by the app from a template); report_id NULL = not connected. Read and written only by platform.organization_report_link_v1 / _save_v1.';
ALTER TABLE platform_private.organization_report_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.organization_report_links FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform_private.organization_report_links
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;

-- ---------------------------------------------------------------------------
-- Закрытый помощник: «Полный просмотр финансов» на ВСЮ организацию. Активный сотрудник организации, у которого
-- действующее назначение несёт опубликованный пакет текущей версии роли с `finance.read.full` и область
-- `organization` этой организации. Это ветка `organization` матчера 155 без проверки вида ресурса (см. шапку).
-- Системный Admin сюда не приходит: его пускает положительная проверка роли в самих функциях.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.report_link_finance_org_access(p_organization_id UUID, p_membership_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_organization_id IS NOT NULL AND p_membership_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM platform_private.staff_membership_identity(p_organization_id, p_membership_id) i
    WHERE EXISTS (
      SELECT 1 FROM platform.staff_role_assignments a
      JOIN platform.staff_role_definitions r ON r.organization_id = a.organization_id AND r.id = a.role_id
        AND r.status = 'active' AND r.current_bundle_id = a.bundle_id
      JOIN platform.role_bundle_versions b ON b.id = a.bundle_id AND b.status = 'published'
      JOIN platform.role_bundle_permissions bp ON bp.bundle_id = a.bundle_id AND bp.permission_key = 'finance.read.full'
      WHERE a.organization_id = p_organization_id AND a.membership_id = p_membership_id AND a.revoked_at IS NULL
        AND a.scope_kind = 'organization' AND a.scope_key = p_organization_id::TEXT))
$$;
REVOKE ALL ON FUNCTION platform_private.report_link_finance_org_access(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;

-- ---------------------------------------------------------------------------
-- Чтение. STABLE, ничего не пишет (в отличие от чтения настроек телефонии, которое само создаёт строку).
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.organization_report_link_v1(p_organization_id UUID, p_report_key TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor RECORD;
  v_row platform_private.organization_report_links%ROWTYPE;
BEGIN
  SELECT a.organization_id, a.membership_id, a.platform_role INTO v_actor
  FROM platform.current_actor_authority() a
  WHERE p_organization_id IS NOT NULL AND a.organization_id = p_organization_id
    AND a.membership_id IS NOT NULL AND a.platform_role IS DISTINCT FROM 'student'
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'report_link_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_report_key IS NULL OR p_report_key NOT IN ('marketing', 'finance') THEN
    RAISE EXCEPTION 'report_link_invalid_key' USING ERRCODE = '22023';
  END IF;
  -- «Маркетинг» — только системный Admin (как marketing_admin_actor, 265); «Финансы» — Admin или право
  -- «Полный просмотр финансов» на ВСЮ организацию (помощник выше).
  IF v_actor.platform_role IS DISTINCT FROM 'admin'::platform.business_role
    AND (p_report_key <> 'finance'
      OR NOT platform_private.report_link_finance_org_access(v_actor.organization_id, v_actor.membership_id))
  THEN
    RAISE EXCEPTION 'report_link_forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM platform_private.organization_report_links x
  WHERE x.organization_id = p_organization_id AND x.report_key = p_report_key;
  RETURN jsonb_build_object(
    'schemaVersion', 1,
    'organizationId', p_organization_id,
    'reportKey', p_report_key,
    'configured', v_row.report_id IS NOT NULL,
    'reportId', v_row.report_id,
    'pageId', v_row.page_id,
    'version', COALESCE(v_row.version, 0),
    'updatedAt', v_row.updated_at);
END
$$;

-- ---------------------------------------------------------------------------
-- Правка: только системный Admin; замок организации, повтор по id запроса, версия строки, журнал.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.organization_report_link_save_v1(
  p_organization_id UUID, p_report_key TEXT, p_expected_version BIGINT, p_report_id TEXT, p_page_id TEXT,
  p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor RECORD;
  v_fp TEXT;
  v_prior platform.audit_events%ROWTYPE;
  v_old platform_private.organization_report_links%ROWTYPE;
  v_new platform_private.organization_report_links%ROWTYPE;
  v_exists BOOLEAN;
  v_current BIGINT;
  v_receipt JSONB;
BEGIN
  SELECT a.organization_id, a.membership_id, a.profile_id, a.auth_user_id INTO v_actor
  FROM platform.current_actor_authority() a
  WHERE p_organization_id IS NOT NULL AND a.organization_id = p_organization_id
    AND a.membership_id IS NOT NULL AND a.platform_role = 'admin'::platform.business_role
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'report_link_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_report_key IS NULL OR p_report_key NOT IN ('marketing', 'finance') THEN
    RAISE EXCEPTION 'report_link_invalid_key' USING ERRCODE = '22023';
  END IF;
  IF p_request_id IS NULL OR p_expected_version IS NULL OR p_expected_version < 0
    OR p_expected_version >= 9007199254740991 THEN
    RAISE EXCEPTION 'report_link_invalid_request' USING ERRCODE = '22023';
  END IF;
  -- Идентификаторы теми же правилами, что CHECK таблицы; страница — только вместе с отчётом.
  IF (p_report_id IS NULL AND p_page_id IS NOT NULL)
    OR (p_report_id IS NOT NULL AND p_report_id !~ '^[A-Za-z0-9_-]{8,100}$')
    OR (p_page_id IS NOT NULL AND p_page_id !~ '^[A-Za-z0-9_-]{1,100}$') THEN
    RAISE EXCEPTION 'report_link_invalid_id' USING ERRCODE = '22023';
  END IF;

  v_fp := encode(sha256(convert_to(jsonb_build_object('reportKey', p_report_key, 'expectedVersion', p_expected_version,
    'reportId', p_report_id, 'pageId', p_page_id)::TEXT, 'UTF8')), 'hex');
  -- Замок организации берётся до поиска повтора: второй такой же запрос (двойное нажатие, повтор после обрыва) ждёт
  -- первого и находит его квитанцию, а не упирается в сдвинувшуюся версию.
  PERFORM pg_advisory_xact_lock(hashtextextended('report_links:' || p_organization_id::TEXT, 323));
  SELECT * INTO v_prior FROM platform.audit_events e WHERE e.request_id = p_request_id;
  IF FOUND THEN
    IF v_prior.organization_id = p_organization_id AND v_prior.action = 'report.link.change'
      AND v_prior.actor_profile_id = v_actor.profile_id AND v_prior.after_state ->> 'fingerprint' = v_fp THEN
      RETURN (v_prior.after_state - 'fingerprint') || jsonb_build_object('replayed', TRUE);
    END IF;
    RAISE EXCEPTION 'report_link_request_conflict' USING ERRCODE = '23505';
  END IF;

  -- Строка под замком: нет строки = версия 0 (значит, два «первых» сохранения подряд не пройдут оба).
  SELECT * INTO v_old FROM platform_private.organization_report_links x
  WHERE x.organization_id = p_organization_id AND x.report_key = p_report_key FOR UPDATE;
  v_exists := FOUND;
  v_current := CASE WHEN v_exists THEN v_old.version ELSE 0 END;
  IF p_expected_version IS DISTINCT FROM v_current THEN
    RAISE EXCEPTION 'report_link_version_conflict' USING ERRCODE = 'PT409';
  END IF;

  -- Тот же ввод: версия и журнал не двигаются («убрать» отчёта, которого нет, — тоже без изменений).
  IF (v_exists AND v_old.report_id IS NOT DISTINCT FROM p_report_id AND v_old.page_id IS NOT DISTINCT FROM p_page_id)
    OR (NOT v_exists AND p_report_id IS NULL) THEN
    RETURN jsonb_build_object('status', 'unchanged', 'schemaVersion', 1, 'organizationId', p_organization_id,
      'reportKey', p_report_key, 'configured', v_exists AND v_old.report_id IS NOT NULL,
      'reportId', v_old.report_id, 'pageId', v_old.page_id, 'version', v_current,
      'updatedAt', v_old.updated_at, 'replayed', FALSE);
  END IF;

  IF NOT v_exists THEN
    INSERT INTO platform_private.organization_report_links AS x
      (organization_id, report_key, report_id, page_id, version, updated_by_membership_id)
    VALUES (p_organization_id, p_report_key, p_report_id, p_page_id, 1, v_actor.membership_id)
    RETURNING * INTO v_new;
  ELSE
    UPDATE platform_private.organization_report_links x SET report_id = p_report_id, page_id = p_page_id,
      version = x.version + 1, updated_at = statement_timestamp(), updated_by_membership_id = v_actor.membership_id
    WHERE x.organization_id = p_organization_id AND x.report_key = p_report_key
    RETURNING * INTO v_new;
  END IF;

  v_receipt := jsonb_build_object('status', 'saved', 'schemaVersion', 1, 'organizationId', p_organization_id,
    'reportKey', p_report_key, 'configured', v_new.report_id IS NOT NULL, 'reportId', v_new.report_id,
    'pageId', v_new.page_id, 'version', v_new.version, 'updatedAt', v_new.updated_at);
  INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_membership_id,
    actor_principal, action, resource_type, resource_id, before_state, after_state, reason, request_id,
    resulting_version)
  VALUES (p_organization_id, 'user', v_actor.profile_id, v_actor.membership_id,
    'auth:' || v_actor.auth_user_id::TEXT, 'report.link.change', 'organization', p_organization_id,
    jsonb_build_object('reportKey', p_report_key, 'configured', v_exists AND v_old.report_id IS NOT NULL,
      'reportId', v_old.report_id, 'pageId', v_old.page_id, 'version', v_current),
    v_receipt || jsonb_build_object('fingerprint', v_fp),
    'Ссылка на отчёт Looker Studio изменена', p_request_id, v_new.version);
  RETURN v_receipt || jsonb_build_object('replayed', FALSE);
END
$$;

-- ---------------------------------------------------------------------------
-- Права: сессия сотрудника (authenticated); решение принимает сама функция.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION platform.organization_report_link_v1(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
GRANT EXECUTE ON FUNCTION platform.organization_report_link_v1(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION platform.organization_report_link_save_v1(uuid, text, bigint, text, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
GRANT EXECUTE ON FUNCTION platform.organization_report_link_save_v1(uuid, text, bigint, text, text, uuid) TO authenticated;
COMMENT ON FUNCTION platform.organization_report_link_v1(uuid, text) IS
  'Migration 323: reads the Looker Studio report link of «marketing» (system Admin only) or «finance» (Admin, or finance.read.full on the WHOLE organization). Writes nothing; no row = configured false, version 0. Others: 42501; unknown key: 22023.';
COMMENT ON FUNCTION platform.organization_report_link_save_v1(uuid, text, bigint, text, text, uuid) IS
  'Migration 323: the system Admin saves or removes (report_id NULL) one report link under the organization lock; versioned (PT409), replay-safe by request id (23505 on a different input), unchanged input writes nothing; journal action report.link.change. Anyone else: 42501.';

-- ---------------------------------------------------------------------------
-- «Журнал действий»: действие report.link.change в allowlist (rename-and-union).
-- ---------------------------------------------------------------------------
ALTER FUNCTION platform_private.p7a_safe_audit_actions()
  RENAME TO p7a_safe_audit_actions_pre_report_links;
CREATE FUNCTION platform_private.p7a_safe_audit_actions()
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.array_agg(DISTINCT allowed.action ORDER BY allowed.action)
  FROM pg_catalog.unnest(
    platform_private.p7a_safe_audit_actions_pre_report_links()
      || ARRAY[
    'report.link.change'
      ]::TEXT[]
  ) AS allowed(action)
$$;

REVOKE ALL ON FUNCTION
  platform_private.p7a_safe_audit_actions_pre_report_links(),
  platform_private.p7a_safe_audit_actions()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- Проверка в конце: таблица закрыта, функции — определитель с пустым search_path и правами только у
-- authenticated, действие в allowlist, прежний список цел.
-- ---------------------------------------------------------------------------
DO $a323_verify$
DECLARE
  f pg_catalog.pg_proc%ROWTYPE;
  v_oid OID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid = 'platform_private.organization_report_links'::regclass
      AND c.relrowsecurity AND c.relforcerowsecurity)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid = 'platform_private.organization_report_links'::regclass)
    OR has_table_privilege('anon', 'platform_private.organization_report_links', 'SELECT')
    OR has_table_privilege('authenticated', 'platform_private.organization_report_links', 'SELECT')
    OR has_table_privilege('authenticated', 'platform_private.organization_report_links', 'INSERT')
    OR has_table_privilege('authenticated', 'platform_private.organization_report_links', 'UPDATE')
    OR has_table_privilege('authenticated', 'platform_private.organization_report_links', 'DELETE')
    OR has_table_privilege('service_role', 'platform_private.organization_report_links', 'SELECT')
    OR has_table_privilege('supabase_auth_admin', 'platform_private.organization_report_links', 'SELECT')
    OR has_table_privilege('evo_ai_agent', 'platform_private.organization_report_links', 'SELECT')
  THEN
    RAISE EXCEPTION 'a323_verify_table' USING ERRCODE = '55000';
  END IF;

  v_oid := 'platform_private.report_link_finance_org_access(uuid,uuid)'::regprocedure::OID;
  SELECT p.* INTO f FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF NOT f.prosecdef OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
    OR has_function_privilege('anon', f.oid, 'EXECUTE')
    OR has_function_privilege('authenticated', f.oid, 'EXECUTE')
    OR has_function_privilege('service_role', f.oid, 'EXECUTE')
    OR has_function_privilege('supabase_auth_admin', f.oid, 'EXECUTE')
    OR has_function_privilege('evo_ai_agent', f.oid, 'EXECUTE')
  THEN
    RAISE EXCEPTION 'a323_verify_helper' USING ERRCODE = '55000';
  END IF;

  FOREACH v_oid IN ARRAY ARRAY[
    'platform.organization_report_link_v1(uuid,text)'::regprocedure::OID,
    'platform.organization_report_link_save_v1(uuid,text,bigint,text,text,uuid)'::regprocedure::OID]
  LOOP
    SELECT p.* INTO f FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
    IF NOT f.prosecdef OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
      OR NOT has_function_privilege('authenticated', f.oid, 'EXECUTE')
      OR has_function_privilege('anon', f.oid, 'EXECUTE')
      OR has_function_privilege('service_role', f.oid, 'EXECUTE')
      OR has_function_privilege('supabase_auth_admin', f.oid, 'EXECUTE')
      OR has_function_privilege('evo_ai_agent', f.oid, 'EXECUTE')
    THEN
      RAISE EXCEPTION 'a323_verify_function' USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF (SELECT p.provolatile FROM pg_catalog.pg_proc p
      WHERE p.oid = 'platform.organization_report_link_v1(uuid,text)'::regprocedure) <> 's'
    OR (SELECT p.provolatile FROM pg_catalog.pg_proc p
      WHERE p.oid = 'platform.organization_report_link_save_v1(uuid,text,bigint,text,text,uuid)'::regprocedure) <> 'v'
  THEN
    RAISE EXCEPTION 'a323_verify_volatility' USING ERRCODE = '55000';
  END IF;

  IF NOT ('report.link.change' = ANY (platform_private.p7a_safe_audit_actions()))
    OR 'report.link.change' = ANY (platform_private.p7a_safe_audit_actions_pre_report_links())
    OR NOT ('case.direction.set' = ANY (platform_private.p7a_safe_audit_actions()))
    OR cardinality(platform_private.p7a_safe_audit_actions())
      <> cardinality(platform_private.p7a_safe_audit_actions_pre_report_links()) + 1
    OR has_function_privilege('anon', 'platform_private.p7a_safe_audit_actions()'::regprocedure, 'EXECUTE')
    OR has_function_privilege('authenticated', 'platform_private.p7a_safe_audit_actions()'::regprocedure, 'EXECUTE')
    OR has_function_privilege('authenticated',
      'platform_private.p7a_safe_audit_actions_pre_report_links()'::regprocedure, 'EXECUTE')
  THEN
    RAISE EXCEPTION 'a323_verify_allowlist' USING ERRCODE = '55000';
  END IF;
END
$a323_verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
