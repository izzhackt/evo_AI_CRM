-- 328 «Вернуть документ без кабинета». «Вернуть на исправление» и «Отклонить» идут только через функцию с уведомлением
-- студента, а она отказывает, если уведомлять некого. У студентов, заведённых вручную или импортом из amoCRM, кабинета нет,
-- поэтому куратор не мог ни вернуть, ни отклонить их документ: решение и причина терялись. Теперь у дела без кабинета
-- решение сохраняется без уведомления. Кабинетом считается дело со студентом и датой активации. Дело с кабинетом ведёт
-- себя как прежде: нет живого получателя или выключена публикация — отказ, чтобы студент не пропустил причину.
-- Forward-only: заменяет тело одной функции (права и подпись прежние). Повтор отказывает a328_already_applied, чужое тело
-- функции отказывает a328_anchor_drift. Приложение менять не нужно.
BEGIN;

DO $a328_anchor$
DECLARE v_body TEXT;
BEGIN
  SELECT p.prosrc INTO v_body FROM pg_catalog.pg_proc p
  WHERE p.oid = to_regprocedure('platform.review_document_version_with_portal_notification_v1(uuid,uuid,platform.document_review_decision,text,uuid)');
  IF strpos(COALESCE(v_body, ''), 'no_portal_account') > 0 THEN
    RAISE EXCEPTION 'a328_already_applied' USING ERRCODE = '55000';
  END IF;
  IF md5(v_body) IS DISTINCT FROM 'c22615a1c89fff81dd591fa438dbc9c6' THEN
    RAISE EXCEPTION 'a328_anchor_drift: the review wrapper is not the 068 definition' USING ERRCODE = '55000';
  END IF;
END
$a328_anchor$;

CREATE OR REPLACE FUNCTION
  platform.review_document_version_with_portal_notification_v1(
    p_organization_id UUID,
    p_document_version_id UUID,
    p_decision platform.document_review_decision,
    p_reason TEXT,
    p_request_id UUID
  )
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  previous_context TEXT := current_setting(
    'platform_private.p6b_portal_notification_context',
    TRUE
  );
  publication_context TEXT;
  result JSONB;
  no_portal_account BOOLEAN;
BEGIN
  IF p_organization_id IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION
      'Organization and request identity are required for Portal publication'
      USING ERRCODE = '22023';
  END IF;

  -- 328: у дела нет кабинета: уведомлять некого, решение сохраняется без уведомления. Контекст публикации не ставится,
  -- поэтому триггер уведомления ничего не делает; права и проверки решения остаются в legacy-функции.
  SELECT student_case.student_membership_id IS NULL OR student_case.portal_activated_at IS NULL
  INTO no_portal_account
  FROM platform.document_versions AS document_version
  JOIN platform.student_cases AS student_case
    ON student_case.organization_id = document_version.organization_id
    AND student_case.id = document_version.student_case_id
  WHERE document_version.organization_id = p_organization_id
    AND document_version.id = p_document_version_id;

  IF no_portal_account THEN
    RETURN platform_private.review_document_version_legacy_043(
      p_organization_id,
      p_document_version_id,
      p_decision,
      p_reason,
      p_request_id
    );
  END IF;

  PERFORM 1
  FROM platform_private.student_portal_notification_runtime_controls AS control
  WHERE control.organization_id = p_organization_id
    AND control.enabled
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Student Portal notification publication is disabled'
      USING ERRCODE = '55000';
  END IF;

  publication_context := p_organization_id::TEXT || ':' || p_request_id::TEXT;
  PERFORM set_config(
    'platform_private.p6b_portal_notification_context',
    publication_context,
    TRUE
  );

  BEGIN
    result := platform_private.review_document_version_legacy_043(
      p_organization_id,
      p_document_version_id,
      p_decision,
      p_reason,
      p_request_id
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config(
      'platform_private.p6b_portal_notification_context',
      COALESCE(previous_context, ''),
      TRUE
    );
    RAISE;
  END;

  PERFORM set_config(
    'platform_private.p6b_portal_notification_context',
    COALESCE(previous_context, ''),
    TRUE
  );
  RETURN result;
END
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
