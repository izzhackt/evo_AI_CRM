-- 302 (на свежем origin/main последняя миграция 301; номер сверяется прямо перед слиянием):
-- смена направления дела видна в «Журнале действий» администратора и в «Истории»
-- дела. docs/PLAN_CHANGES.md «2026-10-17 · «Журнал действий» и «История» дела
-- показывают смену направления (запись до кода)».
--
-- Forward-only и аддитивно, только проекции чтения: ни таблица, ни команда 292, ни её
-- права не меняются. SECURITY DEFINER с пустым search_path у всего нового; новые и
-- переименованные функции доступны только владельцу (REVOKE ALL), как соседи 255/291.
--
-- Зачем. `platform.set_student_case_direction_v1` (292) пишет в `platform.audit_events`
-- действие `case.direction.set` (объект `student_case`; до и после - только
-- `admissions_direction` и `admissions_version`, без персональных данных), но два экрана
-- его не показывают:
--  * «Журнал действий» (`search_audit_events` / `export_audit_events`, 071) отдаёт только
--    строки, чьё действие входит в `platform_private.p7a_safe_audit_actions()`; тип
--    `student_case` в `p7a_safe_audit_resource_types()` уже есть. Безопасная строка не
--    несёт значений, поэтому «Китай -> Малайзия» ей взять неоткуда.
--  * «История» дела (`private.staff_student_case_activity`, 132/241) держит список
--    действий `student_case` в теле функции и значений до/после не отдаёт.
--
--  a) `platform_private.case_direction_change(before, after)`: берёт из двух JSONB только
--     ключ `admissions_direction` и отдаёт `{"from": <код|null>, "to": <код>}`, если оба
--     значения - из пяти направлений сотрудников (CN, MY, EUROPE, AE, TR; `from` может быть
--     пустым - первая установка) и различаются; иначе NULL. Версии и любые другие ключи
--     в проекцию не попадают; код вне пяти не выходит наружу.
--  b) Журнал. `p7a_safe_audit_actions()` получает `case.direction.set` приёмом
--     rename-and-union (255, 291). `p7a_safe_audit_row()` оборачивается тем же приёмом
--     (`..._pre_case_direction_audit`): для ЭТОГО действия строка получает ровно один
--     дополнительный ключ `case_direction` (результат (a), JSON null при неизвестном коде),
--     у всех остальных строка не меняется ни на байт - хэш набора экспорта и повторы
--     экспорта не затронуты, а строк с этим действием в прежних выгрузках не было.
--     `p7a_changed_field_codes()` не трогается: действие берёт ветку по умолчанию
--     `['record_status']`, как у 291.
--  c) «История». Тело `private.staff_student_case_activity` меняется самопроверяемой
--     заменой куска (приём 241): список действий `student_case` получает
--     `case.direction.set`, а событие этого действия, и только оно, получает ключ
--     `direction_change` (результат (a) по записи журнала события). Любой кусок, который
--     встретился не ровно один раз, откатывает миграцию. События других действий
--     остаются как были, поэтому выгрузка базы знаний (203) их не меняет. Поток по-прежнему
--     не отдаёт актора и сырые до/после.
--
-- Порядок выката. Приложение до этой правки на неизвестном действии в потоке «Истории»
-- отказывает целиком («История дела сейчас недоступна»), а в «Журнале» строку с
-- дополнительным ключом отвергает как чужую. Поэтому приложение с разбором и миграция
-- идут в одном выпуске; окно между применением миграции и выпуском должно быть
-- коротким: за это время «История» дела, в котором сменили направление, недоступна.
BEGIN;

-- ---------------------------------------------------------------------------
-- Якоря: объекты, которые меняются, существуют; тело потока «Истории» содержит
-- ровно тот текст, который заменяется ниже.
-- ---------------------------------------------------------------------------
DO $a302_anchor$
DECLARE
  activity TEXT;
