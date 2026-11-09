-- ============================================================
-- 356_platform_student_consent_gate.sql
--
-- «Экран конфиденциальности при первом входе» (решение владельца 09.11.2026, docs/PLAN_CHANGES.md «2026-11-09 · Экран
-- согласий при первом входе»). Любой студент без решения о Политике конфиденциальности и об ИИ-помощниках EVO видит один
-- экран с двумя обязательными галочками; кабинет в браузере и приложение читают состояние и пишут принятие этими
-- двумя командами. Хуки набора в `scripts/test-runners/test-postgres-authorization.sh` привязаны к имени файла.
--
-- Что добавляется (данные существующих студентов не трогаются):
--   a) platform_private.student_privacy_consents - ОДНА текущая строка принятия Политики на студента (организация и вход
--      в Auth, как у 320), закрытая таблица (RLS FORCE, ни одной роли API); история - журнал платформы.
--   b) platform_private.student_privacy_policy_version() - версия действующей Политики: '2026-11-07' (текст согласия
--      анкеты из 345). Новая версия - новая миграция с заменой этой функции: экран появится у всех снова.
--   c) platform.portal_consent_status_v1() - состояние для экрана: версия Политики, принятая версия, решение об ИИ и
--      готовый ответ needsDecision. Политика считается принятой и без строки таблицы, если анкета этого студента
--      подана с согласием текущей версии (345: та же галочка принимает Политику): так регистрация 07.11 не требует
--      повторного экрана, а анкеты, поданные после этой миграции, не нуждаются в отдельной записи.
--   d) platform.portal_consents_accept_v1(p_policy_version, p_ai_policy_version, p_source, p_request_id) - одной
--      транзакцией: принимает Политику и записывает «разрешено» для ИИ-помощников прежней командой 320
--      (portal_ai_consent_set_v1); повтор по номеру запроса безопасен. Только для самого студента (та же личность, что у
--      320 и удаления аккаунта 280, - включая заявителя анкеты), сотруднику - отказ.
--   e) Журнал: действие privacy.policy.accept и тип объекта student_privacy_consent (rename-and-union, как 320).
--   f) Удаление аккаунта (280): новая таблица - «своя» таблица замыкания (одно место списка, приём 320/346).
--
-- Права: обе команды - только authenticated (SECURITY DEFINER, пустой search_path); помощники - никому.
-- Forward-only: повтор отказывает a356_already_applied.
-- ============================================================

BEGIN;

