-- 301_platform_telephony_report — «Телефония Beeline KG» срез T10: блок «Звонки»
-- в «Отчёте продаж».
-- Контракт: docs/EVO_TELEPHONY_PLAN_2026-10-16.md §6.1, §9.1, §9.2, §10, §11, §12, §16
-- (срез T10), ADR 0033; docs/PLAN_CHANGES.md (запись «Телефония T10»). Только чтение
-- уже накопленных звонков: таблиц, колонок, прав и журнала не добавляет (права
-- telephony.report.read.own / .all — миграция 291). Ничего не включает: ответ пустой,
-- пока в настройках телефонии выключен ui_enabled (по умолчанию выключен, §9.1).
--
-- Что делает:
--  * platform.telephony_report_v1(организация, с, по) — для authenticated. Даты — включительно,
--    сутки Asia/Bishkek, не больше 366 суток (как «Динамика по дням»). Порядок отказов: сессия
--    сотрудника не Student → право (`telephony.report.read.all`, либо `…read.own`) → только
--    потом выключатель: без строки настроек или при ui_enabled = false ответ {"enabled": false}.
--    Право «все» отдаёт команду целиком: строка «Все», строки менеджеров, строку «Без
--    ответственного» и список пропущенных без перезвона; право «свои» — одну строку самого
--    сотрудника и его собственные пропущенные (по лидам, которыми он владеет).
--  * Строка (метрики одной формы у «Все» и у менеджера):
--      calls     — клиентские звонки, входящие и исходящие. «Все»: каждый звонок один раз.
--                  Менеджер: звонок один раз, если у него есть нога звонка (участники — по
--                  ногам, §10); нога, отменённая тем, что ответил другой сотрудник
--                  (CANCELLED по правилу 3 §6.1), не считается предложенным звонком;
--      answered  — отвеченные: «Все» — итог answered; менеджер — звонки, в которых говорил сам
--                  (telephony_call_taken_by, 295), то есть «ответил сотрудник», а не Success
--                  вебхука;
--      talk      — сумма talk_seconds (из сверки, §5.4; у звонка моложе 10 минут её нет и в
--                  сумму она не входит) и число отвеченных звонков, у которых время известно
--                  (среднее считает интерфейс);
--      result    — отвеченные звонки не из первичного импорта с клиентом (у них есть кнопка
--                  результата, §9.4) и сколько из них с проставленным результатом;
--      firstCall — новые лиды периода по created_at: сколько всего, до скольких дозвонились
--                  первым касанием (исходящий набор или принятый входящий), до скольких
--                  дозвонились (звонок отвечен), уложились в срок / опоздали / ещё в сроке и
--                  медианы рабочих секунд до касания и до ответа. Срок — settings.callback_work_minutes
--                  рабочих минут (по умолчанию 15). Лиды `admissions_direct` (прямые студенты)
--                  и `phone_call` (первый контакт — сам входящий звонок) не входят. Менеджер
--                  лида — текущий владелец; без владельца — «Без ответственного»;
--      missed    — входящие пропущенные клиента с номером, у которых нет отвеченного звонка
--                  цепочки (правило 8): в срок / позже срока / ещё в сроке / без перезвона.
--                  Срок отвеченного перезвона на этот номер — конец следующего рабочего дня после
--                  пропущенного; «позже срока» — отвечен позже callback_work_minutes рабочих минут.
--                  Менеджер — владелец лида звонка; без лида или владельца — «Без ответственного».
--    В отчёт входят только звонки с итогом: идущий сейчас звонок без итога не считается.
--  * Список `missedList` — до 50 последних пропущенных без перезвона (маска номера, лид,
--    имя владельца), `missedMore` — есть ли ещё. Номер клиента наружу — только маской (278).
--  * Два закрытых помощника: рабочие секунды между двумя моментами по часам настроек
--    (telephony_work_seconds_between) и конец следующего рабочего дня (telephony_report_deadline).
-- Повторный запуск целой миграции отказывает (CREATE FUNCTION), ничего не меняя.
BEGIN;

-- ---------------------------------------------------------------------------
-- Помощники (частные; без прав для клиентских ролей).
-- ---------------------------------------------------------------------------

