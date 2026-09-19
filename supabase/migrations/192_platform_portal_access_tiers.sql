-- PORT-1a «Уровни доступа портала»: approved (pending-кейс) отделён от
-- сопровождения (active/closed). docs/design/portal/port-0-contracts.md
-- «Решение: модель доступа» (пп. 3-4), план
-- docs/EVO_PORTAL_WEB_IPHONE_PLAN_2026-09-19.md §4/§8.4,
-- ADR docs/adr/0030-portal-iphone-swiftui-supabase-transport.md.
--
-- Intent. 180 открыла портальные предикаты для portal-activated
-- state='pending' кейса («кабинет до продажи»). Уровень «одобрен» по плану §4
-- получает обзор, уведомления, каталог, тесты и профиль — но НЕ case-help
-- («Общение» — уровень сопровождения) и НЕ документы (чек-лист сеется только
-- active-кейсу, и до этой миграции pending-безопасность документов держалась
-- на этой структурной случайности, а не на инварианте). Здесь обе границы
-- становятся явными: state IN ('active','closed') в студенческой ветке
-- case-операций и во всех документных студенческих путях.
--
-- Production impact: ZERO accounts change behaviour. По сверке PORT-0
-- (Management API, 2026-09-19) в production ровно 2 живых student_cases и обе
-- active; pending-кейсов с активированным порталом нет. Существующие
-- case-help треды остаются читаемыми: staff-ветка require_case_operations_actor
-- не меняется, а студенческая ветка активного кейса проходит новый гейт.
--
-- Technique. Везде pg_get_functiondef + anchor-replace + EXECUTE (образец:
-- 180:417-460), НЕ полный CREATE OR REPLACE с переписанным телом. Причины:
-- (1) все 8 документных тел — уже продукт anchor-правок 180 поверх тел из
-- 046/115/128; «полное» переписывание пришлось бы собирать вручную из трёх
-- слоёв и молча потеряло бы любую не замеченную правку; (2) параллельная
-- сессия владеет миграциями 187-194 (та же очередь применения ДО этой), и
-- полный rewrite молча откатил бы её возможные правки этих же функций —
-- anchor-replace вместо этого громко упадёт на несовпадении якоря
-- (fail-loud вместо fail-silent). Для require_case_operations_actor последнее
-- определение целиком в 156, но довод (2) действует и для него.
--
-- Denial semantics: без изменений — сокращение списка состояний приводит к
-- уже существующим RAISE каждой функции ('Case access denied' 42501 в
-- require_case_operations_actor; 'Document is unavailable' 42501 в документных
-- гейтах; пустой результат в student_portal_documents()).
--
-- Functions touched (exactly):
--   platform_private.require_case_operations_actor(uuid,boolean)
--     (студенческая ветка: + state IN ('active','closed'); закрывает
--      create_case_help_request_v1 и case_help_workspace_v1 для pending)
--   platform.student_portal_documents()
--     (+ явный EXISTS state-гейт; читающая проекция документов)
--   platform.admit_student_document_upload_scan(uuid,uuid,uuid)
--   private.grant_student_portal_document_download(uuid,uuid,uuid)
--   private.grant_document_download_pre_e5(uuid,uuid,text,integer,uuid)  (2 якоря)
--   private.consume_document_download_grant_pre_e5(uuid,uuid)
--   platform.reserve_document_upload_after_ingress_scan(...)
--   platform.preflight_document_upload(uuid,uuid,text,text,bigint,text,uuid)
--   platform_private.require_document_storage_actor(uuid,uuid,text)
--   platform_private.require_current_upload_reservation(uuid,uuid,text)
--     (8 документных — точный откат расширения 180 к ('active','closed'))
--
-- Deliberately NOT touched (pending-eligible by design — «это и есть дизайн»):
--   private.platform_can_read_student_portal_case (общий кейс-гейт: обзор,
--     student_portal_cases(), уведомления, отметка прочтения),
--   platform.student_portal_overview_v2(),
--   platform_private.live_student_portal_recipient(uuid,uuid).
BEGIN;

CREATE FUNCTION pg_temp.evo_p192_assisted_gate_replace(p_signature TEXT, p_before TEXT, p_after TEXT, p_expected INTEGER DEFAULT 1)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE body TEXT; occurrences INTEGER;
BEGIN
  SELECT pg_get_functiondef(p_signature::regprocedure) INTO body;
  occurrences := (length(body) - length(replace(body, p_before, ''))) / length(p_before);
  IF occurrences <> p_expected THEN
    RAISE EXCEPTION 'evo_p192_assisted_gate_anchor_mismatch: % (% instead of %)', p_signature, occurrences, p_expected;
  END IF;
  EXECUTE replace(body, p_before, p_after);
