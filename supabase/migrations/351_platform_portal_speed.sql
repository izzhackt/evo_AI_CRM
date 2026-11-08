-- ============================================================
-- 351_platform_portal_speed.sql
--
-- Скорость кабинета и CRM (отзыв владельца 07.11.2026: «app.evoadmissions.com — kinda slow & maybe sql optimization»).
-- Хуки набора в `scripts/test-runners/test-postgres-authorization.sh` привязаны к имени файла.
--
-- Что измерено на боевой базе (pg_stat_statements и EXPLAIN в откатываемой транзакции, 08.11.2026): таблицы крошечные
-- (до 207 дел, 10 участников), объём данных не причина. Время уходит на цепочку маленьких функций проверки доступа,
-- написанных на `LANGUAGE sql` с SECURITY DEFINER и `SET search_path`: такие функции не встраиваются, а PostgreSQL
-- разбирает и планирует их запрос заново при КАЖДОМ вызове. Один опрос колокольчика сотрудника вызывал проверку доступа
-- 982 раза (9 секунд у администратора), очередь «Студенты» считает её по каждому делу, `staff_access_snapshot`
-- (каждый запрос CRM) — по каждому из 91 права. `current_actor_authority` вдобавок звала `staff_membership_identity`
-- для всех участников, а не только для участника из токена (17 584 вызова за один прогон).
--
-- Что делает миграция (только производительность; права и решения о доступе те же):
--  1. 15 функций цепочки доступа переписаны с `LANGUAGE sql` на `LANGUAGE plpgsql`: тот же запрос в теле, те же
--     подпись, SECURITY DEFINER, STABLE, search_path и права; план кэшируется на соединение. У функций с
--     `RETURNS TABLE` стоит `#variable_conflict use_column`, чтобы имена выходных колонок не перекрывали колонки таблиц.
--  2. `current_actor_authority`: условия по участнику из токена (id и организация) поставлены и на сам участник `m`,
--     поэтому `staff_membership_identity` считается для одной строки, а не для каждой. Результат тот же: строка identity
--     строится из той же строки `m`.
--  3. `staff_notifications_page_v2`: новая закрытая `staff_notification_visible_as` без повторного поиска актора.
--     Страница уже доказала, что актор: сотрудник и получатель; остальное тело проверки видимости дословно прежнее.
--  4. `staff_access_snapshot`: права считаются одним проходом по `permission_definitions` (тело `staff_has_permission`
--     в запросе), а не вызовом функции на каждое право. Личность участника уже выбрана выше.
--  5. `student_portal_cases`: до вызова проверки добавлены дешёвые условия, которые она сама требует (кабинет открыт,
--     состояние дела): с 207 вызовов на запрос остаётся 5. Это самый частый вызов proxy кабинета.
--
-- Защита от дрейфа: у каждой переписываемой функции закреплена md5 боевого `prosrc`; расхождение прерывает миграцию,
-- ничего не меняя. У функций с точечной правкой фрагмент обязан встретиться ровно столько раз, сколько ожидается.
-- CREATE OR REPLACE сохраняет владельца и права. Forward-only: повтор отказывает a351_already_applied.
-- ============================================================

BEGIN;