-- Рабочие секунды между двумя моментами: часы идут только в рабочие дни между p_open и
-- p_close по местному времени Asia/Bishkek (без перехода на летнее время). Не больше 400
-- суток подряд (дальше срок и так просрочен). Пустой или обратный промежуток — 0.
CREATE FUNCTION platform_private.telephony_work_seconds_between(
  p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_days SMALLINT[], p_open TIME, p_close TIME
) RETURNS BIGINT LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_from IS NULL OR p_to IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_to) OR p_to <= p_from
      OR p_days IS NULL OR p_open IS NULL OR p_close IS NULL OR p_open >= p_close THEN 0::BIGINT
    ELSE COALESCE((
      SELECT sum(GREATEST(0::NUMERIC, extract(epoch FROM (LEAST(x.b, d.day + p_close) - GREATEST(x.a, d.day + p_open)))))::BIGINT
      FROM (SELECT p_from AT TIME ZONE 'Asia/Bishkek' AS a, p_to AT TIME ZONE 'Asia/Bishkek' AS b) x
      CROSS JOIN LATERAL generate_series(0, LEAST(x.b::DATE - x.a::DATE, 400)) AS k(n)
      CROSS JOIN LATERAL (SELECT x.a::DATE + k.n AS day) d
      WHERE extract(isodow FROM d.day)::SMALLINT = ANY (p_days)
    ), 0::BIGINT)
  END
$$;

-- Конец следующего рабочего дня после местных суток p_at: первый рабочий день строго после
-- даты p_at, в момент p_close. Рабочих дней в p_days нет — NULL.
CREATE FUNCTION platform_private.telephony_report_deadline(p_at TIMESTAMPTZ, p_days SMALLINT[], p_close TIME)
RETURNS TIMESTAMPTZ LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  v_day DATE;
  v_step INTEGER;
BEGIN
  IF p_at IS NULL OR NOT isfinite(p_at) OR p_days IS NULL OR p_close IS NULL THEN
    RETURN NULL;
  END IF;
  v_day := (p_at AT TIME ZONE 'Asia/Bishkek')::DATE;
  FOR v_step IN 1..7 LOOP
    v_day := v_day + 1;
    IF extract(isodow FROM v_day)::SMALLINT = ANY (p_days) THEN
      RETURN (v_day + p_close) AT TIME ZONE 'Asia/Bishkek';
    END IF;
  END LOOP;
  RETURN NULL;
END
$$;