BEGIN
  IF to_regprocedure('platform_private.p7a_safe_audit_actions()') IS NULL
    OR to_regprocedure('platform_private.p7a_safe_audit_row(platform.audit_events)') IS NULL
    OR to_regprocedure('platform.set_student_case_direction_v1(uuid,uuid,text,bigint,uuid)') IS NULL
    OR to_regprocedure('private.staff_student_case_activity(uuid,integer,timestamptz,uuid)') IS NULL
    OR to_regclass('platform.audit_events') IS NULL
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'platform' AND c.table_name = 'audit_events' AND c.column_name = 'before_state')
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'platform' AND c.table_name = 'audit_events' AND c.column_name = 'after_state')
  THEN
    RAISE EXCEPTION 'a302_anchor_drift';
  END IF;
  activity := pg_get_functiondef('private.staff_student_case_activity(uuid,integer,timestamptz,uuid)'::regprocedure);
  IF (length(activity) - length(replace(activity, $x$'case.next.action.change']::TEXT[])$x$, '')))
        / length($x$'case.next.action.change']::TEXT[])$x$) <> 1
    OR (length(activity) - length(replace(activity,
        $x$) ORDER BY created_at DESC, id DESC) FILTER (WHERE ordinal <= p_limit)$x$, '')))
        / length($x$) ORDER BY created_at DESC, id DESC) FILTER (WHERE ordinal <= p_limit)$x$) <> 1
    OR strpos(activity, 'case.direction.set') > 0
  THEN
    RAISE EXCEPTION 'a302_activity_anchor_drift';
  END IF;
END
$a302_anchor$;

-- ---------------------------------------------------------------------------
-- a) Смена направления из записи журнала: только коды пяти направлений
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.case_direction_change(p_before JSONB, p_after JSONB)
RETURNS JSONB LANGUAGE SQL IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_after ->> 'admissions_direction' IN ('CN', 'MY', 'EUROPE', 'AE', 'TR')
      AND (p_before ->> 'admissions_direction' IS NULL
        OR p_before ->> 'admissions_direction' IN ('CN', 'MY', 'EUROPE', 'AE', 'TR'))
      AND p_before ->> 'admissions_direction' IS DISTINCT FROM p_after ->> 'admissions_direction'
    THEN jsonb_build_object(
      'from', p_before ->> 'admissions_direction',
      'to', p_after ->> 'admissions_direction')
  END
$$;
REVOKE ALL ON FUNCTION platform_private.case_direction_change(JSONB, JSONB)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
COMMENT ON FUNCTION platform_private.case_direction_change(JSONB, JSONB) IS
  'Migration 302: {from, to} of the case direction from an audit before/after pair; only the five staff direction codes (CN, MY, EUROPE, AE, TR) pass, from may be NULL (first set), anything else is NULL. Pure; owner-only.';

-- ---------------------------------------------------------------------------
-- b) «Журнал действий»: действие в allowlist и одно поле у его строки
-- ---------------------------------------------------------------------------
ALTER FUNCTION platform_private.p7a_safe_audit_actions()
  RENAME TO p7a_safe_audit_actions_pre_case_direction_audit;
CREATE FUNCTION platform_private.p7a_safe_audit_actions()
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.array_agg(DISTINCT allowed.action ORDER BY allowed.action)
  FROM pg_catalog.unnest(
    platform_private.p7a_safe_audit_actions_pre_case_direction_audit()
      || ARRAY[
    'case.direction.set'
      ]::TEXT[]
  ) AS allowed(action)
$$;

ALTER FUNCTION platform_private.p7a_safe_audit_row(platform.audit_events)
  RENAME TO p7a_safe_audit_row_pre_case_direction_audit;
CREATE FUNCTION platform_private.p7a_safe_audit_row(p_event platform.audit_events)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN platform_private.p7a_safe_audit_row_pre_case_direction_audit(p_event)
    || CASE WHEN p_event.action = 'case.direction.set' THEN
      jsonb_build_object('case_direction',
        platform_private.case_direction_change(p_event.before_state, p_event.after_state))
    ELSE '{}'::JSONB END;