DO $a351_guard$
DECLARE pinned RECORD; actual TEXT;
BEGIN
  IF (SELECT l.lanname FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
      WHERE p.oid = 'platform_private.staff_has_permission(uuid,uuid,text)'::regprocedure) = 'plpgsql' THEN
    RAISE EXCEPTION 'a351_already_applied' USING ERRCODE = '55000';
  END IF;
  FOR pinned IN SELECT * FROM (VALUES
    ('platform.current_actor_authority', 'cf589e34b195b1a9d7bc47c8f838a773'),
    ('platform_private.latest_membership_permission_grant', '12884b1560c59c7ff84b163d5f4683e0'),
    ('platform_private.staff_access_evaluate', '89536bd904e1631fda1b264dc053c505'),
    ('platform_private.staff_can_access', 'a4a97f1fc1bbc1979dd22ee287768fc7'),
    ('platform_private.staff_can_access_for_actor', 'b938af689a78e6e5f9fff08c0b98db65'),
    ('platform_private.staff_context_can_access', 'f354be0f66ddcc6953bc89dabe286315'),
    ('platform_private.staff_has_permission', '2184ba936ea0fa1489cb4b182fcbd96e'),
    ('platform_private.staff_membership_identity', '50bcf36620d2806d48387c5896513ff1'),
    ('platform_private.student_actor_pre_scoped_roles', '4b30f3ef64fe79ac7e5cac2b0769fe7c'),
    ('private.platform_can_read_student_case', 'a567284eb05c0865152d913062775292'),
    ('private.platform_can_read_student_portal_case', 'e6a361e34f16d30845cef3714517cd44'),
    ('private.platform_has_permission', '33131194bbdea2d552a6b7dfd6a4e7e0'),
    ('private.platform_has_scope', '3a5446ef2b986880f984f37a30d78373'),
    ('private.student_has_permission_pre_scoped_roles', '1ab21cd1f7d900ea6c709d9053cccf8d'),
    ('private.student_has_scope_pre_scoped_roles', '5b6d8d873a6fcafd623bfc31c19be280'),
    ('platform.staff_access_snapshot', '8660595c5edd4f7779d80c2e2458ac9c'),
    ('platform.staff_notifications_page_v2', '3487d2e2311409da493a6267ac97a697'),
    ('platform.student_portal_cases', 'fc4c9a9f47c1638fd0270f90b13637bf')
  ) AS t(name, source_md5) LOOP
    SELECT md5(p.prosrc) INTO actual FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname || '.' || p.proname = pinned.name;
    IF actual IS DISTINCT FROM pinned.source_md5 THEN
      RAISE EXCEPTION 'a351_drift: % has % (expected %)', pinned.name, actual, pinned.source_md5;
    END IF;
  END LOOP;
END
$a351_guard$;

CREATE FUNCTION pg_temp.a351_replace(p_signature TEXT, p_old TEXT, p_new TEXT, p_count INTEGER)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE body TEXT; matches INTEGER;
BEGIN
  body := pg_get_functiondef(to_regprocedure(p_signature));
  matches := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  IF body IS NULL OR matches IS DISTINCT FROM p_count THEN
    RAISE EXCEPTION 'a351_replace_drift: % expected %, found %', p_signature, p_count, matches;
  END IF;
  EXECUTE replace(body, p_old, p_new);
END $$;

-- 1–2. Цепочка проверки доступа: тот же запрос, но план кэшируется; current_actor_authority считает одну личность.