-- ---------------------------------------------------------------------------
-- Отчёт по звонкам.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.telephony_report_v1(
  p_organization_id UUID,
  p_from DATE,
  p_to DATE
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor RECORD;
  v_settings platform_private.telephony_settings;
  v_all BOOLEAN;
  v_now TIMESTAMPTZ := statement_timestamp();
  v_from_ts TIMESTAMPTZ;
  v_to_ts TIMESTAMPTZ;
  v_sla_s BIGINT;
  v_days SMALLINT[];
  v_open TIME;
  v_close TIME;
  -- «Нет ответственного» внутри запроса — нулевой идентификатор; наружу он не выходит.
  v_nil CONSTANT UUID := '00000000-0000-0000-0000-000000000000';
  v_zero_first CONSTANT JSONB := '{"leads":0,"called":0,"reached":0,"inTime":0,"late":0,"pending":0,"medianCallSeconds":null,"medianReachSeconds":null}'::JSONB;
  v_zero_missed CONSTANT JSONB := '{"total":0,"inTime":0,"late":0,"pending":0,"without":0}'::JSONB;
  v_result JSONB;
BEGIN
  IF p_organization_id IS NULL OR p_from IS NULL OR p_to IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_to)
     OR p_from < DATE '2020-01-01' OR p_to > DATE '2200-01-01' OR p_to < p_from OR p_to - p_from > 365 THEN
    RAISE EXCEPTION 'telephony_report_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT a.membership_id INTO v_actor FROM platform.current_actor_authority() a
   WHERE a.organization_id = p_organization_id AND a.platform_role IS DISTINCT FROM 'student' LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'telephony_report_forbidden' USING ERRCODE = '42501';
  END IF;
  v_all := platform_private.staff_can_access(p_organization_id, v_actor.membership_id,
    'telephony.report.read.all', 'organization', p_organization_id);
  IF NOT v_all AND NOT platform_private.staff_can_access(p_organization_id, v_actor.membership_id,
       'telephony.report.read.own', 'organization', p_organization_id) THEN
    RAISE EXCEPTION 'telephony_report_forbidden' USING ERRCODE = '42501';
  END IF;
  -- Нет строки настроек или ui_enabled = false: телефонии в интерфейсе нет (§9.1).
  SELECT * INTO v_settings FROM platform_private.telephony_settings s WHERE s.organization_id = p_organization_id;
  IF NOT FOUND OR NOT v_settings.ui_enabled THEN
    RETURN jsonb_build_object('enabled', FALSE);
  END IF;

  v_from_ts := p_from::TIMESTAMP AT TIME ZONE 'Asia/Bishkek';
  v_to_ts := (p_to + 1)::TIMESTAMP AT TIME ZONE 'Asia/Bishkek';
  v_sla_s := v_settings.callback_work_minutes::BIGINT * 60;
  v_days := v_settings.working_days;
  v_open := v_settings.work_from;
  v_close := v_settings.work_to;

  WITH
  -- Звонки периода с итогом.
  calls AS (
    SELECT c.id, c.direction, c.outcome, c.started_at, c.talk_seconds, c.created_via, c.client_id, c.lead_id,
           c.client_phone, c.result_code
    FROM platform_private.telephony_calls c
    WHERE c.organization_id = p_organization_id
      AND c.started_at >= v_from_ts AND c.started_at < v_to_ts
      AND c.outcome IS NOT NULL
  ),
  -- Участие сотрудника в звонке: одна строка на (звонок, сотрудник) вне зависимости от числа ног.
  part AS (
    SELECT c.id AS call_id, c.direction, c.outcome, c.created_via, c.client_id, c.result_code, l.membership_id,
           bool_or(l.state <> 'cancelled') AS rang,
           sum(l.talk_seconds) AS leg_talk
    FROM calls c
    JOIN platform_private.telephony_call_legs l
      ON l.organization_id = p_organization_id AND l.call_id = c.id AND l.membership_id IS NOT NULL
    GROUP BY c.id, c.direction, c.outcome, c.created_via, c.client_id, c.result_code, l.membership_id
  ),
  part_taken AS (
    SELECT p.*, platform_private.telephony_call_taken_by(p_organization_id, p.call_id, p.membership_id) AS talked
    FROM part p
  ),
  -- Предложенные звонки: не те, где нога отменена тем, что ответил другой сотрудник.
  offered AS (
    SELECT * FROM part_taken p WHERE p.rang OR p.talked OR p.outcome IS DISTINCT FROM 'answered'
  ),
  mgr_calls AS (
    SELECT o.membership_id,
      jsonb_build_object(
        'calls', jsonb_build_object(
          'in', count(*) FILTER (WHERE o.direction = 'in'),
          'out', count(*) FILTER (WHERE o.direction = 'out')),
        'answered', jsonb_build_object(
          'in', count(*) FILTER (WHERE o.direction = 'in' AND o.talked),
          'out', count(*) FILTER (WHERE o.direction = 'out' AND o.talked)),
        'talk', jsonb_build_object(
          'seconds', COALESCE(sum(o.leg_talk) FILTER (WHERE o.talked), 0)::BIGINT,
          'calls', count(*) FILTER (WHERE o.talked AND o.leg_talk IS NOT NULL)),
        'result', jsonb_build_object(
          'eligible', count(*) FILTER (WHERE o.talked AND o.created_via <> 'backfill' AND o.client_id IS NOT NULL),
          'set', count(*) FILTER (WHERE o.talked AND o.created_via <> 'backfill' AND o.client_id IS NOT NULL
            AND o.result_code IS NOT NULL))
      ) AS j
    FROM offered o
    GROUP BY o.membership_id
  ),
  team_calls AS (
    SELECT jsonb_build_object(
      'calls', jsonb_build_object(
        'in', count(*) FILTER (WHERE c.direction = 'in'),
        'out', count(*) FILTER (WHERE c.direction = 'out')),
      'answered', jsonb_build_object(
        'in', count(*) FILTER (WHERE c.direction = 'in' AND c.outcome = 'answered'),
        'out', count(*) FILTER (WHERE c.direction = 'out' AND c.outcome = 'answered')),
      'talk', jsonb_build_object(
        'seconds', COALESCE(sum(c.talk_seconds) FILTER (WHERE c.outcome = 'answered'), 0)::BIGINT,
        'calls', count(*) FILTER (WHERE c.outcome = 'answered' AND c.talk_seconds IS NOT NULL)),
      'result', jsonb_build_object(
        'eligible', count(*) FILTER (WHERE c.outcome = 'answered' AND c.created_via <> 'backfill' AND c.client_id IS NOT NULL),
        'set', count(*) FILTER (WHERE c.outcome = 'answered' AND c.created_via <> 'backfill' AND c.client_id IS NOT NULL
          AND c.result_code IS NOT NULL))
    ) AS j
    FROM calls c
  ),
  -- Новые лиды периода и их первое касание (набор или принятый входящий) и первый ответ.
  new_leads AS (
    SELECT COALESCE(l.current_owner_membership_id, v_nil) AS owner_key, l.created_at, t.touch_at, t.reach_at
    FROM platform.leads l
    CROSS JOIN LATERAL (
      SELECT min(k.started_at) FILTER (WHERE k.direction = 'out' OR k.outcome = 'answered') AS touch_at,
             min(k.started_at) FILTER (WHERE k.outcome = 'answered') AS reach_at
      FROM platform_private.telephony_calls k
      WHERE k.organization_id = p_organization_id AND k.client_id = l.client_id AND k.started_at >= l.created_at
    ) t
    WHERE l.organization_id = p_organization_id AND l.client_id IS NOT NULL
      AND l.created_at >= v_from_ts AND l.created_at < v_to_ts
      AND l.source_key NOT IN ('admissions_direct', 'phone_call')
  ),
  lead_calc AS (
    SELECT n.owner_key, n.touch_at, n.reach_at,
      CASE WHEN n.touch_at IS NOT NULL THEN
        platform_private.telephony_work_seconds_between(n.created_at, n.touch_at, v_days, v_open, v_close) END AS touch_s,
      CASE WHEN n.reach_at IS NOT NULL THEN
        platform_private.telephony_work_seconds_between(n.created_at, n.reach_at, v_days, v_open, v_close) END AS reach_s,
      CASE WHEN n.touch_at IS NULL THEN
        platform_private.telephony_work_seconds_between(n.created_at, v_now, v_days, v_open, v_close) END AS wait_s
    FROM new_leads n
  ),
  lead_agg AS (
    SELECT g.owner_key, GROUPING(g.owner_key) AS is_total,
      jsonb_build_object(
        'leads', count(*),
        'called', count(*) FILTER (WHERE g.touch_at IS NOT NULL),
        'reached', count(*) FILTER (WHERE g.reach_at IS NOT NULL),
        'inTime', count(*) FILTER (WHERE g.touch_s <= v_sla_s),
        'late', count(*) FILTER (WHERE g.touch_s > v_sla_s OR g.wait_s > v_sla_s),
        'pending', count(*) FILTER (WHERE g.wait_s <= v_sla_s),
        'medianCallSeconds', round(percentile_cont(0.5) WITHIN GROUP (ORDER BY g.touch_s))::BIGINT,
        'medianReachSeconds', round(percentile_cont(0.5) WITHIN GROUP (ORDER BY g.reach_s))::BIGINT
      ) AS j
    FROM lead_calc g
    GROUP BY GROUPING SETS ((g.owner_key), ())
  ),
  -- Входящие пропущенные с номером; перезвон — первый отвеченный звонок на этот номер позже.
  missed AS (
    SELECT c.id, c.started_at, c.client_phone, c.lead_id,
           COALESCE(ld.current_owner_membership_id, v_nil) AS owner_key, op.display_name AS owner_name,
           cb.first_at, platform_private.telephony_report_deadline(c.started_at, v_days, v_close) AS deadline
    FROM calls c
    LEFT JOIN platform.leads ld ON ld.organization_id = p_organization_id AND ld.id = c.lead_id
    LEFT JOIN platform.organization_memberships om
      ON om.organization_id = p_organization_id AND om.id = ld.current_owner_membership_id
    LEFT JOIN platform.profiles op ON op.id = om.profile_id
    LEFT JOIN LATERAL (
      SELECT min(a.started_at) AS first_at
      FROM platform_private.telephony_calls a
      WHERE a.organization_id = p_organization_id AND a.client_phone = c.client_phone
        AND a.outcome = 'answered' AND a.started_at > c.started_at
    ) cb ON TRUE
    WHERE c.direction = 'in' AND c.outcome <> 'answered' AND c.client_phone IS NOT NULL
      AND NOT platform_private.telephony_chain_answered(p_organization_id, c.id)
  ),
  missed_calc AS (
    SELECT m.*,
      CASE
        WHEN m.first_at IS NOT NULL AND m.first_at <= m.deadline THEN
          CASE WHEN platform_private.telephony_work_seconds_between(m.started_at, m.first_at, v_days, v_open, v_close) <= v_sla_s
            THEN 'in_time' ELSE 'late' END
        WHEN m.deadline > v_now THEN 'pending'
        ELSE 'without'
      END AS state
    FROM missed m
  ),
  missed_agg AS (
    SELECT g.owner_key, GROUPING(g.owner_key) AS is_total,
      jsonb_build_object(
        'total', count(*),
        'inTime', count(*) FILTER (WHERE g.state = 'in_time'),
        'late', count(*) FILTER (WHERE g.state = 'late'),
        'pending', count(*) FILTER (WHERE g.state = 'pending'),
        'without', count(*) FILTER (WHERE g.state = 'without')
      ) AS j
    FROM missed_calc g
    GROUP BY GROUPING SETS ((g.owner_key), ())
  ),
  missed_list AS (
    SELECT m.id, m.started_at, m.client_phone, m.lead_id, m.owner_name
    FROM missed_calc m
    WHERE m.state = 'without' AND (v_all OR m.owner_key = v_actor.membership_id)
    ORDER BY m.started_at DESC, m.id DESC
    LIMIT 51
  ),
  -- Кто получает строку: участники звонков, владельцы лидов и пропущенных, сопоставленные
  -- сотрудники ВАТС (чтобы нулевая работа была видна) и сам сотрудник при праве «свои».
  ids AS (
    SELECT o.membership_id AS id FROM offered o
    UNION SELECT a.owner_key FROM lead_agg a WHERE a.is_total = 0 AND a.owner_key <> v_nil
    UNION SELECT a.owner_key FROM missed_agg a WHERE a.is_total = 0 AND a.owner_key <> v_nil
    UNION SELECT e.membership_id
      FROM platform_private.telephony_extensions e
      JOIN platform.organization_memberships em
        ON em.organization_id = e.organization_id AND em.id = e.membership_id AND em.status = 'active'
      WHERE e.organization_id = p_organization_id AND e.active AND e.membership_id IS NOT NULL
    UNION SELECT v_actor.membership_id WHERE NOT v_all
  ),
  report_rows AS (
    SELECT i.id, pr.display_name AS name,
      jsonb_build_object('membershipId', i.id, 'name', pr.display_name)
        || COALESCE(mc.j, jsonb_build_object(
          'calls', jsonb_build_object('in', 0, 'out', 0),
          'answered', jsonb_build_object('in', 0, 'out', 0),
          'talk', jsonb_build_object('seconds', 0, 'calls', 0),
          'result', jsonb_build_object('eligible', 0, 'set', 0)))
        || jsonb_build_object('firstCall', COALESCE(la.j, v_zero_first), 'missed', COALESCE(ma.j, v_zero_missed)) AS obj
    FROM ids i
    JOIN platform.organization_memberships om ON om.organization_id = p_organization_id AND om.id = i.id
    JOIN platform.profiles pr ON pr.id = om.profile_id
    LEFT JOIN mgr_calls mc ON mc.membership_id = i.id
    LEFT JOIN lead_agg la ON la.is_total = 0 AND la.owner_key = i.id
    LEFT JOIN missed_agg ma ON ma.is_total = 0 AND ma.owner_key = i.id
    WHERE v_all OR i.id = v_actor.membership_id
  )
  SELECT jsonb_build_object(
    'enabled', TRUE,
    'scope', CASE WHEN v_all THEN 'all' ELSE 'own' END,
    'from', p_from,
    'to', p_to,
    'slaMinutes', v_settings.callback_work_minutes,
    'team', CASE WHEN v_all THEN
      (SELECT tc.j FROM team_calls tc)
        || jsonb_build_object(
          'firstCall', COALESCE((SELECT a.j FROM lead_agg a WHERE a.is_total = 1), v_zero_first),
          'missed', COALESCE((SELECT a.j FROM missed_agg a WHERE a.is_total = 1), v_zero_missed))
      END,
    'managers', COALESCE((SELECT jsonb_agg(r.obj ORDER BY r.name COLLATE "C", r.id) FROM report_rows r), '[]'::JSONB),
    'unassigned', CASE WHEN v_all THEN jsonb_build_object(
      'firstCall', COALESCE((SELECT a.j FROM lead_agg a WHERE a.is_total = 0 AND a.owner_key = v_nil), v_zero_first),
      'missed', COALESCE((SELECT a.j FROM missed_agg a WHERE a.is_total = 0 AND a.owner_key = v_nil), v_zero_missed))
      END,
    'missedList', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'callId', x.id,
          'startedAt', x.started_at,
          'phone', platform_private.whatsapp_masked_phone(ltrim(x.client_phone, '+')),
          'leadId', x.lead_id,
          'ownerName', x.owner_name) ORDER BY x.started_at DESC, x.id DESC)
      FROM (SELECT * FROM missed_list ORDER BY started_at DESC, id DESC LIMIT 50) x), '[]'::JSONB),
    'missedMore', (SELECT count(*) > 50 FROM missed_list)
  ) INTO v_result;

  RETURN v_result;
