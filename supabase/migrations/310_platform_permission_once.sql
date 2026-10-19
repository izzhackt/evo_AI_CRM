-- 310_platform_permission_once: права актора считаются один раз на запрос, а не на каждую
-- строку (docs/PLAN_CHANGES.md, запись 2026-10-19 «SQL: права актора один раз на запрос»;
-- решение владельца 19.10.2026). Хук набора в scripts/test-postgres-authorization.sh
-- ищет файл по имени, а не по номеру.
--
-- Зачем. Тяжёлые чтения (страница «WhatsApp», воронка, «Продажи», отчёт продаж, карточка
-- дела) проверяли право на КАЖДУЮ строку цепочкой SQL-функций
-- staff_can_access_for_actor -> current_actor_authority -> staff_access_evaluate ->
-- staff_resource_context -> staff_context_can_access -> staff_membership_identity /
-- staff_has_permission. Вложенные функции на языке SQL планируются заново при каждом вызове
-- внешней: одна проверка стоила ~5,9 мс, страница WhatsApp (1642 переписки) ~8 с при
-- statement_timeout 8 с у authenticated, воронка ~4 с, связи дел с продажами ~3,8 с.
--
-- Что делает: ничего не меняет в таблицах, колонках, политиках RLS и функциях проверки
-- (staff_can_access*, staff_resource_context, private.platform_can_read_* остаются как были и
-- остаются эталоном). Добавляет четыре закрытые функции и заменяет на месте девять тел
-- (CREATE OR REPLACE через pg_get_functiondef: подписи, владельцы, права, STABLE,
-- SECURITY DEFINER, search_path прежние). Приложение не меняется, выпуск приложения не нужен.
--
--  A. platform_private.staff_visible_ids_v1(org, membership, permission, kind, only_ids)
--     SETOF uuid, STABLE, SECURITY DEFINER, EXECUTE только у владельца. Один раз считает
--     полномочия принадлежности для пары (право, вид ресурса): ту же личность
--     (staff_membership_identity), то же право (staff_has_permission), те же назначения
--     (роль активна и привязана к опубликованному пакету с этим правом, назначение не
--     отозвано, вид области разрешён у права) и сводит их в область: вся организация
--     (администратор, чувствительное право, область «организация»), «свои», отделы (члены
--     активных отделов), направления, записи. Затем одним запросом по ресурсам организации
--     оставляет те, чей контекст (владелец, дело, направление, id) попадает в область. Контекст
--     каждого вида повторяет staff_resource_context слово в слово, включая правило 261
--     («командный ящик WhatsApp»: у переписки очереди продаж есть ещё один контекст с владельцем
--     «сам спрашивающий»); см. комментарии у ветвей.
--     Поддержаны ровно четыре пары: (lead.read, lead), (communication.read.full,
--     conversation), (case.read.full, student_case), (sales.register.read, sales_register);
--     иная пара это 22023. only_ids сужает перебор до заданных id (пустой массив это «ничего»,
--     NULL это «все»).
--     Кэша между вызовами нет: каждый вызов читает таблицы заново под снимком запроса,
--     поэтому отзыв роли, приостановка членства и блокировка профиля действуют на
--     следующем же вызове. Ни GUC, ни временных таблиц, ни IMMUTABLE.
--  B. platform_private.staff_visible_ids_for_actor_v1(org, permission, kind, only_ids)
--     то же для актёра запроса (зеркало staff_can_access_for_actor: строки
--     current_actor_authority() этой организации; у студента множество пустое).
--  C. platform_private.staff_readable_case_ids_v1(org, membership, only_ids) и
--     D. ...staff_readable_case_ids_for_actor_v1(org, only_ids): зеркало
--     private.platform_can_read_student_case: дела case.read.full плюс дела «ждёт куратора»
--     (staff_can_take_needs_curator_case) только для pending без куратора: обе ветки этого
--     помощника иначе возвращают FALSE (якоря md5 его тела и тел помощников ниже).
--  E. Заменяемые тела (старый вызов -> новое множество, один раз на запрос):
--     1. private.staff_communication_page: private.platform_can_read_communication_full на
--        каждую переписку -> множество переписок актёра.
--     2. private.staff_sales_lead_page: staff_can_access лидов (2 места), can_read лида,
--        переписки и дела внутри связанных подсчётов (is_connected, linked_*) -> множества.
--     3. platform.staff_sales_count_v1, 4. platform.read_sales_register_v5 (две выборки;
--        одиночный выбор записи и списки владельцев остаются как были),
--     5. platform.staff_sales_stage_entry_cohort (две выборки).
--     6. platform.staff_student_case_sales_links: без platform_private.visible_canonical_leads()
--        (оно считало счётчики для всех лидов организации ради одного lead_id): только лиды
--        запрошенных дел.
--     7. platform.staff_student_case_page (основа read_snapshot): видимость множеством и
--        фильтр по делу внутри CTE, а не после перебора всех дел организации.
--     8. private.staff_student_case_activity: платформенное право finance.read.summary и
--        чтение переписок дела считаются один раз на страницу, а не на событие журнала.
--     9. platform.staff_student_case_queue_v1: чтение дела множеством.
--     Результат, порядок, курсоры, ошибки и их тексты прежние.
--
-- Защита от дрейфа. Эталонные функции (цепочка прав и помощники «ждёт куратора») получают
-- комментарий «зеркалится множеством, менять вместе»; их md5 закреплён здесь при применении 310, а набор
-- supabase/tests/platform_permission_once.sql закрепляет те же значения и сверяет множества с
-- неизменной построчной проверкой ещё и НА ПОСЛЕДНЕЙ цепочке (раннер запускает его второй раз после
-- последней миграции). Миграция, меняющая эталон, обязана в том же PR обновить примитивы и якоря.
--
-- Политики RLS не менялись (страничные функции SECURITY DEFINER от postgres с BYPASSRLS,
-- политики внутри них не работают; напрямую таблицы читаются точечно).
--
-- Повторный запуск целой миграции отказывает на якорях (a310_anchor_drift: тела уже заменены), ничего
-- не меняя.
BEGIN;

