-- ============================================================
-- 338_platform_default_document_checklist.sql
--
-- Список документов по умолчанию (решение 06.11.2026, слова пользователя: «этот список поставь на наш сайт»,
-- «если у студента есть кабинет то просто там будут доки»). У дела студента с кабинетом (student_membership_id и
-- portal_activated_at, как student_has_portal в 329), страной Китай или Малайзия и ещё без единого пункта документов
-- пункты создаются сами, без кнопки и без куратора. Список взят из того, что собирали в amoCRM:
--   Китай (10): загранпаспорт, фото, аттестат или транскрипт, справка с места учёбы, справка о несудимости,
--               медицинская справка, справка из банка, мотивационное письмо, рекомендательные письма,
--               сертификат по языку — если есть;
--   Малайзия (4): загранпаспорт, фото, аттестат или транскрипт, сертификат по языку.
--
-- Пункты — обычные пункты дела (intent 'custom', 108): куратор их переименовывает и убирает, как любые другие.
-- Шаблоны стран (053/179) не трогаются: у новых дел маршрут (degree, program) — свободный текст, точного совпадения
-- шаблона по нему не бывает. Страна дела: admissions_direction, иначе target_country, иначе страна анкеты студента.
-- Кто видит: правила не меняются. Студент — во вкладке «Документы» кабинета, сотрудник — в деле, как и раньше
-- (192: документы после передачи в работу); пункты просто уже стоят.
--
-- Когда: отложенный триггер дела в конце транзакции, когда дело, кабинет и анкета уже связаны (одобрение анкеты,
-- приглашение, выбор страны сотрудником, передача). Дело, где пункты уже есть или были (в том числе убранные), не
-- трогается никогда, поэтому список ставится один раз. Ошибка постановки не ломает действие, которое её вызвало:
-- триггер пишет WARNING и выходит. Один раз здесь же — для уже существующих дел с кабинетом.
-- Новых прав нет: функции закрыты от всех ролей, вызываются только триггером и этой миграцией.
-- ============================================================

BEGIN;

DO $a338_guard$
BEGIN
  IF to_regprocedure('platform_private.seed_default_document_checklist(uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'a338_already_applied' USING ERRCODE = '55000';
  END IF;
END
$a338_guard$;

-- Списки. Порядок — как в таблице, которую утвердил пользователь.
CREATE FUNCTION platform_private.default_document_checklist(p_direction TEXT)
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
    ('CN', 4, 'Справка с места учёбы', 'Обязательные документы'),
    ('CN', 5, 'Справка о несудимости', 'Обязательные документы'),
    ('CN', 6, 'Медицинская справка', 'Обязательные документы'),
    ('CN', 7, 'Справка из банка', 'Обязательные документы'),
    ('CN', 8, 'Мотивационное письмо', 'Обязательные документы'),
    ('CN', 9, 'Рекомендательные письма', 'Обязательные документы'),
    ('CN', 10, 'Сертификат по языку (IELTS, TOEFL), если есть', 'Если есть'),
    ('MY', 1, 'Загранпаспорт', 'Обязательные документы'),
    ('MY', 2, 'Фото', 'Обязательные документы'),
    ('MY', 3, 'Аттестат или транскрипт', 'Обязательные документы'),
    ('MY', 4, 'Сертификат по языку (IELTS, TOEFL)', 'Обязательные документы')
  ) AS item(direction, item_position, label, group_label)
  WHERE item.direction = p_direction
  ORDER BY item.item_position
$$;

-- Поставить список одному делу. Возвращает число созданных пунктов (0 — делать было нечего).
CREATE FUNCTION platform_private.seed_default_document_checklist(
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

  -- Пункты уже есть или были: список не ставится повторно и не дополняется.
  IF EXISTS (
    SELECT 1
    FROM platform.document_slots AS slot
    WHERE slot.organization_id = p_organization_id
      AND slot.student_case_id = p_student_case_id
  ) THEN
    RETURN 0;
  END IF;

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
  IF direction IS NULL OR direction NOT IN ('CN', 'MY') THEN
    RETURN 0;
  END IF;

  -- Автор пункта: куратор дела, пока его нет — сам студент (поле обязательное, на экран не выводится).
  creator := COALESCE(target_case.current_curator_membership_id, target_case.student_membership_id);

  -- Кабинет показывает пункты по id (128): первый байт id — номер пункта, поэтому порядок как в списке.
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
    (lpad(to_hex(item.item_position), 2, '0') || substr(item.hash, 3, 10) || '4' || substr(item.hash, 14, 3)
      || '8' || substr(item.hash, 18, 15))::UUID,
    p_organization_id,
    p_student_case_id,
    NULL,
    'custom',
    item.label,
    item.group_label,
    'required',
    1,
    creator
  FROM (
    SELECT list.item_position, list.label, list.group_label,
      md5(p_student_case_id::TEXT || ':' || list.label) AS hash
    FROM platform_private.default_document_checklist(direction) AS list
  ) AS item
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
      'Default document checklist for a student with a portal',
      public.uuid_generate_v5(p_student_case_id, 'default-document-checklist')
    )
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN created_count;
END
$$;

CREATE FUNCTION platform_private.student_case_default_document_checklist()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  BEGIN
    PERFORM platform_private.seed_default_document_checklist(NEW.organization_id, NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'default_document_checklist_skipped: % (%)', SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER student_cases_default_document_checklist
  AFTER INSERT OR UPDATE OF student_membership_id, portal_activated_at, admissions_direction, target_country, state
  ON platform.student_cases
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.student_membership_id IS NOT NULL AND NEW.portal_activated_at IS NOT NULL
    AND NEW.state IN ('pending', 'active'))
  EXECUTE FUNCTION platform_private.student_case_default_document_checklist();

REVOKE ALL ON FUNCTION
  platform_private.default_document_checklist(TEXT),
  platform_private.seed_default_document_checklist(UUID, UUID),
  platform_private.student_case_default_document_checklist()
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

COMMENT ON FUNCTION platform_private.default_document_checklist(TEXT)
  IS 'Default document checklist per admissions direction (CN, MY), in display order.';
COMMENT ON FUNCTION platform_private.seed_default_document_checklist(UUID, UUID)
  IS 'Creates the default document checklist for a case with a student portal and a CN or MY direction that has never had a document slot. Returns the number of created slots.';

-- Один раз: дела, у которых кабинет уже есть.
DO $a338_backfill$
BEGIN
  PERFORM platform_private.seed_default_document_checklist(student_case.organization_id, student_case.id)
  FROM platform.student_cases AS student_case
  WHERE student_case.student_membership_id IS NOT NULL
    AND student_case.portal_activated_at IS NOT NULL
    AND student_case.state IN ('pending', 'active');
END
$a338_backfill$;

COMMIT;
