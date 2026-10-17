-- 302_platform_parent_phone_lookalikes: подсказка «Похоже на». Номер лида или дела
-- записан как телефон родителя в анкете другого студента (#1198, пункт 2).
-- Номер миграции предварительный: окончательный берётся при слиянии по свежему
-- `origin/main` (последняя на момент работы 301); имя файла к номеру не привязано,
-- хук набора в `scripts/test-postgres-authorization.sh` ищет по имени.
-- Контракт: docs/PLAN_CHANGES.md, запись 2026-10-18 «Телефоны: подсказка «Похоже на»»;
-- решение владельца 18.10.2026 (вопрос 22): при совпадении с телефоном родителя
-- карточки НЕ объединять, показать сотруднику «Похоже на: …» со ссылкой для ручной
-- проверки.
--
-- Что делает: только чтение, без таблиц, колонок, журнала и триггеров.
--  * platform.read_parent_phone_lookalikes_v1(организация, лид | дело) для
--    authenticated; ровно один из двух субъектов. Берёт телефон клиента субъекта
--    (platform.clients.normalized_phone: у лида клиент лида, у дела клиент дела,
--    а без него клиент лида дела) и ищет в анкетах дел организации поля
--    father_mobile_phone / mother_mobile_phone, у которых совпадает хотя бы один из
--    ключей сопоставления (platform_private.person_phone_match_keys, тот же разбор
--    написаний, что у «Добавить студента», импорта и приёма лидов). Ничего не
--    объединяет, не создаёт и не меняет.
--  * Кого не показывает: само дело субъекта и дела того же клиента (это тот же
--    человек, а не «похожий»).
--  * Права. Субъект: лид читает тот, кто читает его карточку
--    (private.platform_can_read_canonical_lead), дело тот, кто читает дело
--    (private.platform_can_read_student_case); иначе 42501 (и для чужого, и для
--    несуществующего id, без различия). Каждое найденное дело показывается, только
--    если тот же сотрудник читает его целиком (private.platform_can_read_student_case)
--    И читает его анкету (`profile.read.full` на это дело): родитель записан в анкете,
--    а право Sales («только сводка после передачи») её не включает. Дело без этих
--    прав просто не попадает в ответ, ответ не отличается от «совпадений нет».
--    Student, сессия без членства, anon и service_role получают 42501.
--  * Ответ: JSONB-массив до 5 элементов {studentCaseId, studentName, relation}, relation
--    это father | mother | both. Телефон родителя, имя родителя и сам номер в ответ не
--    попадают. Сначала дела в работе, потом по давности. Пустой массив значит, что
--    совпадений или номера нет.
--  * В журнал и сообщения об ошибках номера и имена не попадают: сообщения постоянные.
--
-- Что НЕ меняет (границы #1198): сопоставление «тот же человек» при приёме лидов,
-- «Добавить студента» и импорте остаётся по телефону и почте студента; номер другой
-- страны без «+» (пункт 1) и заявка после прямого дела (пункт 3) здесь не затронуты.
-- Повторный запуск целой миграции отказывает (CREATE FUNCTION), ничего не меняя.
BEGIN;

CREATE FUNCTION platform.read_parent_phone_lookalikes_v1(
  p_organization_id UUID,
  p_lead_id UUID DEFAULT NULL,
  p_student_case_id UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  subject_client UUID;
  subject_phone TEXT;
  subject_keys TEXT[];
  subject_tail TEXT;
  result JSONB;
BEGIN
  IF p_organization_id IS NULL OR (p_lead_id IS NULL) = (p_student_case_id IS NULL) THEN
    RAISE EXCEPTION 'parent_phone_lookalikes_invalid' USING ERRCODE = '22023';
  END IF;

  -- A staff session of this organization; a Student, a session without a
  -- membership, anon and service_role have no actor.
  SELECT a.* INTO actor FROM platform.current_actor_authority() a
    WHERE a.organization_id = p_organization_id AND a.membership_id IS NOT NULL
      AND a.platform_role IS DISTINCT FROM 'student';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'parent_phone_lookalikes_forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_lead_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM platform.leads l WHERE l.organization_id = p_organization_id AND l.id = p_lead_id)
      OR NOT private.platform_can_read_canonical_lead(p_organization_id, p_lead_id) THEN
      RAISE EXCEPTION 'parent_phone_lookalikes_forbidden' USING ERRCODE = '42501';
    END IF;
    SELECT l.client_id INTO subject_client FROM platform.leads l
      WHERE l.organization_id = p_organization_id AND l.id = p_lead_id;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM platform.student_cases c WHERE c.organization_id = p_organization_id AND c.id = p_student_case_id)
      OR NOT private.platform_can_read_student_case(p_organization_id, p_student_case_id) THEN
      RAISE EXCEPTION 'parent_phone_lookalikes_forbidden' USING ERRCODE = '42501';
    END IF;
    SELECT COALESCE(c.canonical_client_id,
        (SELECT l.client_id FROM platform.leads l WHERE l.organization_id = c.organization_id AND l.id = c.canonical_lead_id))
      INTO subject_client
      FROM platform.student_cases c WHERE c.organization_id = p_organization_id AND c.id = p_student_case_id;
  END IF;

  -- The same person is not «похожий»: keep the canonical client of the subject.
  subject_client := platform_private.resolve_canonical_client_id(p_organization_id, subject_client);
  SELECT cl.normalized_phone INTO subject_phone FROM platform.clients cl
    WHERE cl.organization_id = p_organization_id AND cl.id = subject_client;
  subject_keys := platform_private.person_phone_match_keys(subject_phone);
  IF cardinality(subject_keys) = 0 THEN
    RETURN '[]'::JSONB;
  END IF;
  -- Every spelling of one number ends in the same digits, so the last seven are a cheap necessary
  -- condition: the key expansion (about 80 microseconds a value) runs only for the few that pass it.
  subject_tail := right(regexp_replace(subject_phone, '[^0-9]', '', 'g'), 7);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'studentCaseId', top.case_id, 'studentName', top.student_name, 'relation', top.relation)
      ORDER BY top.rank, top.created_at DESC, top.case_id), '[]'::JSONB)
    INTO result
  FROM (
    SELECT m.* FROM (
      SELECT c.id AS case_id, c.student_display_name AS student_name, c.created_at,
        CASE WHEN c.state IN ('pending', 'active') THEN 0 ELSE 1 END AS rank,
        CASE WHEN bool_or(f.field_key = 'father_mobile_phone') AND bool_or(f.field_key = 'mother_mobile_phone') THEN 'both'
          WHEN bool_or(f.field_key = 'father_mobile_phone') THEN 'father' ELSE 'mother' END AS relation,
        platform_private.resolve_canonical_client_id(c.organization_id, COALESCE(c.canonical_client_id,
          (SELECT l.client_id FROM platform.leads l WHERE l.organization_id = c.organization_id AND l.id = c.canonical_lead_id))) AS case_client
      FROM platform.student_profile_fields f
      JOIN platform.student_cases c ON c.organization_id = f.organization_id AND c.id = f.student_case_id
      WHERE f.organization_id = p_organization_id
        AND f.field_key IN ('father_mobile_phone', 'mother_mobile_phone')
        AND f.value IS NOT NULL
        AND right(regexp_replace(f.value, '[^0-9]', '', 'g'), 7) = subject_tail
        AND c.id IS DISTINCT FROM p_student_case_id
        AND platform_private.person_phone_match_keys(f.value) && subject_keys
      GROUP BY c.id, c.student_display_name, c.created_at, c.state, c.organization_id, c.canonical_client_id, c.canonical_lead_id
    ) m
    WHERE m.case_client IS DISTINCT FROM subject_client
      AND private.platform_can_read_student_case(p_organization_id, m.case_id)
      AND platform_private.staff_can_access_for_actor(p_organization_id, 'profile.read.full', 'student_case', m.case_id)
    ORDER BY m.rank, m.created_at DESC, m.case_id
    LIMIT 5
  ) top;
  RETURN result;
