-- 334 «Анкета приглашённого студента видна в деле» (решение владельца 03.11.2026: «анкета студента, пришедшего по приглашению,
-- не видна сотрудникам — чинить»).
-- Что было: platform.staff_student_application_for_case_v1 (177) находила анкету дела только по student_cases.public_application_id.
-- Это поле пишет одно обычное одобрение, которое создаёт новое дело (180). Дело приглашённого студента заводят продажи, подготовка
-- кабинета или прямое добавление, и поле у него навсегда пустое (триггер 177 запрещает его менять). Поэтому анкета такого студента
-- была видна только в «Заявках»: вкладка «Анкета» в деле и решение по анкете на карточке дела не появлялись ни до одобрения, ни после.
-- Что меняется: если у дела нет public_application_id, функция берёт анкету, привязанную к делу со стороны анкеты: приглашение
-- (invited_case_id, 193) или одобрение в это дело (student_case_id, 193); так дело и анкету уже связывает 280. При нескольких
-- анкетах первой идёт самая новая. Проверка прав (profile.read.full по делу), сигнатура, результат, GRANT, STABLE, SECURITY DEFINER
-- и search_path '' не меняются: приложение вызывает функцию как раньше, порядок выката любой.
-- Forward-only, ничего не удаляет. Повтор отказывает a334_already_applied, чужое тело функции — a334_anchor_drift.
BEGIN;

DO $a334_anchor$
DECLARE v_body TEXT;
BEGIN
  v_body := (SELECT p.prosrc FROM pg_catalog.pg_proc p
    WHERE p.oid = to_regprocedure('platform.staff_student_application_for_case_v1(uuid)'));
  IF v_body IS NOT NULL AND position('invited_case_id' IN v_body) > 0 THEN
    RAISE EXCEPTION 'a334_already_applied' USING ERRCODE = '55000';
  END IF;
  IF md5(v_body) IS DISTINCT FROM 'f320ecc82d404b0b00c8f5df3553aea5' THEN
    RAISE EXCEPTION 'a334_anchor_drift: staff_student_application_for_case_v1 is not the 177 definition' USING ERRCODE = '55000';
  END IF;
END
$a334_anchor$;

CREATE OR REPLACE FUNCTION platform.staff_student_application_for_case_v1(p_student_case_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE app_id UUID; org UUID;
BEGIN
 SELECT c.organization_id,c.public_application_id INTO org,app_id FROM platform.student_cases c WHERE c.id=p_student_case_id;
 IF org IS NULL OR NOT platform_private.staff_can_access_for_actor(org,'profile.read.full','student_case',p_student_case_id) THEN
  RAISE EXCEPTION 'student_application_forbidden' USING ERRCODE='42501'; END IF;
 -- 334: дело приглашённого студента (или одобренное в существующее дело) связано с анкетой со стороны анкеты.
 IF app_id IS NULL THEN
  SELECT a.id INTO app_id FROM platform_private.student_applications a
  WHERE a.organization_id=org AND (a.invited_case_id=p_student_case_id OR a.student_case_id=p_student_case_id)
  ORDER BY a.submitted_at DESC NULLS LAST, a.id DESC LIMIT 1;
 END IF;
 RETURN platform_private.student_application_json(app_id);
END $$;

COMMIT;