-- ---------------------------------------------------------------------------
-- Якоря. Девять заменяемых тел ровно те, что выпущены до 310 (md5 prosrc), и девять
-- функций, чью логику зеркалит новое множество, не менялись: расхождение останавливает
-- миграцию (шаблон 253/281/303). Значения сняты с цепочки 001-309 и сверены с копией
-- production от 19.10.2026 (все 21 совпали).
-- ---------------------------------------------------------------------------
DO $a310_anchor$
DECLARE anchor RECORD;
BEGIN
  FOR anchor IN SELECT * FROM (VALUES
    ('platform.read_sales_register_v5(uuid,integer,integer,integer,uuid,boolean,text,text,boolean,text,text)', 'bd2886ff43337b097166d3e44e195dee'),
    ('platform.staff_sales_count_v1(uuid,date,date)', '81917c338c53e020fbbaf5ce5b4fbbc8'),
    ('platform.staff_sales_stage_entry_cohort(date,date,integer,timestamp with time zone,uuid)', 'ac1446cdcc1c622161d78b86f1a0f979'),
    ('platform.staff_student_case_page(integer,timestamp with time zone,uuid,platform.student_case_state,text,uuid,text,uuid,text)', 'f203fed7163d69e63fd5fec96f11d458'),
    ('platform.staff_student_case_queue_v1(text,integer,text,text,text,uuid,text,text)', '0e1e79c26d1fb129917fa94f823c71e6'),
    ('platform.staff_student_case_sales_links(uuid,uuid[])', 'f832121c1ad26479bb003a360876898b'),
    ('platform_private.direct_needs_curator_case_author(uuid,uuid)', 'd7c0965e6db13d062b7fd379a09d7858'),
    ('platform_private.needs_curator_case_last_curator(uuid,uuid)', '4a100c80480fba92f7648ed3e922a145'),
    ('platform_private.staff_access_evaluate(uuid,uuid,text,text,uuid,boolean)', '89536bd904e1631fda1b264dc053c505'),
    ('platform_private.staff_can_take_direct_needs_curator_case(uuid,uuid,uuid)', 'd7811c9ff41583d2137b10bb4570ed16'),
    ('platform_private.staff_can_take_needs_curator_case(uuid,uuid,uuid)', '8fb42c2c60235befcb8d75a18d444e49'),
    ('platform_private.staff_context_can_access(uuid,uuid,text,text,uuid,uuid,uuid,text)', 'f354be0f66ddcc6953bc89dabe286315'),
    ('platform_private.staff_has_permission(uuid,uuid,text)', '2184ba936ea0fa1489cb4b182fcbd96e'),
    ('platform_private.staff_membership_identity(uuid,uuid)', '50bcf36620d2806d48387c5896513ff1'),
    ('platform_private.staff_resource_context(uuid,text,text,uuid)', '1567b2501a0762432a80d93c49be5c01'),
    ('private.platform_can_read_canonical_lead(uuid,uuid)', '720b525f1c565ea8399d87b64d82efb7'),
    ('private.platform_can_read_communication_full(uuid,uuid)', '67d85fbcd6a07266a957f1b3bdc310a9'),
    ('private.platform_can_read_student_case(uuid,uuid)', 'a567284eb05c0865152d913062775292'),
    ('private.staff_communication_page(uuid,integer,timestamp with time zone,uuid,platform.communication_queue,platform.communication_status,uuid,text,boolean,boolean,boolean)', '28c57359ada9847b82871ee180efd9aa'),
    ('private.staff_sales_lead_page(integer,timestamp with time zone,uuid,text,text,text,uuid,text,text)', 'ff590e3efe088da4fc1fae75feea336f'),
    ('private.staff_student_case_activity(uuid,integer,timestamp with time zone,uuid)', '417aad6afe19aa0cb63f9ac139437ef4')
  ) AS t(signature, body_md5)
  LOOP
    IF (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc AS p
        WHERE p.oid = anchor.signature::regprocedure) IS DISTINCT FROM anchor.body_md5 THEN
      RAISE EXCEPTION 'a310_anchor_drift: % is not the definition 310 was written against', anchor.signature;
    END IF;
  END LOOP;
END
$a310_anchor$;


-- ---------------------------------------------------------------------------
-- A. Множество видимых ресурсов принадлежности (полномочия один раз).
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.staff_visible_ids_v1(
  p_organization_id UUID, p_membership_id UUID, p_permission_key TEXT, p_resource_kind TEXT,
  p_only_ids UUID[] DEFAULT NULL)
