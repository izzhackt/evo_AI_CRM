-- 348 «Виды документов дела: Договор, Чек об оплате, Не нужное, Другое» (решение владельца 08.11.2026, разбор встречи 07.11, пункты 3–4).
--
-- Что меняется (одна аддитивная миграция, ничего не удаляется):
--   1) platform_private.document_classification_resolutions.chosen_kind_key: закрытый список расширен значениями
--      contract / other / not_needed (решение сотрудника по файлу; подсказки ИИ их не содержат и не получают).
--   2) platform.staff_resolve_document_suggestion_v1: ТА ЖЕ подпись, права (document.manage), SECURITY DEFINER, search_path и
--      права вызова; расширен только список допустимых видов.
--   3) platform.finance_document_source_v1 (service_role): имя объекта Storage и признаки чистой проверенной текущей версии файла, чтобы
--      сервер скопировал объект внутри того же бакета в путь договора/чека. Права сотрудника сервер проверяет заранее
--      (staff_case_agreement_v1.can_write) так же, как маршруты загрузки 189.
-- Forward-only. Повтор отказывает a348_already_applied, пропавшая опора - a348_anchor_drift.
BEGIN;

DO $a348_anchor$
DECLARE chosen_check TEXT;
BEGIN
  IF to_regclass('platform_private.document_classification_resolutions') IS NULL
    OR to_regprocedure('platform.staff_resolve_document_suggestion_v1(uuid,uuid,uuid,text,uuid)') IS NULL
    OR to_regprocedure('platform_private.document_recognition_source(uuid,uuid,uuid)') IS NULL
    OR to_regclass('platform_private.document_storage_bindings') IS NULL
    OR to_regclass('platform.case_contract_files') IS NULL THEN
    RAISE EXCEPTION 'a348_anchor_drift: the 333 / 162 / 189 objects this migration builds on are missing' USING ERRCODE = '55000';
  END IF;
  SELECT pg_get_constraintdef(c.oid) INTO chosen_check FROM pg_constraint c
    WHERE c.conrelid = 'platform_private.document_classification_resolutions'::REGCLASS AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%chosen_kind_key%' AND pg_get_constraintdef(c.oid) NOT LIKE '%resolution%';
  IF chosen_check IS NULL THEN
    RAISE EXCEPTION 'a348_anchor_drift: the chosen_kind_key check of 333 is missing' USING ERRCODE = '55000';
  END IF;
  IF chosen_check LIKE '%not_needed%' THEN
    RAISE EXCEPTION 'a348_already_applied' USING ERRCODE = '55000';
  END IF;
END
$a348_anchor$;

DO $a348_check$
DECLARE check_name TEXT;
BEGIN
  SELECT c.conname INTO check_name FROM pg_constraint c
    WHERE c.conrelid = 'platform_private.document_classification_resolutions'::REGCLASS AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%chosen_kind_key%' AND pg_get_constraintdef(c.oid) NOT LIKE '%resolution%';
  EXECUTE format('ALTER TABLE platform_private.document_classification_resolutions DROP CONSTRAINT %I', check_name);
END
$a348_check$;
ALTER TABLE platform_private.document_classification_resolutions
  ADD CONSTRAINT document_classification_resolutions_chosen_kind_check CHECK (chosen_kind_key IN ('passport', 'attestat', 'transcript',
    'photo', 'medical', 'police_certificate', 'bank_statement', 'motivation_letter', 'language_certificate', 'birth_certificate',
    'recommendation_letter', 'application_form', 'payment_receipt', 'contract', 'other', 'not_needed'));

