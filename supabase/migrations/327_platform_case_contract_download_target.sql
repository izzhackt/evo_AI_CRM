-- 327 «Скачивание договора». Обработчик скачивания читал platform.case_contract_files служебным ключом, а у service_role
-- нет прав на таблицы (041), поэтому каждое скачивание договора отвечало 404 file_not_found. Для чеков это исправила 229;
-- договор в ту правку не вошёл. Здесь то же решение: функция под сессией сотрудника отдаёт имя объекта после проверки
-- права на блок «Договор и оплата», а служебный ключ только подписывает ссылку. Прямых прав на таблицу не добавляется.
-- Forward-only, ничего не заменяет: одна новая функция. Повтор отказывает a327_already_applied, отсутствие опоры a327_anchor_drift.
-- Порядок выката: сначала эта миграция, потом приложение (новый обработчик зовёт эту функцию).
BEGIN;

DO $a327_anchor$
BEGIN
  IF to_regprocedure('platform.staff_case_contract_file_download_target_v1(uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'a327_already_applied' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('platform.case_contract_files') IS NULL
    OR to_regprocedure('platform.staff_case_agreement_v1(uuid)') IS NULL
    OR to_regprocedure('platform.staff_payment_receipt_download_target_v1(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'a327_anchor_drift: the 189 / 229 objects this migration builds on are missing' USING ERRCODE = '55000';
  END IF;
END
$a327_anchor$;

CREATE FUNCTION platform.staff_case_contract_file_download_target_v1(p_student_case_id UUID, p_file_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; file_row platform.case_contract_files%ROWTYPE;
BEGIN
  SELECT a.* INTO actor FROM platform.current_actor_authority() a
  JOIN platform_private.staff_membership_identity(a.organization_id, a.membership_id) i ON TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'case_agreement_forbidden' USING ERRCODE = '42501';
  END IF;
  -- Право то же, что у чтения блока: отказ этого чтения останавливает выдачу.
  PERFORM platform.staff_case_agreement_v1(p_student_case_id);
  SELECT f.* INTO file_row FROM platform.case_contract_files f
  WHERE f.organization_id = actor.organization_id AND f.student_case_id = p_student_case_id AND f.id = p_file_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'case_agreement_forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('organization_id', actor.organization_id, 'student_case_id', p_student_case_id,
    'case_contract_file_id', file_row.id, 'storage_object_name', file_row.storage_object_name);
END
$$;

REVOKE ALL ON FUNCTION platform.staff_case_contract_file_download_target_v1(UUID, UUID)
  FROM PUBLIC, anon, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_case_contract_file_download_target_v1(UUID, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