RETURNS SETOF UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' ROWS 500
AS $$
DECLARE
  v_admin BOOLEAN;
  v_sensitive BOOLEAN;
  v_scope_kinds TEXT[];
  v_all BOOLEAN := FALSE;
  v_own BOOLEAN := FALSE;
  v_departments TEXT[] := ARRAY[]::TEXT[];
  v_directions TEXT[] := ARRAY[]::TEXT[];
  v_records TEXT[] := ARRAY[]::TEXT[];
  v_record_cases TEXT[] := ARRAY[]::TEXT[];
  v_owners UUID[] := ARRAY[]::UUID[];
BEGIN
  IF (p_permission_key, p_resource_kind) NOT IN (
    ('lead.read', 'lead'), ('communication.read.full', 'conversation'),
    ('case.read.full', 'student_case'), ('sales.register.read', 'sales_register'))
  THEN
    RAISE EXCEPTION 'staff_visible_ids_unsupported' USING ERRCODE = '22023';
  END IF;

  -- The gate: the head of staff_context_can_access (live identity, the permission
  -- applies to this kind of resource) and staff_has_permission, called as is.
  SELECT i.system_role = 'admin', d.staff_sensitive, d.staff_scope_kinds
    INTO v_admin, v_sensitive, v_scope_kinds
  FROM platform_private.staff_membership_identity(p_organization_id, p_membership_id) AS i
  JOIN platform.permission_definitions AS d ON d.permission_key = p_permission_key
  WHERE p_resource_kind = ANY (d.staff_resource_kinds)
    AND platform_private.staff_has_permission(p_organization_id, p_membership_id, p_permission_key);
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_sensitive OR v_admin THEN
    v_all := TRUE;
  ELSE
    SELECT
      COALESCE(bool_or(a.scope_kind = 'organization' AND a.scope_key = p_organization_id::TEXT), FALSE),
      COALESCE(bool_or(a.scope_kind = 'own'), FALSE),
      COALESCE(array_agg(a.scope_key) FILTER (WHERE a.scope_kind = 'department'), ARRAY[]::TEXT[]),
      COALESCE(array_agg(a.scope_key) FILTER (WHERE a.scope_kind = 'direction'), ARRAY[]::TEXT[]),
      COALESCE(array_agg(a.scope_key) FILTER (
        WHERE a.scope_kind = 'record' AND a.resource_kind = p_resource_kind), ARRAY[]::TEXT[]),
      COALESCE(array_agg(a.scope_key) FILTER (
        WHERE a.scope_kind = 'record' AND a.resource_kind = 'student_case'), ARRAY[]::TEXT[])
    INTO v_all, v_own, v_departments, v_directions, v_records, v_record_cases
    FROM platform.staff_role_assignments AS a
    JOIN platform.staff_role_definitions AS r
      ON r.organization_id = a.organization_id AND r.id = a.role_id
     AND r.status = 'active' AND r.current_bundle_id = a.bundle_id
    JOIN platform.role_bundle_versions AS b ON b.id = a.bundle_id AND b.status = 'published'
    JOIN platform.role_bundle_permissions AS bp
      ON bp.bundle_id = a.bundle_id AND bp.permission_key = p_permission_key
    WHERE a.organization_id = p_organization_id AND a.membership_id = p_membership_id
      AND a.revoked_at IS NULL AND a.scope_kind = ANY (v_scope_kinds);

    IF cardinality(v_departments) > 0 THEN
      v_owners := ARRAY(
        SELECT od.membership_id
        FROM platform.staff_organizational_details AS od
        JOIN platform.staff_departments AS dept
          ON dept.organization_id = od.organization_id AND dept.id = od.department_id
         AND dept.status = 'active'
        WHERE od.organization_id = p_organization_id AND dept.id::TEXT = ANY (v_departments));
    END IF;
  END IF;

  IF p_resource_kind = 'lead' THEN
    RETURN QUERY
    SELECT DISTINCT ctx.rid
    FROM (
      SELECT l.id AS rid, l.current_owner_membership_id AS owner_id, NULL::UUID AS case_id, NULL::TEXT AS direction
      FROM platform.leads AS l
      WHERE l.organization_id = p_organization_id AND (p_only_ids IS NULL OR l.id = ANY (p_only_ids))
      UNION ALL
      SELECT l.id, c.current_curator_membership_id, c.id, c.admissions_direction
      FROM platform.student_cases AS c
      JOIN platform.leads AS l ON l.organization_id = c.organization_id AND c.canonical_lead_id = l.id
      WHERE l.organization_id = p_organization_id AND (p_only_ids IS NULL OR l.id = ANY (p_only_ids))
      UNION ALL
      SELECT l.id, l.current_owner_membership_id, c.id, c.admissions_direction
      FROM platform.leads AS l
      JOIN platform.student_cases AS c ON c.organization_id = l.organization_id AND c.canonical_lead_id = l.id
      WHERE l.organization_id = p_organization_id AND (p_only_ids IS NULL OR l.id = ANY (p_only_ids))
    ) AS ctx
    WHERE v_all
      OR (v_own AND ctx.owner_id = p_membership_id)
      OR ctx.owner_id = ANY (v_owners)
      OR ctx.direction = ANY (v_directions)
      OR ctx.rid::TEXT = ANY (v_records)
      OR ctx.case_id::TEXT = ANY (v_record_cases);
  ELSIF p_resource_kind = 'conversation' THEN
    RETURN QUERY
    SELECT DISTINCT ctx.rid
    FROM (
      SELECT conv.id AS rid,
        CASE WHEN conv.queue = 'sales' THEN conv.responsible_sales_membership_id
          ELSE conv.current_curator_membership_id END AS owner_id,
        c.id AS case_id, c.admissions_direction AS direction
      FROM platform.communication_conversations AS conv
      JOIN platform.student_cases AS c ON c.organization_id = p_organization_id AND c.id = conv.student_case_id
      WHERE conv.organization_id = p_organization_id AND (p_only_ids IS NULL OR conv.id = ANY (p_only_ids))
      UNION ALL
      SELECT conv.id,
        CASE WHEN conv.queue = 'sales' THEN conv.responsible_sales_membership_id
          ELSE conv.current_curator_membership_id END,
        NULL::UUID, NULL::TEXT
      FROM platform.communication_conversations AS conv
      WHERE conv.organization_id = p_organization_id AND conv.student_case_id IS NULL
        AND (p_only_ids IS NULL OR conv.id = ANY (p_only_ids))
      UNION ALL
      -- 261, "WhatsApp team inbox": staff_access_evaluate adds, for a conversation of the SALES
      -- queue and communication.read.full, one more context whose owner is the asking member
      -- (no case, no direction), so «свои» and «отдел» match as for the member's own records.
      SELECT conv.id, p_membership_id, NULL::UUID, NULL::TEXT
      FROM platform.communication_conversations AS conv
      WHERE conv.organization_id = p_organization_id AND conv.queue = 'sales'
        AND (p_only_ids IS NULL OR conv.id = ANY (p_only_ids))
    ) AS ctx
    WHERE v_all
      OR (v_own AND ctx.owner_id = p_membership_id)
      OR ctx.owner_id = ANY (v_owners)
      OR ctx.direction = ANY (v_directions)
      OR ctx.rid::TEXT = ANY (v_records)
      OR ctx.case_id::TEXT = ANY (v_record_cases);
  ELSIF p_resource_kind = 'student_case' THEN
    RETURN QUERY
    SELECT ctx.rid
    FROM (
      SELECT c.id AS rid,
        CASE WHEN c.state = 'pending' THEN c.responsible_sales_membership_id
          ELSE c.current_curator_membership_id END AS owner_id,
        c.id AS case_id, c.admissions_direction AS direction
      FROM platform.student_cases AS c
      WHERE c.organization_id = p_organization_id AND (p_only_ids IS NULL OR c.id = ANY (p_only_ids))
    ) AS ctx
    WHERE v_all
      OR (v_own AND ctx.owner_id = p_membership_id)
      OR ctx.owner_id = ANY (v_owners)
      OR ctx.direction = ANY (v_directions)
      OR ctx.rid::TEXT = ANY (v_records)
      OR ctx.case_id::TEXT = ANY (v_record_cases);
  ELSE
    RETURN QUERY
    SELECT ctx.rid
    FROM (
      SELECT r.id AS rid, r.owner_membership_id AS owner_id, NULL::UUID AS case_id, NULL::TEXT AS direction
      FROM platform_private.sales_register AS r
      WHERE r.organization_id = p_organization_id AND (p_only_ids IS NULL OR r.id = ANY (p_only_ids))
    ) AS ctx
    WHERE v_all
      OR (v_own AND ctx.owner_id = p_membership_id)
      OR ctx.owner_id = ANY (v_owners)
      OR ctx.direction = ANY (v_directions)
      OR ctx.rid::TEXT = ANY (v_records)
      OR ctx.case_id::TEXT = ANY (v_record_cases);
  END IF;