END
$$;

REVOKE ALL ON FUNCTION
  platform_private.p7a_safe_audit_actions_pre_case_direction_audit(),
  platform_private.p7a_safe_audit_actions()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION
  platform_private.p7a_safe_audit_row_pre_case_direction_audit(platform.audit_events),
  platform_private.p7a_safe_audit_row(platform.audit_events)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- c) «История» дела: действие в список и поле у его события
-- ---------------------------------------------------------------------------
DO $a302_activity$
DECLARE original TEXT; body TEXT;
BEGIN
  original := pg_get_functiondef(
    'private.staff_student_case_activity(uuid,integer,timestamptz,uuid)'::regprocedure
  );
  body := replace(
    original,
    $old$'case.next.action.change']::TEXT[])$old$,
    $new$'case.next.action.change','case.direction.set']::TEXT[])$new$
  );
  body := replace(
    body,
    $old$) ORDER BY created_at DESC, id DESC) FILTER (WHERE ordinal <= p_limit)$old$,
    $new$) || CASE WHEN action = 'case.direction.set' THEN jsonb_build_object('direction_change',
        (SELECT platform_private.case_direction_change(direction_event.before_state, direction_event.after_state)
         FROM platform.audit_events AS direction_event
         WHERE direction_event.organization_id = actor.organization_id AND direction_event.id = numbered.id))
      ELSE '{}'::JSONB END
      ORDER BY created_at DESC, id DESC) FILTER (WHERE ordinal <= p_limit)$new$
  );
  IF body = original
    OR (length(body) - length(replace(body, $chk$'case.direction.set'$chk$, '')))
      / length($chk$'case.direction.set'$chk$) <> 2
    OR (length(body) - length(replace(body, $chk$'direction_change'$chk$, '')))
      / length($chk$'direction_change'$chk$) <> 1
  THEN
    RAISE EXCEPTION 'staff_student_case_activity_source_anchor_drift';
  END IF;
  EXECUTE body;
END
$a302_activity$;

-- ---------------------------------------------------------------------------
-- Проверка в конце: действие в allowlist, помощник и обёртки живы, поток собран.
-- ---------------------------------------------------------------------------
DO $a302_verify$
BEGIN
  IF NOT ('case.direction.set' = ANY (platform_private.p7a_safe_audit_actions()))
    OR 'case.direction.set' = ANY (platform_private.p7a_safe_audit_actions_pre_case_direction_audit())
    OR platform_private.case_direction_change('{"admissions_direction":"CN","admissions_version":"0"}'::JSONB,
         '{"admissions_direction":"MY","admissions_version":"1"}'::JSONB) IS DISTINCT FROM '{"from":"CN","to":"MY"}'::JSONB
    OR platform_private.case_direction_change('{"admissions_direction":null,"admissions_version":"0"}'::JSONB,
         '{"admissions_direction":"AE","admissions_version":"1"}'::JSONB) IS DISTINCT FROM '{"from":null,"to":"AE"}'::JSONB
    OR platform_private.case_direction_change('{"admissions_direction":"CN"}'::JSONB,
         '{"admissions_direction":"IT"}'::JSONB) IS NOT NULL
    OR platform_private.case_direction_change('{"admissions_direction":"IT"}'::JSONB,
         '{"admissions_direction":"CN"}'::JSONB) IS NOT NULL
    OR platform_private.case_direction_change('{"admissions_direction":"CN"}'::JSONB,
         '{"admissions_direction":"CN"}'::JSONB) IS NOT NULL
    OR platform_private.case_direction_change(NULL, NULL) IS NOT NULL
  THEN
    RAISE EXCEPTION 'a302_verify_failed' USING ERRCODE = '55000';
  END IF;
END
$a302_verify$;

COMMIT;