CREATE OR REPLACE FUNCTION platform.current_actor_authority()
 RETURNS TABLE(auth_user_id uuid, profile_id uuid, membership_id uuid, organization_id uuid, display_name text, platform_role platform.business_role, platform_access_version bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
BEGIN
 RETURN QUERY
SELECT i.auth_user_id,i.profile_id,i.membership_id,i.organization_id,i.display_name,i.coarse_role,i.access_version
 FROM platform.organization_memberships m JOIN platform_private.staff_membership_identity(m.organization_id,m.id) i ON TRUE
 WHERE m.id::TEXT=(SELECT auth.jwt()->>'platform_membership_id')
 AND m.organization_id::TEXT=(SELECT auth.jwt()->>'platform_organization_id')
 AND i.auth_user_id=(SELECT auth.uid())
 AND i.membership_id::TEXT=(SELECT auth.jwt()->>'platform_membership_id')
 AND i.organization_id::TEXT=(SELECT auth.jwt()->>'platform_organization_id')
 UNION ALL SELECT s.* FROM platform_private.student_actor_pre_scoped_roles() s
 WHERE s.platform_role='student';
END
$function$;

CREATE OR REPLACE FUNCTION platform_private.latest_membership_permission_grant(p_organization_id uuid, p_membership_id uuid, p_permission_key text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 RETURN (
SELECT COALESCE((
    SELECT event.granted
    FROM platform.membership_permission_events AS event
    WHERE event.organization_id = p_organization_id
      AND event.membership_id = p_membership_id
      AND event.permission_key = p_permission_key
    ORDER BY event.permission_version DESC
    LIMIT 1
  ), FALSE)
 );
END
$function$;

CREATE OR REPLACE FUNCTION platform_private.staff_access_evaluate(p_organization_id uuid, p_membership_id uuid, p_permission_key text, p_resource_kind text, p_resource_id uuid, p_receiving_assignment boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 RETURN (
WITH contexts AS (
  SELECT * FROM platform_private.staff_resource_context(p_organization_id,p_permission_key,p_resource_kind,p_resource_id)
  UNION ALL SELECT p_membership_id,NULL::UUID,NULL::TEXT WHERE p_receiving_assignment AND p_resource_id IS NULL
   AND p_resource_kind IN ('lead','staff_task','sales_register')
  UNION ALL SELECT p_membership_id,NULL::UUID,NULL::TEXT WHERE NOT p_receiving_assignment
   AND p_resource_kind='conversation'
   AND p_permission_key IN ('communication.read.full','communication.manual.send')
   AND EXISTS(SELECT 1 FROM platform.communication_conversations team_inbox
    WHERE team_inbox.organization_id=p_organization_id AND team_inbox.id=p_resource_id
    AND team_inbox.queue='sales')
 )
 SELECT EXISTS(SELECT 1 FROM contexts c
 WHERE (NOT p_receiving_assignment OR p_resource_kind IN ('lead','student_case','application','visa_case','task','staff_task','sales_register'))
 AND platform_private.staff_context_can_access(p_organization_id,p_membership_id,p_permission_key,p_resource_kind,p_resource_id,
 CASE WHEN p_receiving_assignment THEN p_membership_id ELSE c.owner_membership_id END,c.student_case_id,c.direction))
 );
END
$function$;

CREATE OR REPLACE FUNCTION platform_private.staff_can_access(p_organization_id uuid, p_membership_id uuid, p_permission_key text, p_resource_kind text, p_resource_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 RETURN (
SELECT platform_private.staff_access_evaluate(p_organization_id,p_membership_id,p_permission_key,p_resource_kind,p_resource_id,FALSE)
 );
END
$function$;

CREATE OR REPLACE FUNCTION platform_private.staff_can_access_for_actor(p_organization_id uuid, p_permission_key text, p_resource_kind text, p_resource_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 RETURN (
SELECT EXISTS(SELECT 1 FROM platform.current_actor_authority() a WHERE a.organization_id=p_organization_id
 AND platform_private.staff_can_access(a.organization_id,a.membership_id,p_permission_key,p_resource_kind,p_resource_id))
 );
END
$function$;

CREATE OR REPLACE FUNCTION platform_private.staff_context_can_access(p_organization_id uuid, p_membership_id uuid, p_permission_key text, p_resource_kind text, p_resource_id uuid, p_owner_membership_id uuid, p_student_case_id uuid, p_direction text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 RETURN (
SELECT EXISTS(SELECT 1 FROM platform_private.staff_membership_identity(p_organization_id,p_membership_id) i
 JOIN platform.permission_definitions d ON d.permission_key=p_permission_key
 WHERE p_resource_kind=ANY(d.staff_resource_kinds)
 AND platform_private.staff_has_permission(p_organization_id,p_membership_id,p_permission_key)
 AND CASE WHEN d.staff_sensitive THEN TRUE WHEN i.system_role='admin' THEN TRUE ELSE
 EXISTS(SELECT 1 FROM platform.staff_role_assignments a
 JOIN platform.staff_role_definitions r ON r.organization_id=a.organization_id AND r.id=a.role_id
  AND r.status='active' AND r.current_bundle_id=a.bundle_id
 JOIN platform.role_bundle_versions b ON b.id=a.bundle_id AND b.status='published'
 JOIN platform.role_bundle_permissions bp ON bp.bundle_id=a.bundle_id AND bp.permission_key=p_permission_key
 WHERE a.organization_id=p_organization_id AND a.membership_id=p_membership_id AND a.revoked_at IS NULL
 AND a.scope_kind=ANY(d.staff_scope_kinds) AND CASE a.scope_kind
 WHEN 'organization' THEN a.scope_key=p_organization_id::TEXT
 WHEN 'own' THEN p_owner_membership_id=p_membership_id
 WHEN 'department' THEN EXISTS(SELECT 1 FROM platform.staff_organizational_details od
  JOIN platform.staff_departments dept ON dept.organization_id=od.organization_id AND dept.id=od.department_id AND dept.status='active'
  WHERE od.organization_id=p_organization_id AND od.membership_id=p_owner_membership_id AND dept.id::TEXT=a.scope_key)
 WHEN 'direction' THEN p_direction IS NOT NULL AND p_direction=a.scope_key
 WHEN 'record' THEN (a.resource_kind=p_resource_kind AND a.scope_key=p_resource_id::TEXT)
  OR (a.resource_kind='student_case' AND a.scope_key=p_student_case_id::TEXT)
 ELSE FALSE END) END)
 );
END
$function$;

CREATE OR REPLACE FUNCTION platform_private.staff_has_permission(p_organization_id uuid, p_membership_id uuid, p_permission_key text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 RETURN (
SELECT EXISTS(SELECT 1 FROM platform_private.staff_membership_identity(p_organization_id,p_membership_id) i
 JOIN platform.permission_definitions d ON d.permission_key=p_permission_key
 WHERE cardinality(d.staff_resource_kinds)>0 AND CASE
 WHEN d.staff_sensitive THEN (p_permission_key<>'admissions.handoff.gate.override' OR i.system_role='admin')
 AND platform_private.latest_membership_permission_grant(p_organization_id,p_membership_id,
 CASE WHEN p_permission_key='finance.event.confirm' THEN 'finance.first.payment.confirm' ELSE p_permission_key END)
 WHEN i.system_role='admin' THEN TRUE
 WHEN d.staff_system_only THEN FALSE
 ELSE EXISTS(SELECT 1 FROM platform.staff_role_assignments a
 JOIN platform.staff_role_definitions r ON r.organization_id=a.organization_id AND r.id=a.role_id AND r.status='active'
 JOIN platform.role_bundle_versions b ON b.id=a.bundle_id AND b.status='published'
 JOIN platform.role_bundle_permissions bp ON bp.bundle_id=b.id AND bp.permission_key=p_permission_key
 WHERE a.organization_id=p_organization_id AND a.membership_id=p_membership_id AND a.revoked_at IS NULL
 AND r.current_bundle_id=a.bundle_id) END)
 );
END
$function$;

CREATE OR REPLACE FUNCTION platform_private.staff_membership_identity(p_organization_id uuid, p_membership_id uuid)
 RETURNS TABLE(auth_user_id uuid, profile_id uuid, membership_id uuid, organization_id uuid, display_name text, system_role text, access_version bigint, coarse_role platform.business_role)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
BEGIN
 RETURN QUERY
SELECT p.auth_user_id,p.id,m.id,m.organization_id,p.display_name,
 CASE WHEN m.is_system_admin THEN 'admin' ELSE 'staff' END,p.access_version,
 CASE WHEN m.is_system_admin THEN 'admin'::platform.business_role
 WHEN m."current_role"='admin' THEN NULL::platform.business_role ELSE m."current_role" END
 FROM platform.organization_memberships m JOIN platform.profiles p ON p.id=m.profile_id
 JOIN platform.organizations o ON o.id=m.organization_id
 WHERE m.organization_id=p_organization_id AND m.id=p_membership_id
 AND m.status='active' AND p.status='active' AND o.status='active'
 AND m."current_role" IS DISTINCT FROM 'student';
END
$function$;

CREATE OR REPLACE FUNCTION platform_private.student_actor_pre_scoped_roles()
 RETURNS TABLE(auth_user_id uuid, profile_id uuid, membership_id uuid, organization_id uuid, display_name text, platform_role platform.business_role, platform_access_version bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
BEGIN
 RETURN QUERY
WITH caller AS MATERIALIZED (
    SELECT
      auth.uid() AS auth_user_id,
      auth.jwt() ->> 'platform_role' AS platform_role,
      auth.jwt() ->> 'platform_access_version' AS platform_access_version,
      auth.jwt() ->> 'platform_organization_id' AS organization_id,
      auth.jwt() ->> 'platform_membership_id' AS membership_id,
      auth.jwt() ->> 'platform_bundle_id' AS bundle_id,
      auth.jwt() ->> 'platform_bundle_version' AS bundle_version
  ),
  active_authorities AS MATERIALIZED (
    SELECT
      profile.auth_user_id,
      profile.id AS profile_id,
      membership.id AS membership_id,
      membership.organization_id,
      profile.display_name,
      membership."current_role" AS platform_role,
      profile.access_version AS platform_access_version
    FROM caller
    JOIN platform.profiles AS profile
      ON profile.auth_user_id = caller.auth_user_id
    JOIN platform.organization_memberships AS membership
      ON membership.profile_id = profile.id
    JOIN platform.organizations AS organization
      ON organization.id = membership.organization_id
    JOIN platform.role_bundle_versions AS bundle
      ON bundle.id = membership.current_bundle_id
      AND bundle.role = membership."current_role"
    WHERE caller.auth_user_id IS NOT NULL
      AND profile.status = 'active'
      AND membership.status = 'active'
      AND membership."current_role" IN ('admin', 'sales', 'curator', 'student')
      AND organization.status = 'active'
      AND bundle.status = 'published'
      AND membership."current_role"::TEXT = caller.platform_role
      AND profile.access_version::TEXT = caller.platform_access_version
      AND membership.organization_id::TEXT = caller.organization_id
      AND membership.id::TEXT = caller.membership_id
      AND bundle.id::TEXT = caller.bundle_id
      AND bundle.version::TEXT = caller.bundle_version
  )
  SELECT
    authority.auth_user_id,
    authority.profile_id,
    authority.membership_id,
    authority.organization_id,
    authority.display_name,
    authority.platform_role,
    authority.platform_access_version
  FROM active_authorities AS authority
  WHERE (SELECT count(*) FROM active_authorities) = 1
    AND private.platform_has_permission(
      authority.organization_id,
      'organization.read'
    )
    AND private.platform_has_scope(
      authority.organization_id,
      'organization'::platform.scope_kind,
      authority.organization_id
    );
END
$function$;

CREATE OR REPLACE FUNCTION private.platform_can_read_student_case(p_organization_id uuid, p_student_case_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 RETURN (
SELECT CASE
    WHEN platform_private.staff_can_access_for_actor(
      p_organization_id, 'case.read.full', 'student_case', p_student_case_id) THEN TRUE
    -- 248: a needs-curator case also reads for the staff member who may
    -- assign it (owner decision B); students never match.
    ELSE EXISTS (
      SELECT 1 FROM platform.current_actor_authority() AS a
      WHERE a.organization_id = p_organization_id AND a.platform_role IS DISTINCT FROM 'student'
        AND platform_private.staff_can_take_needs_curator_case(a.organization_id, a.membership_id, p_student_case_id))
  END
 );
END
$function$;

CREATE OR REPLACE FUNCTION private.platform_can_read_student_portal_case(p_organization_id uuid, p_student_case_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 RETURN (
SELECT EXISTS (
    SELECT 1
    FROM platform.student_cases AS student_case
    JOIN platform.organization_memberships AS membership
      ON membership.organization_id = student_case.organization_id
      AND membership.id = student_case.student_membership_id
    JOIN platform.profiles AS profile
      ON profile.id = membership.profile_id
    WHERE student_case.organization_id = p_organization_id
      AND student_case.id = p_student_case_id
      AND profile.auth_user_id = (SELECT auth.uid())
      AND membership."current_role" = 'student'
      AND student_case.state IN ('pending', 'active', 'closed')
      AND student_case.portal_activated_at IS NOT NULL
      AND private.platform_has_permission(
        student_case.organization_id,
        'portal.read.self'
      )
      AND private.platform_has_scope(
        student_case.organization_id,
        'student_case',
        student_case.id
      )
  )
 );
END
$function$;

CREATE OR REPLACE FUNCTION private.platform_has_permission(p_organization_id uuid, p_permission_key text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 RETURN (
SELECT CASE WHEN EXISTS(SELECT 1 FROM platform.organization_memberships m JOIN platform.profiles p ON p.id=m.profile_id
 WHERE m.organization_id=p_organization_id AND p.auth_user_id=(SELECT auth.uid()) AND m."current_role"='student')
 THEN private.student_has_permission_pre_scoped_roles(p_organization_id,p_permission_key)
 ELSE EXISTS(SELECT 1 FROM platform.organization_memberships m JOIN platform.profiles p ON p.id=m.profile_id
 WHERE m.organization_id=p_organization_id AND p.auth_user_id=(SELECT auth.uid())
 AND m.id::TEXT=(SELECT auth.jwt()->>'platform_membership_id')
 AND m.organization_id::TEXT=(SELECT auth.jwt()->>'platform_organization_id')
 AND platform_private.staff_has_permission(m.organization_id,m.id,p_permission_key)) END
 );
END
$function$;

CREATE OR REPLACE FUNCTION private.platform_has_scope(p_organization_id uuid, p_scope_kind platform.scope_kind, p_scope_key uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 RETURN (
SELECT CASE WHEN EXISTS(SELECT 1 FROM platform.organization_memberships m JOIN platform.profiles p ON p.id=m.profile_id
 WHERE m.organization_id=p_organization_id AND p.auth_user_id=(SELECT auth.uid()) AND m."current_role"='student')
 THEN private.student_has_scope_pre_scoped_roles(p_organization_id,p_scope_kind,p_scope_key)
 -- An unpaired legacy scope cannot prove a staff business action.
 ELSE EXISTS(SELECT 1 FROM platform.organization_memberships m
 JOIN platform_private.staff_membership_identity(m.organization_id,m.id) i ON TRUE
 WHERE m.organization_id=p_organization_id AND i.auth_user_id=(SELECT auth.uid()) AND i.system_role='admin'
 AND m.id::TEXT=(SELECT auth.jwt()->>'platform_membership_id')
 AND m.organization_id::TEXT=(SELECT auth.jwt()->>'platform_organization_id')
 AND p_scope_kind='organization' AND p_scope_key=p_organization_id) END
 );
END
$function$;

CREATE OR REPLACE FUNCTION private.student_has_permission_pre_scoped_roles(p_organization_id uuid, p_permission_key text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 RETURN (
SELECT EXISTS (
    SELECT 1
    FROM platform.profiles AS profile
    JOIN platform.organization_memberships AS membership
      ON membership.profile_id = profile.id
    JOIN platform.organizations AS organization
      ON organization.id = membership.organization_id
    JOIN platform.role_bundle_versions AS bundle
      ON bundle.id = membership.current_bundle_id
      AND bundle.role = membership."current_role"
    WHERE profile.auth_user_id = (SELECT auth.uid())
      AND profile.status = 'active'
      AND membership.organization_id = p_organization_id
      AND membership.status = 'active'
      AND membership."current_role" IN ('admin', 'sales', 'curator', 'student')
      AND organization.status = 'active'
      AND bundle.status = 'published'
      AND membership."current_role"::TEXT =
        (SELECT auth.jwt() ->> 'platform_role')
      AND profile.access_version::TEXT =
        (SELECT auth.jwt() ->> 'platform_access_version')
      AND membership.organization_id::TEXT =
        (SELECT auth.jwt() ->> 'platform_organization_id')
      AND membership.id::TEXT =
        (SELECT auth.jwt() ->> 'platform_membership_id')
      AND bundle.id::TEXT =
        (SELECT auth.jwt() ->> 'platform_bundle_id')
      AND bundle.version::TEXT =
        (SELECT auth.jwt() ->> 'platform_bundle_version')
      AND (
        (
          p_permission_key = 'contract.evidence.confirm'
          AND membership."current_role" IN ('admin', 'sales', 'curator')
          AND platform_private.latest_membership_permission_grant(
            membership.organization_id,
            membership.id,
            'contract.evidence.confirm'
          )
        )
        OR (
          p_permission_key IN (
            'finance.event.confirm',
            'finance.first.payment.confirm'
          )
          AND membership."current_role" IN ('admin', 'sales', 'curator')
          AND platform_private.latest_membership_permission_grant(
            membership.organization_id,
            membership.id,
            'finance.first.payment.confirm'
          )
        )
        OR (
          p_permission_key = 'admissions.handoff.gate.override'
          AND membership."current_role" = 'admin'
          AND platform_private.latest_membership_permission_grant(
            membership.organization_id,
            membership.id,
            'admissions.handoff.gate.override'
          )
        )
        OR (
          p_permission_key NOT IN (
            'contract.evidence.confirm',
            'finance.event.confirm',
            'finance.first.payment.confirm',
            'admissions.handoff.gate.override'
          )
          AND EXISTS (
            SELECT 1
            FROM platform.role_bundle_permissions AS bundle_permission
            WHERE bundle_permission.bundle_id = bundle.id
              AND bundle_permission.bundle_role = bundle.role
              AND bundle_permission.permission_key = p_permission_key
          )
        )
      )
  )
 );
END
$function$;

CREATE OR REPLACE FUNCTION private.student_has_scope_pre_scoped_roles(p_organization_id uuid, p_scope_kind platform.scope_kind, p_scope_key uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 RETURN (
SELECT EXISTS (
    SELECT 1
    FROM platform.profiles AS profile
    JOIN platform.organization_memberships AS membership
      ON membership.profile_id = profile.id
    JOIN platform.organizations AS organization
      ON organization.id = membership.organization_id
    JOIN platform.role_bundle_versions AS bundle
      ON bundle.id = membership.current_bundle_id
      AND bundle.role = membership."current_role"
    JOIN platform.record_scopes AS scope
      ON scope.organization_id = membership.organization_id
      AND scope.scope_kind = p_scope_kind
      AND scope.scope_key = p_scope_key
      AND scope.is_active
    JOIN platform.membership_scope_assignments AS assignment
      ON assignment.organization_id = membership.organization_id
      AND assignment.membership_id = membership.id
      AND assignment.scope_id = scope.id
      AND assignment.scope_version = scope.scope_version
    WHERE profile.auth_user_id = (SELECT auth.uid())
      AND profile.status = 'active'
      AND membership.organization_id = p_organization_id
      AND membership.status = 'active'
      AND membership."current_role" IN ('admin', 'sales', 'curator', 'student')
      AND organization.status = 'active'
      AND bundle.status = 'published'
      AND membership."current_role"::TEXT =
        (SELECT auth.jwt() ->> 'platform_role')
      AND profile.access_version::TEXT =
        (SELECT auth.jwt() ->> 'platform_access_version')
      AND membership.organization_id::TEXT =
        (SELECT auth.jwt() ->> 'platform_organization_id')
      AND membership.id::TEXT =
        (SELECT auth.jwt() ->> 'platform_membership_id')
      AND bundle.id::TEXT =
        (SELECT auth.jwt() ->> 'platform_bundle_id')
      AND bundle.version::TEXT =
        (SELECT auth.jwt() ->> 'platform_bundle_version')
      AND assignment.granted
      AND NOT EXISTS (
        SELECT 1
        FROM platform.membership_scope_assignments AS later_assignment
        WHERE later_assignment.organization_id = assignment.organization_id
          AND later_assignment.membership_id = assignment.membership_id
          AND later_assignment.scope_id = assignment.scope_id
          AND later_assignment.assignment_version > assignment.assignment_version
      )
  )
 );
END
$function$;

-- 3. Видимость уведомления для актора, уже установленного вызывающей функцией. Тело дословно прежнее
--    `staff_notification_visible`, но `a.membership_id` заменён параметром (актор = получатель, проверяется первым
--    условием); закрыта так же, как оригинал: только владелец (postgres) и вызовы из SECURITY DEFINER функций.
CREATE FUNCTION platform_private.staff_notification_visible_as(n platform.staff_notifications, p_membership_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  RETURN n.recipient_membership_id = p_membership_id AND (
    (n.staff_task_id IS NOT NULL AND platform_private.staff_can_access(
      n.organization_id, p_membership_id, 'staff.task.read', 'staff_task', n.staff_task_id))
    OR (n.message_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM platform.team_chat_messages m
      WHERE m.organization_id = n.organization_id AND m.id = n.message_id
        AND m.deleted_at IS NULL AND p_membership_id = ANY(m.mentioned_membership_ids)
        AND platform_private.team_chat_can_access(n.organization_id, m.channel_key)))
    OR (n.kind = 'case_help' AND platform_private.staff_can_access(
      n.organization_id, p_membership_id, 'case.read.full', 'student_case', n.student_case_id))
    OR (n.case_task_id IS NOT NULL AND n.kind IN ('case_task_assigned', 'task_due') AND EXISTS (
      SELECT 1 FROM platform.case_tasks t
      WHERE t.organization_id = n.organization_id AND t.id = n.case_task_id
        AND (t.assignee_membership_id = p_membership_id OR platform_private.staff_can_access(
          n.organization_id, p_membership_id, 'case.read.full', 'student_case', t.student_case_id))))
    OR (n.kind = 'case_message' AND platform_private.staff_can_access(
      n.organization_id, p_membership_id, 'case.read.full', 'student_case', n.student_case_id))
  );
END
$function$;
REVOKE ALL ON FUNCTION platform_private.staff_notification_visible_as(platform.staff_notifications, uuid) FROM PUBLIC;

SELECT pg_temp.a351_replace('platform.staff_notifications_page_v2(uuid,timestamp with time zone,uuid)',
  $old$AND n.read_at IS NULL AND platform_private.staff_notification_visible(n);$old$,
  $new$AND n.read_at IS NULL AND platform_private.staff_notification_visible_as(n, actor.membership_id);$new$, 1);
SELECT pg_temp.a351_replace('platform.staff_notifications_page_v2(uuid,timestamp with time zone,uuid)',
  $old$AND platform_private.staff_notification_visible(n)
      AND (p_before_at IS NULL$old$,
  $new$AND platform_private.staff_notification_visible_as(n, actor.membership_id)
      AND (p_before_at IS NULL$new$, 1);

-- 4. staff_access_snapshot: тело staff_has_permission, вычисленное в одном запросе. Личность (identity) участника уже
--    в `actor` (выбрана из той же staff_membership_identity), поэтому её JOIN из staff_has_permission не нужен.
SELECT pg_temp.a351_replace('platform.staff_access_snapshot()',
  $old$FROM platform.permission_definitions d WHERE platform_private.staff_has_permission(actor.organization_id,actor.membership_id,d.permission_key);$old$,
  $new$FROM platform.permission_definitions d WHERE cardinality(d.staff_resource_kinds)>0 AND CASE
 WHEN d.staff_sensitive THEN (d.permission_key<>'admissions.handoff.gate.override' OR actor.system_role='admin')
 AND platform_private.latest_membership_permission_grant(actor.organization_id,actor.membership_id,
 CASE WHEN d.permission_key='finance.event.confirm' THEN 'finance.first.payment.confirm' ELSE d.permission_key END)
 WHEN actor.system_role='admin' THEN TRUE
 WHEN d.staff_system_only THEN FALSE
 ELSE EXISTS(SELECT 1 FROM platform.staff_role_assignments a
 JOIN platform.staff_role_definitions r ON r.organization_id=a.organization_id AND r.id=a.role_id AND r.status='active'
 JOIN platform.role_bundle_versions b ON b.id=a.bundle_id AND b.status='published'
 JOIN platform.role_bundle_permissions bp ON bp.bundle_id=b.id AND bp.permission_key=d.permission_key
 WHERE a.organization_id=actor.organization_id AND a.membership_id=actor.membership_id AND a.revoked_at IS NULL
 AND r.current_bundle_id=a.bundle_id) END;$new$, 1);

-- 5. student_portal_cases: дешёвые условия, которые функция проверки сама требует, идут до неё.
SELECT pg_temp.a351_replace('platform.student_portal_cases()',
  $old$WHERE private.platform_can_read_student_portal_case($old$,
  $new$WHERE student_case.portal_activated_at IS NOT NULL
    AND student_case.state IN ('pending', 'active', 'closed')
    AND private.platform_can_read_student_portal_case($new$, 1);

COMMIT;
