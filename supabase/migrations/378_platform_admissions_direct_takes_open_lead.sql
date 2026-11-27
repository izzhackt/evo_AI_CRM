-- 378: «Новый студент» забирает открытый лид продаж, а не отказывает.
--
-- Было (281): если у человека с тем же телефоном или почтой есть открытый лид
-- в продажах, команда «Добавить студента» падала с admissions_direct_lead_exists:
-- «дело появится, когда продажи передадут его в поступление». Продажи в CRM
-- лиды не передают (передавать некому), и куратор или Admin не мог завести
-- дело вообще: человек застревал между продажами и поступлением.
--
-- Стало: команда сотрудника берёт этот открытый лид (самый свежий по
-- updated_at, как и раньше) и его клиента и заводит дело на них:
--   * лид становится `converted` (охрана 084 разрешает open -> converted), его
--     направление интереса уточняется направлением формы, если оно названо;
--   * новые клиент и лид не создаются, кандидаты в дубли не пишутся;
--   * дело — тот же исток `admissions-direct:<лид>` (CHECK
--     student_cases_intake_origin_check уже его принимает), куратор, этап,
--     анкета, заметка, деньги — как у нового человека;
--   * условия продажи лида (lead_sale_conditions), если продажи их уже
--     записали, дополняются стоимостью и датой из формы (revision + 1), а не
--     падают на первичном ключе. Поверх записанного ложатся только значения,
--     заполненные в форме (не весь результат нормализатора с пустыми
--     умолчаниями): название услуги, оплата, заметки и пожелания продаж, а
--     также цена, когда в форме одна дата, остаются как были;
--   * в квитанции и в журнале `case.create` — `lead_taken: true`.
-- Дело в работе у человека по-прежнему отказ (admissions_direct_case_exists).
-- Служебный импорт (import_admissions_student_case_v1) не меняется: для
-- открытого лида он, как и раньше, отвечает строкой lead_exists и ничего не
-- создаёт.
--
-- Тело меняется самопроверяемой заменой (как 302 и 376): каждый якорь должен
-- встретиться ровно один раз, иначе миграция падает (a378_anchor_drift:<n>), а
-- не тихо пропускает изменение. Повтор — a378_already_applied. Права,
-- владелец и сигнатура не меняются.

DO $a378_direct$
DECLARE
  sig CONSTANT TEXT := 'platform_private.create_admissions_student_case(uuid,uuid,uuid,jsonb,text,text,text)';
  original TEXT;
  body TEXT;
  pairs TEXT[][];
  n INTEGER;
BEGIN
  IF to_regprocedure(sig) IS NULL THEN
    RAISE EXCEPTION 'a378_function_missing';
  END IF;
  original := pg_get_functiondef(to_regprocedure(sig));
  IF position('lead_taken' IN original) > 0 THEN
    RAISE EXCEPTION 'a378_already_applied';
  END IF;
  body := original;

  pairs := ARRAY[
    -- 1. Переменные: клиент открытого лида и флаг «лид взят».
    ARRAY[$o1$  existing_case_id UUID; open_lead_id UUID; lock_value TEXT;$o1$,
          $n1$  existing_case_id UUID; open_lead_id UUID; lock_value TEXT;
  open_lead_client_id UUID; lead_taken BOOLEAN := FALSE;$n1$],
    -- 2. Поиск открытого лида отдаёт и его клиента.
    ARRAY[$o2$    SELECT l.id INTO open_lead_id
    FROM platform.clients cl$o2$,
          $n2$    SELECT l.id, l.client_id INTO open_lead_id, open_lead_client_id
    FROM platform.clients cl$n2$],
    -- 3. Сотрудник не получает отказ: лид берётся в дело. Импорт — как был.
    ARRAY[$o3$    RAISE EXCEPTION 'admissions_direct_lead_exists' USING ERRCODE = 'PT409', DETAIL = open_lead_id::TEXT;
  END IF;$o3$,
          $n3$    -- 378: продажи в CRM лиды не передают — команда сотрудника берёт
    -- открытый лид и его клиента и заводит дело на них.
    lead_taken := TRUE;
  END IF;$n3$],
    -- 4. Новые клиент и лид — только когда лид не взят.
    ARRAY[$o4$  client_reused := phone_norm IS NOT NULL AND email_norm IS NOT NULL AND EXISTS ($o4$,
          $n4$  IF lead_taken THEN
    client_id_value := open_lead_client_id;
    lead_id_value := open_lead_id;
  ELSE
  client_reused := phone_norm IS NOT NULL AND email_norm IS NOT NULL AND EXISTS ($n4$],
    ARRAY[$o5$    CASE WHEN is_import THEN observed END, p_external_ref);
  -- Already a client, never a sales lead (084's guard allows open -> converted).$o5$,
          $n5$    CASE WHEN is_import THEN observed END, p_external_ref);
  END IF;
  -- Already a client, never a sales lead (084's guard allows open -> converted).$n5$],
    -- 5. Направление интереса: у взятого лида не стирается, если в форме его нет.
    ARRAY[$o6$    interest_direction = CASE direction WHEN 'EUROPE' THEN 'EU' ELSE direction END$o6$,
          $n6$    interest_direction = COALESCE(CASE direction WHEN 'EUROPE' THEN 'EU' ELSE direction END, l.interest_direction)$n6$],
    -- 6. Условия продажи взятого лида дополняются, а не падают на ключе.
    ARRAY[$o7$      'signing_date', to_char(signed_on, 'YYYY-MM-DD')))), 1, actor.membership_id);$o7$,
          $n7$      'signing_date', to_char(signed_on, 'YYYY-MM-DD')))), 1, actor.membership_id)
    ON CONFLICT (lead_id) DO UPDATE SET
      fields = platform_private.lead_sale_condition_fields(
        platform_private.lead_sale_conditions.fields || jsonb_strip_nulls(jsonb_build_object(
          'service_cost_minor', cost_minor::TEXT, 'service_cost_currency', cost_currency,
          'signing_date', to_char(signed_on, 'YYYY-MM-DD')))),
      revision = platform_private.lead_sale_conditions.revision + 1,
      updated_by_membership_id = EXCLUDED.updated_by_membership_id,
      updated_at = statement_timestamp();$n7$],
    -- 7. Квитанция и журнал говорят, что лид взят.
    ARRAY[$o8$    'client_reused', client_reused,$o8$,
          $n8$    'client_reused', client_reused,
    'lead_taken', lead_taken,$n8$]
  ];

  FOR n IN 1 .. array_length(pairs, 1) LOOP
    IF (length(body) - length(replace(body, pairs[n][1], ''))) / length(pairs[n][1]) <> 1 THEN
      RAISE EXCEPTION 'a378_anchor_drift:%', n;
    END IF;
    body := replace(body, pairs[n][1], pairs[n][2]);
  END LOOP;

  EXECUTE body;
END
$a378_direct$;
