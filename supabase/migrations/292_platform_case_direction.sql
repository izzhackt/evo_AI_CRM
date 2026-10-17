-- 292: «Задать направление» делу студента (решение владельца 17.10.2026:
-- «Менять и заданное»). docs/PLAN_CHANGES.md «2026-10-17 · Дело студента:
-- «Задать направление» (миграция 292, запись до кода)».
--
-- Forward-only и аддитивно: одна клиентская функция и ничего больше; ни одна
-- существующая функция, таблица и проверка не меняется. SECURITY DEFINER, пустой
-- search_path, EXECUTE только `authenticated`, функция живёт в `platform`.
--
-- Зачем. `configure_case_admissions_v1` (137) единственная пишет
-- `student_cases.admissions_direction`, но требует активное дело и настоящую
-- передачу из продаж, навсегда привязывает дело к регламенту страны, сбрасывает
-- этап в `intake`, перезаписывает «Следующий шаг» и срок, поднимает версию и
-- сеет задачи этапа. У дела прямого студента и у дела, заведённого продажами без
-- направления, это не «записать одну колонку». Новая команда меняет ТОЛЬКО
-- `admissions_direction` (и счётчик версии, который обязана поднять).
--
--  a) Значение. Одно из пяти направлений сотрудников - CN, MY, EUROPE, AE, TR,
--     ровно домен проверки `student_cases_admissions_direction_check` (137), проверки
--     области роли `direction` (155) и функции `student_application_direction` (177:
--     IT, CZ и остальные европейские страны живут в EUROPE). Шесть стран продукта
--     (`study_country_codes()`, 282) записать нельзя: проверка столбца откажет, а
--     расширив её, дело ушло бы из области EUROPE в никуда. Эта функция отдаёт шесть
--     стран выбора студента; направление сотрудников - другой список.
--  b) Право. `case.curator.assign` на этом деле через ту же цепочку блокировок, что
--     у «Следующего шага» (241): `u7_require_case_workspace_actor` (чтение дела),
--     общая блокировка домена назначений, `require_domain_actor`, `SELECT ... FOR
--     UPDATE` и `require_case_operator` после блокировки. Им владеют Admin и роль
--     «Admissions Manager» (отдел); обычный куратор («Admissions», своя область,
--     `case.route.manage`) его не имеет. Студент, Sales, куратор, сотрудник другой
--     организации и пользователь без членства получают 42501 одним сообщением.
--  c) Версия. `admissions_version` - токен полей сопровождения (137; им же
--     защищены `set_case_next_action_v1` и редактор требований заявки, 226). Ожидаемая
--     обязана совпасть, запись поднимает её на единицу; несовпадение и переполнение -
--     PT409. То же значение, что уже стоит, - расписка без записи и без ошибки:
--     версия и журнал не меняются, проверка версии для него не нужна.
--  d) Регламент. Дело с `admissions_playbook_version_id` отвечает
--     `case_direction_playbook_bound` (22023) на любое значение: пара (регламент,
--     направление) связана внешним ключом, `admissions_binding_shape` (CN или MY
--     обязательно) и триггер `admissions_guard_case` (55000) не дают её менять.
--     Пустого направления у привязанного дела не бывает (`admissions_binding_shape`).
--     Дело без регламента может получить любое из пяти значений; выбор CN или MY его
--     не привязывает, и `configure_case_admissions_v1` позже работает как прежде.
--     Закрытое дело отвечает `case_direction_case_closed` (направление закрытого
--     дела - историческая отчётность); ожидающее куратора (`pending`) и активное
--     меняются.
--  e) Идемпотентность по `p_request_id` через `platform.audit_events` (UNIQUE
--     request_id): точный повтор тем же сотрудником возвращает прежнюю расписку,
--     иное использование идентификатора - `case_direction_request_conflict`.
--  f) Журнал. `platform.audit_events`, действие `case.direction.set` (грамматика 041),
--     объект `student_case`; до и после - только `admissions_direction` и
--     `admissions_version`, без персональных данных. В «Журнал действий» и в «Историю»
--     дела действие не выводится: их списки (`p7a_safe_audit_actions`,
--     `private.staff_student_case_activity` и `PlatformAuditAction` приложения)
--     меняются вместе в цепочке переименований, которую одновременно правят срезы
--     телефонии (так поступила 287 с `lead.amocrm.link`).
--  g) Видимость. Столбец читают `staff_context_can_access` (область «направление»
--     роли сравнивается со столбцом) для дела, его заявок, виз, документов,
--     финансовых записей, задач, переписки, лида и клиента, очередь 241, доска 187,
--     сводка 183 и каталог переписки 191. NULL -> X открывает дело сотрудникам с
--     областью X; X -> Y переносит его от области X к области Y. Если запись лишила бы
--     самого актора доступа к делу (чтение или назначение), команда откатывается
--     `case_direction_actor_access_lost`, а не оставляет запертую дверь.
--  h) Не меняются: куратор, этап, исход, задачи, «Следующий шаг» и срок, регламент,
--     факты маршрута, платежи, `target_country` (свободный текст маршрута, из него по
--     284 выводится страна выбора студента), `leads.interest_direction` (поле продаж).
BEGIN;

