-- ============================================================
-- 364_platform_cn_document_checklist_guide.sql
--
-- Список документов Китая по руководству куратора (20.11.2026: руководитель согласился дополнить список Китая по
-- руководству куратора; руководство от 15.10.2026, набор сентябрь 2027, раздел 4 «Документы»). Список 338 был взят
-- из amoCRM; руководство называет 16 документов. В список дела идут 14 (порядок и группы — как ниже); видео-резюме
-- CRM не принимает (только PDF, JPG, PNG, см. 06.11 в product.md), анкету вуза заполняет куратор.
--   Китай (14): загранпаспорт, фото, аттестат или транскрипт, сертификат по языку (HSK, IELTS или TOEFL),
--               результаты CSCA (группа «Для бакалавриата»), справка о несудимости, медицинская справка, справка из
--               банка, мотивационное письмо, рекомендательные письма, паспорта и данные родителей, справка с места
--               учёбы («Если сейчас учитесь»), нотариальное согласие родителей на выезд и свидетельство о рождении
--               («Если вам нет 18 лет»);
--   Малайзия (4): без изменений, как в 338.
--
-- Новые дела: постановка 338 (триггер и seed_default_document_checklist) не меняется, она просто берёт новый список.
-- Дела, которые уже получили список Китая из 338, один раз дополняются: только пять пунктов, которых в прежнем
-- списке не было, и только если в деле нет пункта с таким же названием (активного или убранного). Сертификат по
-- языку не добавляется, если в деле есть пункт, название которого начинается с «Сертификат по языку», или жив пункт
-- сертификата из 338 под любым названием (куратор мог его переименовать): второй сертификат был бы дублем.
-- Прежние пункты не переименовываются, не перекладываются в другие группы и не убираются. Новые пункты — такие же,
-- как ставит 338 (custom, required, автор — куратор дела, иначе студент), номера идут после пунктов 338 (11 и дальше),
-- поэтому в кабинете они стоят после них. Какие дела: как в 338 — кабинет есть, дело pending или active, страна
-- Китай (admissions_direction, иначе target_country, иначе анкета); «получило список 338» узнаётся по id пунктов
-- (id 338 не меняется при переименовании и уборке, пункты не удаляются).
--
-- Хук набора в `scripts/test-runners/test-postgres-authorization.sh` привязан к имени файла. Forward-only: повтор
-- отказывает a364_already_applied; если список 338 уже не тот, что ожидается, — a364_list_drift. Новых прав нет:
-- функции закрыты от всех ролей, вызываются только миграцией и набором.
-- ============================================================

BEGIN;