END
$$;

REVOKE ALL ON FUNCTION platform.read_parent_phone_lookalikes_v1(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
GRANT EXECUTE ON FUNCTION platform.read_parent_phone_lookalikes_v1(UUID, UUID, UUID) TO authenticated;

COMMENT ON FUNCTION platform.read_parent_phone_lookalikes_v1(UUID, UUID, UUID) IS
  'Parent-phone hint (#1198, point 2): the cases whose анкета records the phone of a lead or case as the phone of a father or mother. Read only, never merges. Subject: lead.read on the lead or case read on the case; each match only if the actor reads the case and its анкета (profile.read.full); up to 5 {studentCaseId, studentName, relation}; no phone or parent name is returned.';

-- Проверка в конце: права ровно такие, как задумано, и функция не пишет.
DO $a302_verify$
DECLARE
  r TEXT;
  signature CONSTANT REGPROCEDURE := 'platform.read_parent_phone_lookalikes_v1(uuid,uuid,uuid)'::REGPROCEDURE;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'service_role', 'supabase_auth_admin', 'evo_ai_agent'] LOOP
    IF has_function_privilege(r, signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'parent_phone_lookalikes_acl_drift: %', r USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF has_function_privilege('public', signature, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'parent_phone_lookalikes_acl_drift: authenticated' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = signature AND p.prosecdef
      AND p.provolatile = 's' AND p.proconfig = ARRAY['search_path=""']) THEN
    RAISE EXCEPTION 'parent_phone_lookalikes_definer_drift' USING ERRCODE = '55000';
  END IF;
END
$a302_verify$;

NOTIFY pgrst, 'reload schema';
COMMIT;