END
$$;

-- Тот же набор для актёра запроса: зеркало platform_private.staff_can_access_for_actor
-- (строки current_actor_authority() этой организации; у студента множество пустое).
CREATE FUNCTION platform_private.staff_visible_ids_for_actor_v1(
  p_organization_id UUID, p_permission_key TEXT, p_resource_kind TEXT, p_only_ids UUID[] DEFAULT NULL)
RETURNS SETOF UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' ROWS 500
AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT v.id
  FROM platform.current_actor_authority() AS a
  CROSS JOIN LATERAL platform_private.staff_visible_ids_v1(
    a.organization_id, a.membership_id, p_permission_key, p_resource_kind, p_only_ids) AS v(id)
  WHERE a.organization_id = p_organization_id;
END
$$;

-- Дела, которые читает принадлежность: зеркало private.platform_can_read_student_case.
-- Ветка «дело ждёт куратора» возможна только у дела pending без куратора (обе ветки
-- platform_private.staff_can_take_needs_curator_case возвращают иначе FALSE: якорь md5 ниже),
-- поэтому построчный помощник вызывается лишь для таких дел вне множества case.read.full.
CREATE FUNCTION platform_private.staff_readable_case_ids_v1(
  p_organization_id UUID, p_membership_id UUID, p_only_ids UUID[] DEFAULT NULL)
RETURNS SETOF UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' ROWS 500
AS $$
BEGIN
  RETURN QUERY
  WITH full_access AS MATERIALIZED (
    SELECT v.id
    FROM platform_private.staff_visible_ids_v1(
      p_organization_id, p_membership_id, 'case.read.full', 'student_case', p_only_ids) AS v(id))
  SELECT f.id FROM full_access AS f
  UNION
  SELECT c.id
  FROM platform.student_cases AS c
  WHERE c.organization_id = p_organization_id
    AND (p_only_ids IS NULL OR c.id = ANY (p_only_ids))
    AND c.state = 'pending' AND c.current_curator_membership_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM full_access AS f WHERE f.id = c.id)
    AND platform_private.staff_can_take_needs_curator_case(p_organization_id, p_membership_id, c.id);