DO $a364_guard$
BEGIN
  IF to_regprocedure('platform_private.extend_default_document_checklist_cn_guide(uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'a364_already_applied' USING ERRCODE = '55000';
  END IF;
  IF (
    SELECT string_agg(list.item_position || ':' || list.label || ':' || list.group_label, ' | ' ORDER BY list.item_position)
    FROM platform_private.default_document_checklist('CN') AS list
  ) IS DISTINCT FROM '1:Загранпаспорт:Обязательные документы | 2:Фото:Обязательные документы | '
      || '3:Аттестат или транскрипт:Обязательные документы | 4:Справка с места учёбы:Обязательные документы | '
      || '5:Справка о несудимости:Обязательные документы | 6:Медицинская справка:Обязательные документы | '
      || '7:Справка из банка:Обязательные документы | 8:Мотивационное письмо:Обязательные документы | '
      || '9:Рекомендательные письма:Обязательные документы | 10:Сертификат по языку (IELTS, TOEFL), если есть:Если есть'
    OR (
      SELECT string_agg(list.item_position || ':' || list.label || ':' || list.group_label, ' | ' ORDER BY list.item_position)
      FROM platform_private.default_document_checklist('MY') AS list
    ) IS DISTINCT FROM '1:Загранпаспорт:Обязательные документы | 2:Фото:Обязательные документы | '
      || '3:Аттестат или транскрипт:Обязательные документы | 4:Сертификат по языку (IELTS, TOEFL):Обязательные документы'
  THEN
    RAISE EXCEPTION 'a364_list_drift: the 338 default document checklist is not the expected one' USING ERRCODE = '55000';
  END IF;
END
$a364_guard$;

-- Списки. Китай — по руководству куратора; Малайзия — как в 338.
CREATE OR REPLACE FUNCTION platform_private.default_document_checklist(p_direction TEXT)
RETURNS TABLE (item_position INTEGER, label TEXT, group_label TEXT)
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT item.item_position, item.label, item.group_label
  FROM (VALUES
    ('CN', 1, 'Загранпаспорт', 'Обязательные документы'),
    ('CN', 2, 'Фото', 'Обязательные документы'),
    ('CN', 3, 'Аттестат или транскрипт', 'Обязательные документы'),
    ('CN', 4, 'Сертификат по языку (HSK, IELTS или TOEFL)', 'Обязательные документы'),
    ('CN', 5, 'Результаты CSCA, для бакалавриата', 'Для бакалавриата'),
    ('CN', 6, 'Справка о несудимости', 'Обязательные документы'),
    ('CN', 7, 'Медицинская справка', 'Обязательные документы'),
    ('CN', 8, 'Справка из банка', 'Обязательные документы'),
    ('CN', 9, 'Мотивационное письмо', 'Обязательные документы'),
    ('CN', 10, 'Рекомендательные письма', 'Обязательные документы'),
    ('CN', 11, 'Паспорта и данные родителей', 'Обязательные документы'),
    ('CN', 12, 'Справка с места учёбы, если сейчас учитесь', 'Если сейчас учитесь'),
    ('CN', 13, 'Нотариальное согласие родителей на выезд, если вам нет 18 лет', 'Если вам нет 18 лет'),
    ('CN', 14, 'Свидетельство о рождении, если вам нет 18 лет', 'Если вам нет 18 лет'),
    ('MY', 1, 'Загранпаспорт', 'Обязательные документы'),
    ('MY', 2, 'Фото', 'Обязательные документы'),
    ('MY', 3, 'Аттестат или транскрипт', 'Обязательные документы'),
    ('MY', 4, 'Сертификат по языку (IELTS, TOEFL)', 'Обязательные документы')
  ) AS item(direction, item_position, label, group_label)
  WHERE item.direction = p_direction
  ORDER BY item.item_position
$$;

-- Дополнить одно дело, получившее список Китая из 338. Возвращает число созданных пунктов (0 — делать было нечего).
-- Повторный вызов ничего не добавляет: каждый новый пункт уже есть по названию.
CREATE FUNCTION platform_private.extend_default_document_checklist_cn_guide(
  p_organization_id UUID,
  p_student_case_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_case platform.student_cases%ROWTYPE;
  direction TEXT;
  creator UUID;
  created_count INTEGER;
BEGIN
  SELECT * INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id
  FOR UPDATE;

  IF NOT FOUND
    OR target_case.state NOT IN ('pending', 'active')
    OR target_case.student_membership_id IS NULL
    OR target_case.portal_activated_at IS NULL
  THEN
    RETURN 0;
  END IF;

  -- Страна дела — как в 338: admissions_direction, иначе target_country, иначе страна анкеты студента.
  direction := target_case.admissions_direction;
  IF direction IS NULL THEN
    direction := platform_private.student_application_direction(upper(btrim(target_case.target_country)));
  END IF;
  IF direction IS NULL THEN
    SELECT application.admissions_direction INTO direction
    FROM platform_private.student_applications AS application
    WHERE application.organization_id = p_organization_id
      AND (application.student_case_id = p_student_case_id OR application.invited_case_id = p_student_case_id)
    ORDER BY application.submitted_at DESC NULLS LAST, application.id DESC
    LIMIT 1;
  END IF;
  IF direction IS DISTINCT FROM 'CN' THEN
    RETURN 0;
  END IF;

  -- Автор пункта — как в 338: куратор дела, пока его нет — сам студент.
  creator := COALESCE(target_case.current_curator_membership_id, target_case.student_membership_id);

  WITH previous_list(item_position, label) AS (
    -- Список Китая, который ставила 338.
    VALUES
      (1, 'Загранпаспорт'),
      (2, 'Фото'),
      (3, 'Аттестат или транскрипт'),
      (4, 'Справка с места учёбы'),
      (5, 'Справка о несудимости'),
      (6, 'Медицинская справка'),
      (7, 'Справка из банка'),
      (8, 'Мотивационное письмо'),
      (9, 'Рекомендательные письма'),
      (10, 'Сертификат по языку (IELTS, TOEFL), если есть')
  ),
  previous_ids AS (
    SELECT previous_list.item_position,
      md5(p_student_case_id::TEXT || ':' || previous_list.label) AS hash
    FROM previous_list
  ),
  -- Пункты, поставленные 338 этому делу: id 338 — номер пункта и md5 дела с названием; он не меняется, когда куратор
  -- переименовывает или убирает пункт.
  seeded AS (
    SELECT previous_ids.item_position
    FROM previous_ids
    JOIN platform.document_slots AS slot
      ON slot.organization_id = p_organization_id
      AND slot.student_case_id = p_student_case_id
      AND slot.id = (lpad(to_hex(previous_ids.item_position), 2, '0') || substr(previous_ids.hash, 3, 10) || '4'
        || substr(previous_ids.hash, 14, 3) || '8' || substr(previous_ids.hash, 18, 15))::UUID
  ),
  -- Все названия дела: активные и убранные, свои и из шаблона страны.
  case_labels AS (
    SELECT lower(btrim(COALESCE(slot.display_label, requirement.label))) AS label
    FROM platform.document_slots AS slot
    LEFT JOIN platform.document_requirements AS requirement
      ON requirement.organization_id = slot.organization_id
      AND requirement.id = slot.requirement_id
    WHERE slot.organization_id = p_organization_id
      AND slot.student_case_id = p_student_case_id
  ),
  added AS (
    SELECT list.label, list.group_label,
      (SELECT max(seeded.item_position) FROM seeded) + row_number() OVER (ORDER BY list.item_position) AS slot_position,
      md5(p_student_case_id::TEXT || ':' || list.label) AS hash
    FROM platform_private.default_document_checklist('CN') AS list
    -- Дело получило именно список Китая: первые три пункта у Малайзии те же, поэтому нужен пункт с номером 4 и дальше.
    WHERE EXISTS (SELECT 1 FROM seeded WHERE seeded.item_position >= 4)
      AND list.label NOT IN (SELECT previous_list.label FROM previous_list)
      -- Условие стоит в названии после запятой («…, если вам нет 18 лет»): пункт с тем же названием без условия
      -- (свой пункт куратора или «Справка с места учёбы» из 338) тоже считается тем же документом.
      AND NOT EXISTS (
        SELECT 1 FROM case_labels
        WHERE case_labels.label = lower(list.label)
          OR starts_with(case_labels.label, split_part(lower(list.label), ',', 1))
      )
      AND NOT (
        starts_with(list.label, 'Сертификат по языку')
        AND (
          EXISTS (SELECT 1 FROM case_labels WHERE starts_with(case_labels.label, lower('Сертификат по языку')))
          OR EXISTS (SELECT 1 FROM seeded WHERE seeded.item_position = 10)
        )
      )
  )
  -- Как в 338: первый байт id — номер пункта, кабинет сортирует по id.
  INSERT INTO platform.document_slots (
    id,
    organization_id,
    student_case_id,
    requirement_id,
    intent_kind,
    display_label,
    group_label,
    status,
    version,
    created_by_membership_id
  )
  SELECT
    (lpad(to_hex(added.slot_position), 2, '0') || substr(added.hash, 3, 10) || '4' || substr(added.hash, 14, 3)
      || '8' || substr(added.hash, 18, 15))::UUID,
    p_organization_id,
    p_student_case_id,
    NULL,
    'custom',
    added.label,
    added.group_label,
    'required',
    1,
    creator
  FROM added
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS created_count = ROW_COUNT;

  IF created_count > 0 THEN
    INSERT INTO platform.audit_events (
      organization_id,
      actor_kind,
      actor_profile_id,
      actor_principal,
      action,
      resource_type,
      resource_id,
      before_state,
      after_state,
      reason,
      request_id
    )
    VALUES (
      p_organization_id,
      'system',
      NULL,
      'system:default-document-checklist',
      'document.checklist.baseline.seed',
      'student_case',
      p_student_case_id,
      NULL,
      jsonb_build_object(
        'organization_id', p_organization_id,
        'student_case_id', p_student_case_id,
        'admissions_direction', direction,
        'seeded_count', created_count::TEXT
      ),
      'Default document checklist for China extended by the curator guide',
      public.uuid_generate_v5(p_student_case_id, 'default-document-checklist-cn-guide')
    )
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN created_count;
END
$$;

REVOKE ALL ON FUNCTION
  platform_private.default_document_checklist(TEXT),
  platform_private.extend_default_document_checklist_cn_guide(UUID, UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

COMMENT ON FUNCTION platform_private.default_document_checklist(TEXT)
  IS 'Default document checklist per admissions direction (CN by the curator guide since 364, MY), in display order.';
COMMENT ON FUNCTION platform_private.extend_default_document_checklist_cn_guide(UUID, UUID)
  IS 'One-time 364 extension of a China case that got the 338 checklist: adds the guide items it never had by label. Returns the number of created slots.';

-- Один раз: дела, которые уже получили список Китая из 338.
DO $a364_backfill$
DECLARE
  extended_cases INTEGER;
  created_slots INTEGER;
BEGIN
  SELECT count(*) FILTER (WHERE extension.created > 0), COALESCE(sum(extension.created), 0)
  INTO extended_cases, created_slots
  FROM (
    SELECT platform_private.extend_default_document_checklist_cn_guide(student_case.organization_id, student_case.id) AS created
    FROM platform.student_cases AS student_case
    WHERE student_case.student_membership_id IS NOT NULL
      AND student_case.portal_activated_at IS NOT NULL
      AND student_case.state IN ('pending', 'active')
  ) AS extension;
  RAISE NOTICE 'a364_backfill: % case(s) extended, % item(s) added', extended_cases, created_slots;
END
$a364_backfill$;

COMMIT;