END
$$;

-- ---------------------------------------------------------------------------
-- 1) Case operations (case-help): студенческая ветка требует сопровождение.
--    Staff-ветка (ELSE) не меняется — существующие треды читаемы куратору и
--    админу на кейсе в любом состоянии.
-- ---------------------------------------------------------------------------
SELECT pg_temp.evo_p192_assisted_gate_replace(
  'platform_private.require_case_operations_actor(uuid,boolean)',
  $$    IF NOT FOUND OR (p_case_id IS NOT NULL AND p_case_id <> c.id) THEN
      RAISE EXCEPTION 'Case access denied' USING ERRCODE = '42501';
    END IF;
  ELSE$$,
  $$    IF NOT FOUND OR (p_case_id IS NOT NULL AND p_case_id <> c.id) THEN
      RAISE EXCEPTION 'Case access denied' USING ERRCODE = '42501';
    END IF;
    -- PORT-1a: case-операции (case-help) — уровень сопровождения; approved
    -- (pending) кейс получает «Запрос консультации» (PORT-5), не case-help.
    IF c.state NOT IN ('active', 'closed') THEN
      RAISE EXCEPTION 'Case access denied' USING ERRCODE = '42501';
    END IF;
  ELSE$$);

-- ---------------------------------------------------------------------------
-- 2) Читающая проекция документов: явный state-гейт вместо структурной
--    случайности «у pending-кейса нет слотов». Общий кейс-гейт
--    platform_can_read_student_portal_case остаётся pending-eligible.
-- ---------------------------------------------------------------------------
SELECT pg_temp.evo_p192_assisted_gate_replace(
  'platform.student_portal_documents()',
  $$  WHERE slot.removed_at IS NULL
    AND private.platform_can_read_student_portal_case($$,
  $$  WHERE slot.removed_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM platform.student_cases AS student_case
      WHERE student_case.organization_id = slot.organization_id
        AND student_case.id = slot.student_case_id
        AND student_case.state IN ('active', 'closed')
    )
    AND private.platform_can_read_student_portal_case($$);

-- ---------------------------------------------------------------------------
-- 3) Документные студенческие пути: точный откат расширения 180 (все якоря —
--    дословные p_after из 180, состояние списков возвращается к
--    ('active','closed')). Admin/Curator ветки не затрагиваются.
-- ---------------------------------------------------------------------------
SELECT pg_temp.evo_p192_assisted_gate_replace(
  'platform.admit_student_document_upload_scan(uuid,uuid,uuid)',
  $$    AND student_case.state IN ('pending', 'active', 'closed')
    AND student_case.student_membership_id IS NOT DISTINCT FROM
      actor.actor_membership_id
    AND student_case.portal_activated_at IS NOT NULL$$,
  $$    AND student_case.state IN ('active', 'closed')
    AND student_case.student_membership_id IS NOT DISTINCT FROM
      actor.actor_membership_id
    AND student_case.portal_activated_at IS NOT NULL$$);

SELECT pg_temp.evo_p192_assisted_gate_replace(
  'private.grant_student_portal_document_download(uuid,uuid,uuid)',
  $$    AND student_case.state IN ('pending', 'active', 'closed')
    AND student_case.student_membership_id IS NOT DISTINCT FROM
      actor.actor_membership_id
    AND student_case.portal_activated_at IS NOT NULL$$,
  $$    AND student_case.state IN ('active', 'closed')
    AND student_case.student_membership_id IS NOT DISTINCT FROM
      actor.actor_membership_id
    AND student_case.portal_activated_at IS NOT NULL$$);