END
$$;

CREATE FUNCTION platform_private.staff_readable_case_ids_for_actor_v1(
  p_organization_id UUID, p_only_ids UUID[] DEFAULT NULL)
RETURNS SETOF UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' ROWS 500
AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT v.id
  FROM platform.current_actor_authority() AS a
  CROSS JOIN LATERAL platform_private.staff_readable_case_ids_v1(
    a.organization_id, a.membership_id, p_only_ids) AS v(id)
  WHERE a.organization_id = p_organization_id AND a.platform_role IS DISTINCT FROM 'student';
END
$$;

REVOKE ALL ON FUNCTION
  platform_private.staff_visible_ids_v1(UUID, UUID, TEXT, TEXT, UUID[]),
  platform_private.staff_visible_ids_for_actor_v1(UUID, TEXT, TEXT, UUID[]),
  platform_private.staff_readable_case_ids_v1(UUID, UUID, UUID[]),
  platform_private.staff_readable_case_ids_for_actor_v1(UUID, UUID[])
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;


-- ---------------------------------------------------------------------------
-- Замена проверяемых фрагментов внутри выпущенных тел (шаблон 173/244/281/282/303):
-- число совпадений названо, любое другое останавливает миграцию. pg_get_functiondef
-- переносит владельца, права, STABLE / SECURITY DEFINER и search_path как были.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.a310_replace(p_signature TEXT, p_old TEXT, p_new TEXT, p_count INTEGER)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE body TEXT; matches INTEGER;
BEGIN
  body := pg_get_functiondef(to_regprocedure(p_signature));
  matches := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  IF body IS NULL OR matches IS DISTINCT FROM p_count THEN
    RAISE EXCEPTION 'a310_replace_drift: % expected %, found %', p_signature, p_count, matches;
  END IF;
  EXECUTE replace(body, p_old, p_new);
END $$;


-- 1. staff_communication_page («WhatsApp»)
SELECT pg_temp.a310_replace('private.staff_communication_page(uuid,integer,timestamp with time zone,uuid,platform.communication_queue,platform.communication_status,uuid,text,boolean,boolean,boolean)',
$a310_o1$  RETURN QUERY
  SELECT
    conversation.id,
$a310_o1$,
$a310_n1$  RETURN QUERY
  WITH visible_conversations AS MATERIALIZED (
    SELECT visible.id
    FROM platform_private.staff_visible_ids_for_actor_v1(
      p_organization_id, 'communication.read.full', 'conversation') AS visible(id)
  )
  SELECT
    conversation.id,
$a310_n1$,
1);
SELECT pg_temp.a310_replace('private.staff_communication_page(uuid,integer,timestamp with time zone,uuid,platform.communication_queue,platform.communication_status,uuid,text,boolean,boolean,boolean)',
$a310_o2$    AND private.platform_can_read_communication_full(
      conversation.organization_id,
      conversation.id
    )
$a310_o2$,
$a310_n2$    AND conversation.id IN (SELECT visible.id FROM visible_conversations AS visible)
$a310_n2$,
1);