-- ---------------------------------------------------------------------------
-- Якоря: объекты, которые команда использует, и домен проверки столбца.
-- ---------------------------------------------------------------------------
DO $a292_anchor$
DECLARE
  listed TEXT[];
  definition TEXT;
BEGIN
  IF to_regprocedure('platform_private.admissions_lock_case(uuid,text)') IS NULL
    OR to_regprocedure('platform_private.lock_p2d_request(uuid)') IS NULL
    OR to_regprocedure('platform_private.u7_require_case_workspace_actor(uuid)') IS NULL
    OR to_regprocedure('platform_private.staff_can_access(uuid,uuid,text,text,uuid)') IS NULL
    OR to_regclass('platform.audit_events') IS NULL
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'platform' AND c.table_name = 'audit_events' AND c.column_name = 'resulting_version')
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'platform' AND c.table_name = 'audit_events' AND c.column_name = 'actor_membership_id')
    -- 137: пара (регламент, направление) защищена триггером.
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
      WHERE t.tgrelid = 'platform.student_cases'::regclass AND NOT t.tgisinternal
        AND t.tgfoid = 'platform_private.admissions_guard_case()'::regprocedure)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
      WHERE k.conrelid = 'platform.student_cases'::regclass AND k.conname = 'admissions_binding_shape')
  THEN
    RAISE EXCEPTION 'a292_anchor_drift';
  END IF;
  SELECT pg_get_constraintdef(k.oid) INTO definition FROM pg_catalog.pg_constraint k
    WHERE k.conrelid = 'platform.student_cases'::regclass AND k.conname = 'student_cases_admissions_direction_check';
  SELECT array_agg(m[1] ORDER BY m[1]) INTO listed FROM regexp_matches(definition, '''([A-Z]+)''::text', 'g') AS m;
  IF definition IS NULL OR listed IS DISTINCT FROM ARRAY['AE', 'CN', 'EUROPE', 'MY', 'TR']::TEXT[] THEN
    RAISE EXCEPTION 'a292_direction_domain_drift: %', COALESCE(definition, 'no constraint');
  END IF;
END
$a292_anchor$;

-- ---------------------------------------------------------------------------
-- platform.set_student_case_direction_v1
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.set_student_case_direction_v1(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_direction TEXT,
  p_expected_version BIGINT,
  p_request_id UUID
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  c platform.student_cases%ROWTYPE;
  changed platform.student_cases%ROWTYPE;
  prior platform.audit_events%ROWTYPE;
  recorded_at TIMESTAMPTZ;
BEGIN
  IF p_organization_id IS NULL OR p_student_case_id IS NULL OR p_request_id IS NULL
    OR p_expected_version IS NULL OR p_expected_version NOT BETWEEN 0 AND 9223372036854775806
    OR p_direction IS NULL OR p_direction NOT IN ('CN', 'MY', 'EUROPE', 'AE', 'TR')
  THEN
    RAISE EXCEPTION 'case_direction_invalid' USING ERRCODE = '22023';
  END IF;

  -- Чтение без блокировок до того, как для этого вызывающего взята хоть одна.
  SELECT * INTO actor FROM platform_private.u7_require_case_workspace_actor(p_student_case_id);
  IF actor.organization_id IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'Student case is unavailable' USING ERRCODE = '42501';
  END IF;
  PERFORM platform_private.lock_p2d_request(p_request_id);
  -- Цепочка маршрутных команд 137/241 с правом назначения куратора; право
  -- перепроверяется после блокировки строки дела.
  c := platform_private.admissions_lock_case(p_student_case_id, 'case.curator.assign');
  IF c.id IS NULL OR c.organization_id IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'Student case is unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO prior FROM platform.audit_events WHERE request_id = p_request_id;
  IF FOUND THEN
    IF prior.organization_id IS DISTINCT FROM p_organization_id
      OR prior.action IS DISTINCT FROM 'case.direction.set'
      OR prior.resource_type IS DISTINCT FROM 'student_case'
      OR prior.resource_id IS DISTINCT FROM p_student_case_id
      OR prior.actor_membership_id IS DISTINCT FROM actor.membership_id
      OR prior.after_state ->> 'admissions_direction' IS DISTINCT FROM p_direction
      OR prior.after_state ->> 'admissions_version' IS DISTINCT FROM (p_expected_version + 1)::TEXT
    THEN
      RAISE EXCEPTION 'case_direction_request_conflict' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object(
      'organization_id', prior.organization_id, 'student_case_id', prior.resource_id,
      'admissions_direction', prior.after_state -> 'admissions_direction',
      'admissions_version', prior.after_state -> 'admissions_version',
      'changed', TRUE, 'request_id', prior.request_id, 'changed_at', prior.created_at
    );
  END IF;

  IF c.admissions_playbook_version_id IS NOT NULL THEN
    RAISE EXCEPTION 'case_direction_playbook_bound' USING ERRCODE = '22023';
  END IF;
  IF c.state = 'closed' THEN
    RAISE EXCEPTION 'case_direction_case_closed' USING ERRCODE = '22023';
  END IF;

  -- То же значение: ничего не пишется, версия и журнал остаются.
  IF c.admissions_direction IS NOT DISTINCT FROM p_direction THEN
    RETURN jsonb_build_object(
      'organization_id', c.organization_id, 'student_case_id', c.id,
      'admissions_direction', c.admissions_direction,
      'admissions_version', c.admissions_version::TEXT,
      'changed', FALSE, 'request_id', p_request_id, 'changed_at', NULL
    );
  END IF;

  IF p_expected_version <> c.admissions_version OR c.admissions_version = 9223372036854775807 THEN
    RAISE EXCEPTION 'case_direction_version_conflict' USING ERRCODE = 'PT409';
  END IF;

  UPDATE platform.student_cases
  SET admissions_direction = p_direction,
    admissions_version = admissions_version + 1
  WHERE organization_id = c.organization_id AND id = c.id
  RETURNING * INTO changed;

  -- Область «направление» роли сравнивается со столбцом: не оставляем актора
  -- перед запертой дверью (читать дело и назначать куратора ему уже нельзя).
  IF NOT (platform_private.staff_can_access(changed.organization_id, actor.membership_id,
      'case.read.full', 'student_case', changed.id)
    AND platform_private.staff_can_access(changed.organization_id, actor.membership_id,
      'case.curator.assign', 'student_case', changed.id))
  THEN
    RAISE EXCEPTION 'case_direction_actor_access_lost' USING ERRCODE = '22023';
  END IF;

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_membership_id,
    actor_principal, action, resource_type, resource_id, before_state,
    after_state, reason, request_id, resulting_version
  ) VALUES (
    c.organization_id, 'user', actor.profile_id, actor.membership_id,
    'auth:' || actor.auth_user_id::TEXT, 'case.direction.set', 'student_case', c.id,
    jsonb_build_object('admissions_direction', c.admissions_direction,
      'admissions_version', c.admissions_version::TEXT),
    jsonb_build_object('admissions_direction', changed.admissions_direction,
      'admissions_version', changed.admissions_version::TEXT),
    CASE WHEN c.admissions_direction IS NULL THEN 'Case direction set' ELSE 'Case direction changed' END,
    p_request_id, changed.admissions_version
  ) RETURNING created_at INTO recorded_at;

  -- Расписка - зафиксированная строка, а не эхо входа.
  RETURN jsonb_build_object(
    'organization_id', changed.organization_id, 'student_case_id', changed.id,
    'admissions_direction', changed.admissions_direction,
    'admissions_version', changed.admissions_version::TEXT,
    'changed', TRUE, 'request_id', p_request_id, 'changed_at', recorded_at
  );
END
$$;

REVOKE ALL ON FUNCTION platform.set_student_case_direction_v1(UUID, UUID, TEXT, BIGINT, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.set_student_case_direction_v1(UUID, UUID, TEXT, BIGINT, UUID)
  TO authenticated;
COMMENT ON FUNCTION platform.set_student_case_direction_v1(UUID, UUID, TEXT, BIGINT, UUID) IS
  '«Задать направление»: пишет только student_cases.admissions_direction (CN, MY, EUROPE, AE, TR) у дела без регламента; право case.curator.assign на деле (цепочка admissions_lock_case); ожидаемая admissions_version (+1, PT409); то же значение - расписка без записи; идемпотентна по request_id через audit_events; пишет case.direction.set. Куратор, этап, задачи, шаг, регламент и платежи не меняются.';

COMMIT;