CREATE OR REPLACE FUNCTION platform.staff_resolve_document_suggestion_v1(p_organization_id UUID, p_student_case_id UUID, p_document_version_id UUID,
  p_kind_key TEXT, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE op RECORD; v RECORD; g platform_private.document_classification_suggestions%ROWTYPE; rr platform_private.document_classification_resolutions%ROWTYPE;
  v_resolution TEXT;
BEGIN
  IF p_organization_id IS NULL OR p_student_case_id IS NULL OR p_document_version_id IS NULL OR p_request_id IS NULL
    OR p_kind_key IS NULL OR p_kind_key NOT IN ('passport', 'attestat', 'transcript', 'photo', 'medical', 'police_certificate',
      'bank_statement', 'motivation_letter', 'language_certificate', 'birth_certificate', 'recommendation_letter', 'application_form',
      'payment_receipt', 'contract', 'other', 'not_needed') THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO op FROM platform_private.require_case_operator(p_organization_id, p_student_case_id, 'document.manage');
  -- Закрытое (и ещё не активное) дело не меняется: решение по файлу туда не пишется.
  IF NOT EXISTS (SELECT 1 FROM platform.student_cases c WHERE c.organization_id = p_organization_id AND c.id = p_student_case_id AND c.state = 'active') THEN
    RAISE EXCEPTION 'Student case is unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO rr FROM platform_private.document_classification_resolutions WHERE request_id = p_request_id;
  IF FOUND THEN
    IF rr.organization_id <> p_organization_id OR rr.document_version_id <> p_document_version_id OR rr.chosen_kind_key <> p_kind_key THEN
      RAISE EXCEPTION 'request_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('resolution', rr.resolution, 'chosen_kind_key', rr.chosen_kind_key, 'replayed', TRUE);
  END IF;
  SELECT dv.id AS version_id, dv.document_slot_id AS slot_id INTO v FROM platform.document_versions dv
    JOIN platform.document_slots s ON s.organization_id = dv.organization_id AND s.id = dv.document_slot_id AND s.removed_at IS NULL
    WHERE dv.organization_id = p_organization_id AND dv.student_case_id = p_student_case_id AND dv.id = p_document_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'document_not_found' USING ERRCODE = '22023'; END IF;
  SELECT * INTO rr FROM platform_private.document_classification_resolutions
    WHERE organization_id = p_organization_id AND document_version_id = p_document_version_id;
  IF FOUND THEN
    IF rr.chosen_kind_key <> p_kind_key THEN RAISE EXCEPTION 'request_conflict' USING ERRCODE = '23505'; END IF;
    RETURN jsonb_build_object('resolution', rr.resolution, 'chosen_kind_key', rr.chosen_kind_key, 'replayed', TRUE);
  END IF;
  SELECT * INTO g FROM platform_private.document_classification_suggestions
    WHERE organization_id = p_organization_id AND document_version_id = p_document_version_id AND policy_version = 'doc-kind-v1'
      AND status IN ('suggested', 'unsure');
  v_resolution := CASE WHEN NOT FOUND THEN 'chosen_without_suggestion' WHEN g.kind_key = p_kind_key THEN 'accepted_suggestion' ELSE 'corrected' END;
  INSERT INTO platform_private.document_classification_resolutions (organization_id, student_case_id, document_slot_id, document_version_id,
    suggestion_id, chosen_kind_key, resolution, resolved_by_membership_id, request_id)
  VALUES (p_organization_id, p_student_case_id, v.slot_id, p_document_version_id,
    CASE WHEN v_resolution = 'chosen_without_suggestion' THEN NULL ELSE g.id END, p_kind_key, v_resolution, op.actor_membership_id, p_request_id);
  RETURN jsonb_build_object('resolution', v_resolution, 'chosen_kind_key', p_kind_key, 'replayed', FALSE);
END
$$;

REVOKE ALL ON FUNCTION platform.staff_resolve_document_suggestion_v1(uuid, uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
GRANT EXECUTE ON FUNCTION platform.staff_resolve_document_suggestion_v1(uuid, uuid, uuid, text, uuid) TO authenticated;

-- Источник файла для договора/чека: чистая проверенная текущая версия файла активного дела (на проверке или уже принятая).
CREATE FUNCTION platform.finance_document_source_v1(p_organization_id UUID, p_student_case_id UUID, p_document_version_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE src RECORD;
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role is required' USING ERRCODE = '42501';
  END IF;
  IF p_organization_id IS NULL OR p_student_case_id IS NULL OR p_document_version_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  SELECT dv.original_filename, dv.declared_mime_type, dv.byte_size, dv.sha256_hex, binding.object_name INTO src
  FROM platform_private.document_recognition_source(p_organization_id, p_student_case_id, p_document_version_id) AS eligible
  JOIN platform.document_versions dv ON dv.organization_id = p_organization_id AND dv.student_case_id = p_student_case_id AND dv.id = p_document_version_id
  JOIN platform.document_slots slot ON slot.organization_id = dv.organization_id AND slot.id = dv.document_slot_id
    AND slot.current_version_id = dv.id AND slot.status IN ('submitted', 'approved') AND slot.removed_at IS NULL
  JOIN platform_private.document_storage_bindings binding ON binding.organization_id = dv.organization_id
    AND binding.document_version_id = dv.id AND binding.bucket_id = 'platform-documents'
  JOIN platform.student_cases c ON c.organization_id = dv.organization_id AND c.id = dv.student_case_id AND c.state = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'document_not_eligible' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('object_name', src.object_name, 'original_filename', src.original_filename,
    'declared_mime_type', src.declared_mime_type, 'byte_size', src.byte_size, 'sha256_hex', src.sha256_hex);
END
$$;
REVOKE ALL ON FUNCTION platform.finance_document_source_v1(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
GRANT EXECUTE ON FUNCTION platform.finance_document_source_v1(uuid, uuid, uuid) TO service_role;

COMMIT;