-- Два вхождения (предварительная проверка + перепроверка после блокировок);
-- каждое правится собственным якорем по локальному алиасу, как в 180.
SELECT pg_temp.evo_p192_assisted_gate_replace(
  'private.grant_document_download_pre_e5(uuid,uuid,text,integer,uuid)',
  $$      OR (
        actor.actor_role IS NOT DISTINCT FROM 'student'
        AND student_case.state IN ('pending', 'active', 'closed')
        AND student_case.student_membership_id IS NOT DISTINCT FROM
          actor.actor_membership_id
        AND student_case.portal_activated_at IS NOT NULL$$,
  $$      OR (
        actor.actor_role IS NOT DISTINCT FROM 'student'
        AND student_case.state IN ('active', 'closed')
        AND student_case.student_membership_id IS NOT DISTINCT FROM
          actor.actor_membership_id
        AND student_case.portal_activated_at IS NOT NULL$$);
SELECT pg_temp.evo_p192_assisted_gate_replace(
  'private.grant_document_download_pre_e5(uuid,uuid,text,integer,uuid)',
  $$    OR (
      actor.actor_role IS NOT DISTINCT FROM 'student'
      AND case_row.state IN ('pending', 'active', 'closed')
      AND case_row.student_membership_id IS NOT DISTINCT FROM
        actor.actor_membership_id
      AND case_row.portal_activated_at IS NOT NULL$$,
  $$    OR (
      actor.actor_role IS NOT DISTINCT FROM 'student'
      AND case_row.state IN ('active', 'closed')
      AND case_row.student_membership_id IS NOT DISTINCT FROM
        actor.actor_membership_id
      AND case_row.portal_activated_at IS NOT NULL$$);

SELECT pg_temp.evo_p192_assisted_gate_replace(
  'private.consume_document_download_grant_pre_e5(uuid,uuid)',
  $$      OR (membership."current_role" = 'student'
        AND download_grant.grantee_role = 'student'
        AND student_case.state IN ('pending', 'active', 'closed') AND student_case.student_membership_id = membership.id
        AND student_case.portal_activated_at IS NOT NULL$$,
  $$      OR (membership."current_role" = 'student'
        AND download_grant.grantee_role = 'student'
        AND student_case.state IN ('active', 'closed') AND student_case.student_membership_id = membership.id
        AND student_case.portal_activated_at IS NOT NULL$$);

SELECT pg_temp.evo_p192_assisted_gate_replace(
  'platform.reserve_document_upload_after_ingress_scan(uuid,uuid,uuid,text,text,bigint,text,text,text,text,text,text,timestamp with time zone,uuid)',
  $$      OR (
        actor.actor_role IS NOT DISTINCT FROM 'student'
        AND student_case.state IN ('pending', 'active', 'closed')
        AND student_case.student_membership_id IS NOT DISTINCT FROM
          actor.actor_membership_id
        AND student_case.portal_activated_at IS NOT NULL$$,
  $$      OR (
        actor.actor_role IS NOT DISTINCT FROM 'student'
        AND student_case.state IN ('active', 'closed')
        AND student_case.student_membership_id IS NOT DISTINCT FROM
          actor.actor_membership_id
        AND student_case.portal_activated_at IS NOT NULL$$);

SELECT pg_temp.evo_p192_assisted_gate_replace(
  'platform.preflight_document_upload(uuid,uuid,text,text,bigint,text,uuid)',
  $$      OR (
        actor.actor_role IS NOT DISTINCT FROM 'student'
        AND student_case.state IN ('pending', 'active', 'closed')
        AND student_case.student_membership_id IS NOT DISTINCT FROM
          actor.actor_membership_id
        AND student_case.portal_activated_at IS NOT NULL$$,
  $$      OR (
        actor.actor_role IS NOT DISTINCT FROM 'student'
        AND student_case.state IN ('active', 'closed')
        AND student_case.student_membership_id IS NOT DISTINCT FROM
          actor.actor_membership_id
        AND student_case.portal_activated_at IS NOT NULL$$);

SELECT pg_temp.evo_p192_assisted_gate_replace(
  'platform_private.require_document_storage_actor(uuid,uuid,text)',
  $$    OR (a.actor_role IS NOT DISTINCT FROM 'student' AND c.state IN ('pending','active','closed')
      AND c.student_membership_id=a.actor_membership_id AND c.portal_activated_at IS NOT NULL$$,
  $$    OR (a.actor_role IS NOT DISTINCT FROM 'student' AND c.state IN ('active','closed')
      AND c.student_membership_id=a.actor_membership_id AND c.portal_activated_at IS NOT NULL$$);

SELECT pg_temp.evo_p192_assisted_gate_replace(
  'platform_private.require_current_upload_reservation(uuid,uuid,text)',
  $$      AND c.student_membership_id = m.id AND c.state IN ('pending', 'active', 'closed') AND c.portal_activated_at IS NOT NULL$$,
  $$      AND c.student_membership_id = m.id AND c.state IN ('active', 'closed') AND c.portal_activated_at IS NOT NULL$$);

NOTIFY pgrst,'reload schema';
COMMIT;