END
$$;

-- ---------------------------------------------------------------------------
-- Права: помощники закрыты для всех клиентских ролей, отчёт — только для authenticated
-- (право и выключатель проверяются внутри).
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  platform_private.telephony_work_seconds_between(TIMESTAMPTZ, TIMESTAMPTZ, SMALLINT[], TIME, TIME),
  platform_private.telephony_report_deadline(TIMESTAMPTZ, SMALLINT[], TIME)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
REVOKE ALL ON FUNCTION platform.telephony_report_v1(UUID, DATE, DATE)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
GRANT EXECUTE ON FUNCTION platform.telephony_report_v1(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION platform.telephony_report_v1(UUID, DATE, DATE) IS
  'Telephony T10: the «Звонки» block of the sales report (per manager calls, answered, talk time, time to first call for new leads, missed without callback). telephony.report.read.all: everyone; read.own: the own row; empty unless ui_enabled; masked numbers only.';
COMMENT ON FUNCTION platform_private.telephony_work_seconds_between(TIMESTAMPTZ, TIMESTAMPTZ, SMALLINT[], TIME, TIME) IS
  'Telephony T10: working seconds between two moments by the settings hours (Asia/Bishkek, working days, open and close), at most 400 days.';
COMMENT ON FUNCTION platform_private.telephony_report_deadline(TIMESTAMPTZ, SMALLINT[], TIME) IS
  'Telephony T10: the close of the first working day strictly after the local date of the moment (the callback deadline of a missed incoming call).';

-- Проверка в конце: права ровно такие, как задумано.
DO $tel301_verify$
DECLARE
  r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'service_role', 'supabase_auth_admin', 'evo_ai_agent'] LOOP
    IF has_function_privilege(r, 'platform.telephony_report_v1(uuid,date,date)', 'EXECUTE') THEN
      RAISE EXCEPTION 'telephony_report_acl_drift: %', r USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF has_function_privilege('public', 'platform.telephony_report_v1(uuid,date,date)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'platform.telephony_report_v1(uuid,date,date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'telephony_report_acl_drift: authenticated' USING ERRCODE = '55000';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'supabase_auth_admin', 'evo_ai_agent'] LOOP
    IF has_function_privilege(r, 'platform_private.telephony_work_seconds_between(timestamptz,timestamptz,smallint[],time,time)', 'EXECUTE')
       OR has_function_privilege(r, 'platform_private.telephony_report_deadline(timestamptz,smallint[],time)', 'EXECUTE') THEN
      RAISE EXCEPTION 'telephony_report_helper_acl_drift: %', r USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$tel301_verify$;

COMMIT;