DO $a356_anchor$
BEGIN
  IF to_regclass('platform_private.student_privacy_consents') IS NOT NULL
    OR to_regprocedure('platform.portal_consent_status_v1()') IS NOT NULL
    OR to_regprocedure('platform.portal_consents_accept_v1(text,text,text,uuid)') IS NOT NULL
    OR 'privacy.policy.accept' = ANY (platform_private.p7a_safe_audit_actions())
  THEN
    RAISE EXCEPTION 'a356_already_applied' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('platform_private.student_ai_consents') IS NULL
    OR to_regclass('platform_private.student_applications') IS NULL
    OR to_regprocedure('platform.portal_ai_consent_set_v1(text,text,text,uuid)') IS NULL
    OR to_regprocedure('platform_private.student_ai_consent_org(uuid)') IS NULL
    OR to_regprocedure('platform_private.student_ai_consent_policy_version()') IS NULL
    OR to_regprocedure('platform_private.account_deletion_closure(uuid,uuid)') IS NULL
    OR to_regprocedure('public.uuid_generate_v5(uuid,text)') IS NULL
    OR strpos(pg_get_functiondef('platform.portal_ai_consent_set_v1(text,text,text,uuid)'::regprocedure), '''android''') = 0
    OR strpos(pg_get_functiondef('platform_private.account_deletion_closure(uuid,uuid)'::regprocedure),
      '''platform_private.student_password_resets''];') = 0
  THEN
    RAISE EXCEPTION 'a356_anchor_drift: the 320 / 346 / 355 objects this migration builds on are missing or changed' USING ERRCODE = '55000';
  END IF;
END
$a356_anchor$;

-- ---------------------------------------------------------------------------
-- a) Таблица принятия Политики: одна текущая строка на (организация, вход в Auth). Закрытая.
-- ---------------------------------------------------------------------------
CREATE TABLE platform_private.student_privacy_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  auth_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  policy_version TEXT NOT NULL,
  source TEXT NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT student_privacy_consents_subject_key UNIQUE (organization_id, auth_user_id),
  CONSTRAINT student_privacy_consents_source_check CHECK (source IN ('portal_web', 'ios', 'android')),
  CONSTRAINT student_privacy_consents_version_check CHECK (policy_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
);
COMMENT ON TABLE platform_private.student_privacy_consents IS
  '356: current acceptance of the privacy policy by a student (one row per organization and Auth user); history is in platform.audit_events.';
ALTER TABLE platform_private.student_privacy_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.student_privacy_consents FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE platform_private.student_privacy_consents
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;

-- ---------------------------------------------------------------------------
-- b) Версия Политики и состояние (помощники, без грантов).
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.student_privacy_policy_version()
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT '2026-11-07'::TEXT
$$;

-- Состояние экрана для одного входа в Auth (организация уже определена вызывающим).
CREATE FUNCTION platform_private.student_consent_status(p_org UUID, p_auth_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_current CONSTANT TEXT := platform_private.student_privacy_policy_version();
  v_ai_current CONSTANT TEXT := platform_private.student_ai_consent_policy_version();
  p platform_private.student_privacy_consents;
  k platform_private.student_ai_consents;
  v_app_version TEXT;
  v_accepted TEXT;
BEGIN
  SELECT * INTO p FROM platform_private.student_privacy_consents x
  WHERE x.organization_id = p_org AND x.auth_user_id = p_auth_user_id;
  SELECT * INTO k FROM platform_private.student_ai_consents x
  WHERE x.organization_id = p_org AND x.auth_user_id = p_auth_user_id;
  -- 345: галочка анкеты текущей версии сама принимает Политику.
  SELECT a.questionnaire ->> 'consentVersion' INTO v_app_version FROM platform_private.student_applications a
  WHERE a.organization_id = p_org AND a.auth_user_id = p_auth_user_id;
  v_accepted := CASE
    WHEN p.policy_version = v_current OR v_app_version = v_current THEN v_current
    ELSE p.policy_version END;
  RETURN jsonb_build_object(
    'policyVersionCurrent', v_current,
    'policyAcceptedVersion', v_accepted,
    'aiStatus', k.status,
    'aiPolicyVersion', k.policy_version,
    'aiPolicyVersionCurrent', v_ai_current,
    'needsDecision', (v_accepted IS DISTINCT FROM v_current)
      OR (k.status IS NULL OR k.policy_version IS DISTINCT FROM v_ai_current));
END
$$;

-- ---------------------------------------------------------------------------
-- c) Чтение состояния (кабинет и приложение, JWT студента).
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.portal_consent_status_v1()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE uid UUID := auth.uid(); v_org UUID;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'consent_unavailable' USING ERRCODE = '42501';
  END IF;
  v_org := platform_private.student_ai_consent_org(uid);
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'consent_unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN platform_private.student_consent_status(v_org, uid);
END
$$;

-- ---------------------------------------------------------------------------
-- d) Принятие обеих галочек одной транзакцией.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.portal_consents_accept_v1(p_policy_version TEXT, p_ai_policy_version TEXT, p_source TEXT, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  uid UUID := auth.uid();
  v_org UUID;
  cur platform_private.student_privacy_consents;
  v_before JSONB;
  v_prior JSONB;
  v_event UUID;
  v_write BOOLEAN := TRUE;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'consent_unavailable' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'consent_invalid_request' USING ERRCODE = '22023';
  END IF;
  IF p_source IS NULL OR p_source NOT IN ('portal_web', 'ios', 'android') THEN
    RAISE EXCEPTION 'consent_invalid_source' USING ERRCODE = '22023';
  END IF;
  IF p_policy_version IS DISTINCT FROM platform_private.student_privacy_policy_version() THEN
    RAISE EXCEPTION 'consent_policy_version_mismatch' USING ERRCODE = '22023';
  END IF;
  IF p_ai_policy_version IS DISTINCT FROM platform_private.student_ai_consent_policy_version() THEN
    RAISE EXCEPTION 'consent_ai_policy_version_mismatch' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('evo:ai-consent-subject:' || uid::TEXT, 0));
  v_org := platform_private.student_ai_consent_org(uid);
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'consent_unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO cur FROM platform_private.student_privacy_consents k
  WHERE k.organization_id = v_org AND k.auth_user_id = uid FOR UPDATE;
  IF FOUND THEN
    -- Повтор запроса: событие с ключом из id запроса уже есть. То же содержимое - прежний итог, иное - конфликт.
    v_event := public.uuid_generate_v5(cur.id, 'privacy.policy.accept:' || p_request_id::TEXT);
    SELECT e.after_state INTO v_prior FROM platform.audit_events e WHERE e.request_id = v_event;
    IF FOUND THEN
      IF v_prior ->> 'policy_version' = p_policy_version AND v_prior ->> 'source' = p_source THEN
        v_write := FALSE;
      ELSE
        RAISE EXCEPTION 'consent_request_conflict' USING ERRCODE = '55000';
      END IF;
    ELSIF cur.policy_version = p_policy_version THEN
      v_write := FALSE;
    ELSE
      IF (SELECT count(*) FROM platform.audit_events e WHERE e.organization_id = cur.organization_id AND e.resource_id = cur.id
          AND e.action = 'privacy.policy.accept' AND e.created_at > clock_timestamp() - INTERVAL '1 hour') >= 20 THEN
        RAISE EXCEPTION 'consent_rate_limited' USING ERRCODE = '54000';
      END IF;
      v_before := jsonb_build_object('policy_version', cur.policy_version);
      UPDATE platform_private.student_privacy_consents k
      SET policy_version = p_policy_version, source = p_source, accepted_at = clock_timestamp()
      WHERE k.id = cur.id
      RETURNING * INTO cur;
    END IF;
  ELSE
    INSERT INTO platform_private.student_privacy_consents (organization_id, auth_user_id, policy_version, source)
    VALUES (v_org, uid, p_policy_version, p_source)
    RETURNING * INTO cur;
    v_event := public.uuid_generate_v5(cur.id, 'privacy.policy.accept:' || p_request_id::TEXT);
  END IF;

  IF v_write THEN
    INSERT INTO platform.audit_events (
      organization_id, actor_kind, actor_principal, action, resource_type, resource_id,
      before_state, after_state, reason, request_id
    ) VALUES (
      cur.organization_id, 'system', 'auth:' || uid::TEXT, 'privacy.policy.accept', 'student_privacy_consent', cur.id,
      v_before, jsonb_build_object('policy_version', cur.policy_version, 'source', cur.source),
      'Student accepted the privacy policy', v_event);
  END IF;

  -- Вторая галочка - прежняя команда 320 в той же транзакции (она берёт ту же блокировку, повторный вход разрешён).
  -- Ошибки её (ai_consent_*) идут наружу как есть и откатывают принятие Политики.
  PERFORM platform.portal_ai_consent_set_v1('granted', p_ai_policy_version, p_source, p_request_id);
  RETURN platform_private.student_consent_status(v_org, uid);
END
$$;

-- ---------------------------------------------------------------------------
-- e) Журнал платформы: действие и тип объекта (rename-and-union, как 320).
-- ---------------------------------------------------------------------------
ALTER FUNCTION platform_private.p7a_safe_audit_actions()
  RENAME TO p7a_safe_audit_actions_pre_student_consent_gate;
CREATE FUNCTION platform_private.p7a_safe_audit_actions()
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.array_agg(DISTINCT allowed.action ORDER BY allowed.action)
  FROM pg_catalog.unnest(
    platform_private.p7a_safe_audit_actions_pre_student_consent_gate()
      || ARRAY[
    'privacy.policy.accept'
      ]::TEXT[]
  ) AS allowed(action)
$$;

ALTER FUNCTION platform_private.p7a_safe_audit_resource_types()
  RENAME TO p7a_safe_audit_resource_types_pre_student_consent_gate;
CREATE FUNCTION platform_private.p7a_safe_audit_resource_types()
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.array_agg(DISTINCT allowed.resource_type ORDER BY allowed.resource_type)
  FROM pg_catalog.unnest(
    platform_private.p7a_safe_audit_resource_types_pre_student_consent_gate()
      || ARRAY[
    'student_privacy_consent'
      ]::TEXT[]
  ) AS allowed(resource_type)
$$;

REVOKE ALL ON FUNCTION
  platform_private.p7a_safe_audit_actions_pre_student_consent_gate(),
  platform_private.p7a_safe_audit_actions(),
  platform_private.p7a_safe_audit_resource_types_pre_student_consent_gate(),
  platform_private.p7a_safe_audit_resource_types()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- f) Удаление аккаунта: таблица - «своя» в замыкании (приём 320/346).
-- ---------------------------------------------------------------------------
DO $a356_closure$
DECLARE
  v_def TEXT := pg_catalog.pg_get_functiondef('platform_private.account_deletion_closure(uuid,uuid)'::regprocedure);
  v_from CONSTANT TEXT := E'''platform_private.student_password_resets''];';
  v_to CONSTANT TEXT := E'''platform_private.student_password_resets'',\n'
    || E'    -- 356: принятие Политики конфиденциальности.\n'
    || E'    ''platform_private.student_privacy_consents''];';
BEGIN
  IF (length(v_def) - length(replace(v_def, v_from, ''))) / length(v_from) <> 1 THEN
    RAISE EXCEPTION 'a356_anchor_drift: the own-table list of account_deletion_closure is not the 346 one' USING ERRCODE = '55000';
  END IF;
  EXECUTE replace(v_def, v_from, v_to);
END
$a356_closure$;

-- ---------------------------------------------------------------------------
-- Права.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  platform_private.student_privacy_policy_version(),
  platform_private.student_consent_status(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
REVOKE ALL ON FUNCTION
  platform.portal_consent_status_v1(),
  platform.portal_consents_accept_v1(TEXT, TEXT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
GRANT EXECUTE ON FUNCTION
  platform.portal_consent_status_v1(),
  platform.portal_consents_accept_v1(TEXT, TEXT, TEXT, UUID)
  TO authenticated;

DO $a356_verify$
DECLARE f RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid = 'platform_private.student_privacy_consents'::REGCLASS
      AND c.relrowsecurity AND c.relforcerowsecurity)
    OR has_table_privilege('authenticated', 'platform_private.student_privacy_consents', 'SELECT')
    OR has_table_privilege('service_role', 'platform_private.student_privacy_consents', 'SELECT')
    OR has_table_privilege('anon', 'platform_private.student_privacy_consents', 'SELECT')
  THEN
    RAISE EXCEPTION 'a356_verify_table' USING ERRCODE = '55000';
  END IF;
  FOR f IN SELECT p.oid, p.proname, n.nspname, p.prosecdef, p.proconfig FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE (n.nspname = 'platform' AND p.proname IN ('portal_consent_status_v1', 'portal_consents_accept_v1'))
      OR (n.nspname = 'platform_private' AND p.proname IN ('student_privacy_policy_version', 'student_consent_status')) LOOP
    IF f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
      OR has_function_privilege('anon', f.oid, 'EXECUTE') OR has_function_privilege('service_role', f.oid, 'EXECUTE')
      OR has_function_privilege('supabase_auth_admin', f.oid, 'EXECUTE') OR has_function_privilege('evo_ai_agent', f.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'a356_verify_function: %', f.proname USING ERRCODE = '55000';
    END IF;
    IF f.nspname = 'platform' AND (NOT f.prosecdef OR NOT has_function_privilege('authenticated', f.oid, 'EXECUTE')) THEN
      RAISE EXCEPTION 'a356_verify_portal_grant: %', f.proname USING ERRCODE = '55000';
    END IF;
    IF f.nspname = 'platform_private' AND has_function_privilege('authenticated', f.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'a356_verify_helper_grant: %', f.proname USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF NOT ('privacy.policy.accept' = ANY (platform_private.p7a_safe_audit_actions()))
    OR NOT ('student_privacy_consent' = ANY (platform_private.p7a_safe_audit_resource_types()))
    OR strpos(pg_get_functiondef('platform_private.account_deletion_closure(uuid,uuid)'::regprocedure), 'student_privacy_consents') = 0
  THEN
    RAISE EXCEPTION 'a356_verify_journal_closure' USING ERRCODE = '55000';
  END IF;
END
$a356_verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