-- 2. staff_sales_lead_page (воронка)
SELECT pg_temp.a310_replace('private.staff_sales_lead_page(integer,timestamp with time zone,uuid,text,text,text,uuid,text,text)',
$a310_o3$  WITH visible_lead_scope AS MATERIALIZED (
    SELECT lead.organization_id, lead.id AS lead_id
    FROM platform.leads AS lead
    WHERE lead.organization_id = actor.organization_id
      AND lead.lifecycle_state = 'open'
      AND platform_private.staff_can_access(lead.organization_id,actor.membership_id,'lead.read','lead',lead.id)
  ),
$a310_o3$,
$a310_n3$  WITH actor_visible_leads AS MATERIALIZED (
    SELECT v.id FROM platform_private.staff_visible_ids_v1(actor.organization_id, actor.membership_id, 'lead.read', 'lead') AS v(id)
  ),
  visible_lead_scope AS MATERIALIZED (
    SELECT lead.organization_id, lead.id AS lead_id
    FROM platform.leads AS lead
    WHERE lead.organization_id = actor.organization_id
      AND lead.lifecycle_state = 'open'
      AND lead.id IN (SELECT visible_lead.id FROM actor_visible_leads AS visible_lead)
  ),
$a310_n3$,
1);
SELECT pg_temp.a310_replace('private.staff_sales_lead_page(integer,timestamp with time zone,uuid,text,text,text,uuid,text,text)',
$a310_o4$  RETURN QUERY
  WITH visible AS MATERIALIZED (
$a310_o4$,
$a310_n4$  RETURN QUERY
  WITH actor_visible_leads AS MATERIALIZED (
    SELECT v.id FROM platform_private.staff_visible_ids_v1(actor.organization_id, actor.membership_id, 'lead.read', 'lead') AS v(id)
  ),
  actor_visible_conversations AS MATERIALIZED (
    SELECT v.id
    FROM platform_private.staff_visible_ids_for_actor_v1(
      actor.organization_id, 'communication.read.full', 'conversation') AS v(id)
  ),
  actor_readable_cases AS MATERIALIZED (
    SELECT v.id
    FROM platform_private.staff_readable_case_ids_for_actor_v1(actor.organization_id) AS v(id)
  ),
  visible AS MATERIALIZED (
$a310_n4$,
1);
SELECT pg_temp.a310_replace('private.staff_sales_lead_page(integer,timestamp with time zone,uuid,text,text,text,uuid,text,text)',
$a310_o5$      AND platform_private.staff_can_access(lead.organization_id,actor.membership_id,'lead.read','lead',lead.id)
$a310_o5$,
$a310_n5$      AND lead.id IN (SELECT visible_lead.id FROM actor_visible_leads AS visible_lead)
$a310_n5$,
1);
SELECT pg_temp.a310_replace('private.staff_sales_lead_page(integer,timestamp with time zone,uuid,text,text,text,uuid,text,text)',
$a310_o6$          AND private.platform_can_read_canonical_lead(
            lead.organization_id,
            lead.id
          )
$a310_o6$,
$a310_n6$          AND lead.id IN (SELECT visible_lead.id FROM actor_visible_leads AS visible_lead)
$a310_n6$,
2);
SELECT pg_temp.a310_replace('private.staff_sales_lead_page(integer,timestamp with time zone,uuid,text,text,text,uuid,text,text)',
$a310_o7$          AND private.platform_can_read_communication_full(
            direct_conversation.organization_id,
            direct_conversation.id
          )
$a310_o7$,
$a310_n7$          AND direct_conversation.id IN (SELECT visible_conversation.id FROM actor_visible_conversations AS visible_conversation)
$a310_n7$,
1);
SELECT pg_temp.a310_replace('private.staff_sales_lead_page(integer,timestamp with time zone,uuid,text,text,text,uuid,text,text)',
$a310_o8$          AND private.platform_can_read_communication_full(
            conversation.organization_id,
            conversation.id
          )
$a310_o8$,
$a310_n8$          AND conversation.id IN (SELECT visible_conversation.id FROM actor_visible_conversations AS visible_conversation)
$a310_n8$,
1);
SELECT pg_temp.a310_replace('private.staff_sales_lead_page(integer,timestamp with time zone,uuid,text,text,text,uuid,text,text)',
$a310_o9$          AND private.platform_can_read_student_case(
            student_case.organization_id,
            student_case.id
          )
$a310_o9$,
$a310_n9$          AND student_case.id IN (SELECT readable_case.id FROM actor_readable_cases AS readable_case)
$a310_n9$,
1);

-- 3. staff_sales_count_v1 («Продажи»)
SELECT pg_temp.a310_replace('platform.staff_sales_count_v1(uuid,date,date)',
$a310_o10$      AND platform_private.staff_can_access(
        p_organization_id, actor.membership_id, 'sales.register.read', 'sales_register', r.id)
$a310_o10$,
$a310_n10$      AND r.id IN (SELECT v.id FROM platform_private.staff_visible_ids_v1(
        p_organization_id, actor.membership_id, 'sales.register.read', 'sales_register') AS v(id))
$a310_n10$,
1);

-- 4. read_sales_register_v5 (отчёт продаж)
SELECT pg_temp.a310_replace('platform.read_sales_register_v5(uuid,integer,integer,integer,uuid,boolean,text,text,boolean,text,text)',
$a310_o11$ WITH base AS MATERIALIZED (SELECT r.* FROM platform_private.sales_register r WHERE r.organization_id=p_organization_id
   AND platform_private.staff_can_access(p_organization_id, actor.membership_id,
      'sales.register.read', 'sales_register', r.id) AND r.archived=p_archived
$a310_o11$,
$a310_n11$ WITH base AS MATERIALIZED (SELECT r.* FROM platform_private.sales_register r WHERE r.organization_id=p_organization_id
   AND r.id IN (SELECT v.id FROM platform_private.staff_visible_ids_v1(p_organization_id, actor.membership_id,
      'sales.register.read', 'sales_register') AS v(id)) AND r.archived=p_archived
$a310_n11$,
1);
SELECT pg_temp.a310_replace('platform.read_sales_register_v5(uuid,integer,integer,integer,uuid,boolean,text,text,boolean,text,text)',
$a310_o12$   FROM platform_private.sales_register r WHERE r.organization_id=p_organization_id AND platform_private.staff_can_access(p_organization_id, actor.membership_id,
      'sales.register.read', 'sales_register', r.id)
   AND r.fields->>'manager_label'<>'' GROUP BY 1,2),
$a310_o12$,
$a310_n12$   FROM platform_private.sales_register r WHERE r.organization_id=p_organization_id AND r.id IN (SELECT v.id
      FROM platform_private.staff_visible_ids_v1(p_organization_id, actor.membership_id,
      'sales.register.read', 'sales_register') AS v(id))
   AND r.fields->>'manager_label'<>'' GROUP BY 1,2),
$a310_n12$,
1);

-- 5. staff_sales_stage_entry_cohort (когорта этапов)
SELECT pg_temp.a310_replace('platform.staff_sales_stage_entry_cohort(date,date,integer,timestamp with time zone,uuid)',
$a310_o13$      AND platform_private.staff_can_access(lead.organization_id,actor.membership_id,'lead.read','lead',lead.id)
$a310_o13$,
$a310_n13$      AND lead.id IN (SELECT v.id FROM platform_private.staff_visible_ids_v1(
        actor.organization_id, actor.membership_id, 'lead.read', 'lead') AS v(id))
$a310_n13$,
2);

-- 6. staff_student_case_sales_links (связи дела с продажами)
SELECT pg_temp.a310_replace('platform.staff_student_case_sales_links(uuid,uuid[])',
$a310_o14$  WITH visible_leads AS MATERIALIZED (
    SELECT
      visible.organization_id,
      visible.lead_id
    FROM platform_private.visible_canonical_leads() AS visible
    WHERE visible.organization_id = p_organization_id
  )
$a310_o14$,
$a310_n14$  WITH visible_leads AS MATERIALIZED (
    SELECT
      p_organization_id AS organization_id,
      v.id AS lead_id
    FROM platform_private.staff_visible_ids_for_actor_v1(
      p_organization_id, 'lead.read', 'lead',
      ARRAY(
        SELECT requested_case.canonical_lead_id
        FROM platform.student_cases AS requested_case
        WHERE requested_case.organization_id = p_organization_id
          AND requested_case.id = ANY (p_student_case_ids)
          AND requested_case.canonical_lead_id IS NOT NULL
      )
    ) AS v(id)
  ),
  readable_cases AS MATERIALIZED (
    SELECT v.id
    FROM platform_private.staff_readable_case_ids_for_actor_v1(
      p_organization_id, p_student_case_ids) AS v(id)
  )
$a310_n14$,
1);
SELECT pg_temp.a310_replace('platform.staff_student_case_sales_links(uuid,uuid[])',
$a310_o15$    AND COALESCE(
      private.platform_can_read_student_case(
        student_case.organization_id,
        student_case.id
      ),
      FALSE
    )
$a310_o15$,
$a310_n15$    AND student_case.id IN (SELECT readable_case.id FROM readable_cases AS readable_case)
$a310_n15$,
1);

-- 7. staff_student_case_page (основа read_snapshot карточки дела)
SELECT pg_temp.a310_replace('platform.staff_student_case_page(integer,timestamp with time zone,uuid,platform.student_case_state,text,uuid,text,uuid,text)',
$a310_o16$  RETURN QUERY
  WITH visible AS MATERIALIZED (
$a310_o16$,
$a310_n16$  RETURN QUERY
  WITH readable_cases AS MATERIALIZED (
    SELECT DISTINCT v.id
    FROM platform.current_actor_authority() AS reader
    CROSS JOIN LATERAL platform_private.staff_readable_case_ids_v1(
      reader.organization_id, reader.membership_id,
      CASE WHEN p_student_case_id IS NULL THEN NULL ELSE ARRAY[p_student_case_id] END) AS v(id)
    WHERE reader.platform_role IS DISTINCT FROM 'student'
  ),
  visible AS MATERIALIZED (
$a310_n16$,
1);
SELECT pg_temp.a310_replace('platform.staff_student_case_page(integer,timestamp with time zone,uuid,platform.student_case_state,text,uuid,text,uuid,text)',
$a310_o17$    WHERE private.platform_can_read_student_case(
      student_case.organization_id,
      student_case.id
    )

    UNION ALL
$a310_o17$,
$a310_n17$    WHERE student_case.id IN (SELECT readable_case.id FROM readable_cases AS readable_case)
      AND (p_student_case_id IS NULL OR student_case.id = p_student_case_id)

    UNION ALL
$a310_n17$,
1);
SELECT pg_temp.a310_replace('platform.staff_student_case_page(integer,timestamp with time zone,uuid,platform.student_case_state,text,uuid,text,uuid,text)',
$a310_o18$      AND NOT COALESCE(
        private.platform_can_read_student_case(
          student_case.organization_id,
          student_case.id
        ),
        FALSE
      )
$a310_o18$,
$a310_n18$      AND NOT EXISTS (
        SELECT 1 FROM readable_cases AS readable_case WHERE readable_case.id = student_case.id
      )
      AND (p_student_case_id IS NULL OR student_case.id = p_student_case_id)
$a310_n18$,
1);

-- 8. staff_student_case_activity (история дела)
SELECT pg_temp.a310_replace('private.staff_student_case_activity(uuid,integer,timestamp with time zone,uuid)',
$a310_o19$  actor RECORD;
  result JSONB;
BEGIN
$a310_o19$,
$a310_n19$  actor RECORD;
  result JSONB;
  finance_summary_ok BOOLEAN;
  readable_conversation_ids UUID[];
BEGIN
$a310_n19$,
1);
SELECT pg_temp.a310_replace('private.staff_student_case_activity(uuid,integer,timestamp with time zone,uuid)',
$a310_o20$  SELECT * INTO actor
    FROM platform_private.u7_require_case_workspace_actor(p_student_case_id);
$a310_o20$,
$a310_n20$  SELECT * INTO actor
    FROM platform_private.u7_require_case_workspace_actor(p_student_case_id);

  -- Computed once for the whole page, not once per audit event: the same permission and the
  -- same read check as before, for this case's conversations only.
  finance_summary_ok := private.platform_has_permission(actor.organization_id, 'finance.read.summary');
  readable_conversation_ids := ARRAY(
    SELECT v.id
    FROM platform_private.staff_visible_ids_for_actor_v1(
      actor.organization_id, 'communication.read.full', 'conversation',
      ARRAY(
        SELECT case_conversation.id
        FROM platform.communication_conversations AS case_conversation
        WHERE case_conversation.organization_id = actor.organization_id
          AND case_conversation.student_case_id = p_student_case_id
      )
    ) AS v(id)
  );
$a310_n20$,
1);
SELECT pg_temp.a310_replace('private.staff_student_case_activity(uuid,integer,timestamp with time zone,uuid)',
$a310_o21$        AND private.platform_has_permission(actor.organization_id, 'finance.read.summary')
$a310_o21$,
$a310_n21$        AND finance_summary_ok
$a310_n21$,
3);
SELECT pg_temp.a310_replace('private.staff_student_case_activity(uuid,integer,timestamp with time zone,uuid)',
$a310_o22$        AND private.platform_can_read_communication_full(actor.organization_id, conversation.id)
$a310_o22$,
$a310_n22$        AND conversation.id = ANY (readable_conversation_ids)
$a310_n22$,
1);
SELECT pg_temp.a310_replace('private.staff_student_case_activity(uuid,integer,timestamp with time zone,uuid)',
$a310_o23$        AND private.platform_can_read_communication_full(actor.organization_id, message.conversation_id)
$a310_o23$,
$a310_n23$        AND message.conversation_id = ANY (readable_conversation_ids)
$a310_n23$,
1);
SELECT pg_temp.a310_replace('private.staff_student_case_activity(uuid,integer,timestamp with time zone,uuid)',
$a310_o24$      AND private.platform_can_read_communication_full(actor.organization_id, message.conversation_id)
$a310_o24$,
$a310_n24$      AND message.conversation_id = ANY (readable_conversation_ids)
$a310_n24$,
1);

-- 9. staff_student_case_queue_v1 (очередь дел)
SELECT pg_temp.a310_replace('platform.staff_student_case_queue_v1(text,integer,text,text,text,uuid,text,text)',
$a310_o25$  WITH candidates AS MATERIALIZED (
$a310_o25$,
$a310_n25$  WITH readable_cases AS MATERIALIZED (
    SELECT v.id
    FROM platform_private.staff_readable_case_ids_for_actor_v1(a.organization_id) AS v(id)
  ), candidates AS MATERIALIZED (
$a310_n25$,
1);
SELECT pg_temp.a310_replace('platform.staff_student_case_queue_v1(text,integer,text,text,text,uuid,text,text)',
$a310_o26$      AND private.platform_can_read_student_case(c.organization_id, c.id)
$a310_o26$,
$a310_n26$      AND c.id IN (SELECT readable_case.id FROM readable_cases AS readable_case)
$a310_n26$,
1);

COMMENT ON FUNCTION platform_private.staff_visible_ids_v1(UUID, UUID, TEXT, TEXT, UUID[])
  IS '310: ids ресурсов, которые принадлежность читает (полномочия один раз; зеркало staff_can_access для четырёх пар право/вид). Закрыта для клиентов.';
COMMENT ON FUNCTION platform_private.staff_visible_ids_for_actor_v1(UUID, TEXT, TEXT, UUID[])
  IS '310: то же для актёра запроса (зеркало staff_can_access_for_actor). Закрыта для клиентов.';
COMMENT ON FUNCTION platform_private.staff_readable_case_ids_v1(UUID, UUID, UUID[])
  IS '310: дела, которые читает принадлежность (зеркало private.platform_can_read_student_case). Закрыта для клиентов.';
COMMENT ON FUNCTION platform_private.staff_readable_case_ids_for_actor_v1(UUID, UUID[])
  IS '310: то же для актёра запроса. Закрыта для клиентов.';

-- Комментарий на эталонных функциях (метаданные, тело и prosrc не меняются; md5 якорей не сдвигается).
DO $a310_comments$
DECLARE f TEXT;
  note CONSTANT TEXT := '310: решение этой функции зеркалится множествами platform_private.staff_visible_ids_v1 и staff_readable_case_ids_v1; менять только вместе с ними и с якорями в supabase/tests/platform_permission_once.sql.';
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'platform_private.staff_context_can_access(uuid,uuid,text,text,uuid,uuid,uuid,text)',
    'platform_private.staff_resource_context(uuid,text,text,uuid)',
    'platform_private.staff_has_permission(uuid,uuid,text)',
    'platform_private.staff_membership_identity(uuid,uuid)',
    'platform_private.staff_access_evaluate(uuid,uuid,text,text,uuid,boolean)',
    'platform_private.staff_can_access(uuid,uuid,text,text,uuid)',
    'platform_private.staff_can_access_for_actor(uuid,text,text,uuid)',
    'platform.current_actor_authority()',
    'platform_private.staff_can_take_needs_curator_case(uuid,uuid,uuid)',
    'platform_private.needs_curator_case_last_curator(uuid,uuid)',
    'platform_private.staff_can_take_direct_needs_curator_case(uuid,uuid,uuid)',
    'platform_private.direct_needs_curator_case_author(uuid,uuid)',
    'private.platform_can_read_student_case(uuid,uuid)',
    'private.platform_can_read_communication_full(uuid,uuid)',
    'private.platform_can_read_canonical_lead(uuid,uuid)']
  LOOP
    EXECUTE format('COMMENT ON FUNCTION %s IS %L', f::regprocedure,
      COALESCE(obj_description(f::regprocedure, 'pg_proc') || E'\n', '') || note);
  END LOOP;
END
$a310_comments$;

COMMIT;
