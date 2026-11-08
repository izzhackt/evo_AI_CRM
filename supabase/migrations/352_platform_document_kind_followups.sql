-- 352 «Виды документов: доработки по разбору 348–349» (решение владельца 08.11.2026, три мелких замечания к PR 1403).
--
-- Что меняется (одна аддитивная миграция, ничего не удаляется):
--   1) platform.record_pending_receipt_v1 (service_role): ТА ЖЕ подпись, SECURITY DEFINER, search_path и права вызова. Добавлено
--      одно условие: сотрудник, который кладёт чек в список «Чеки ждут оплату», держит право разбора документов дела
--      (document.manage на этом деле). Это делает постановку чека в очередь действием с документом: денежное право записи
--      (case.update.append, блок «Договор и оплата») для неё больше не нужно и сервер его не требует. ПРИВЯЗКА чека к оплате
--      (platform.allocate_pending_receipt_v1) не менялась: по-прежнему только право записи оплаты дела.
--   2) Чтение собственных договора и чеков студентом, только чтение:
--      platform_private.student_portal_money_case_v1 (закрытая): дело студента, если он вошёл в кабинет и ему доступны финансы
--        («portal.read.self» + «finance.read.self», дело активно или закрыто, кабинет открыт) - те же условия, что у student_portal_finance_v2;
--      platform.student_portal_case_files_v1(): новый (не расширение чужих), точная форма: текущий договор дела, привязанные чеки и чеки,
--        ждущие оплату. Без суммы, события оплаты, сотрудника, заметок, хэша и имени объекта Storage;
--      platform.student_portal_case_file_target_v1(kind, id): имя объекта Storage для подписанной ссылки того же студента; чужой или
--        несуществующий файл - 42501.
--   «Не нужное» сюда не попадает по построению: такой файл не создаёт ни договор, ни чек.
-- Forward-only. Повтор отказывает a352_already_applied, пропавшая опора - a352_anchor_drift.
BEGIN;

DO $a352_anchor$
DECLARE pending_src TEXT;
BEGIN
  IF to_regprocedure('platform.record_pending_receipt_v1(uuid,uuid,uuid,uuid,text,text,bigint,text,text,uuid)') IS NULL
    OR to_regprocedure('platform.allocate_pending_receipt_v1(uuid,uuid,uuid,uuid)') IS NULL
    OR to_regclass('platform.case_pending_receipts') IS NULL
    OR to_regclass('platform.case_contract_files') IS NULL
    OR to_regclass('platform.payment_receipt_files') IS NULL
    OR to_regprocedure('platform.student_portal_finance_v2()') IS NULL
    OR to_regprocedure('platform_private.staff_can_access(uuid,uuid,text,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'a352_anchor_drift: the 189 / 229 / 349 objects this migration builds on are missing' USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('platform.student_portal_case_files_v1()') IS NOT NULL THEN
    RAISE EXCEPTION 'a352_already_applied' USING ERRCODE = '55000';
  END IF;
  SELECT p.prosrc INTO pending_src FROM pg_proc p
    WHERE p.oid = 'platform.record_pending_receipt_v1(uuid,uuid,uuid,uuid,text,text,bigint,text,text,uuid)'::REGPROCEDURE;
  IF pending_src LIKE '%document.manage%' OR pending_src NOT LIKE '%Pending receipt source is unavailable%' THEN
    RAISE EXCEPTION 'a352_anchor_drift: record_pending_receipt_v1 is not the 349 body' USING ERRCODE = '55000';
  END IF;
END
$a352_anchor$;

-- ---------------------------------------------------------------------------
-- 1) Постановка чека в очередь - действие с документом (право разбора файлов дела), не денежное.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION platform.record_pending_receipt_v1(
  p_organization_id UUID, p_student_case_id UUID, p_document_version_id UUID, p_queued_by_membership_id UUID,
  p_original_filename TEXT, p_declared_mime_type TEXT, p_byte_size BIGINT, p_sha256_hex TEXT, p_storage_object_name TEXT, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE row_id UUID; existing platform.case_pending_receipts%ROWTYPE;
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role is required' USING ERRCODE = '42501';
  END IF;
  IF p_organization_id IS NULL OR p_student_case_id IS NULL OR p_document_version_id IS NULL OR p_queued_by_membership_id IS NULL
    OR p_request_id IS NULL OR p_original_filename IS NULL OR btrim(p_original_filename) = ''
    OR lower(btrim(p_declared_mime_type)) NOT IN ('application/pdf', 'image/jpeg', 'image/png')
    OR p_byte_size IS NULL OR p_byte_size NOT BETWEEN 1 AND 26214400 OR lower(btrim(p_sha256_hex)) !~ '^[0-9a-f]{64}$'
    OR p_storage_object_name IS NULL OR btrim(p_storage_object_name) = '' THEN
    RAISE EXCEPTION 'Complete pending receipt metadata is required' USING ERRCODE = '22023';
  END IF;
  PERFORM platform_private.lock_p2e_request(p_request_id);
  -- Право разбора документов этого дела (как у решения по файлу). Денежного права здесь нет и не нужно: чек только встаёт в очередь.
  IF NOT platform_private.staff_can_access(p_organization_id, p_queued_by_membership_id, 'document.manage', 'student_case', p_student_case_id) THEN
    RAISE EXCEPTION 'Pending receipt source is unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO existing FROM platform.case_pending_receipts
    WHERE organization_id = p_organization_id AND source_document_version_id = p_document_version_id;
  IF FOUND THEN
    IF existing.student_case_id <> p_student_case_id THEN RAISE EXCEPTION 'request_conflict' USING ERRCODE = '23505'; END IF;
    RETURN jsonb_build_object('organization_id', p_organization_id, 'pending_receipt_id', existing.id, 'replayed', TRUE);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform.document_versions dv WHERE dv.organization_id = p_organization_id
      AND dv.id = p_document_version_id AND dv.student_case_id = p_student_case_id)
    OR NOT EXISTS (SELECT 1 FROM platform_private.staff_membership_identity(p_organization_id, p_queued_by_membership_id)) THEN
    RAISE EXCEPTION 'Pending receipt source is unavailable' USING ERRCODE = '42501';
  END IF;
  INSERT INTO platform.case_pending_receipts (organization_id, student_case_id, source_document_version_id, original_filename,
    declared_mime_type, byte_size, sha256_hex, storage_object_name, queued_by_membership_id)
  VALUES (p_organization_id, p_student_case_id, p_document_version_id, btrim(p_original_filename), lower(btrim(p_declared_mime_type)),
    p_byte_size, lower(btrim(p_sha256_hex)), btrim(p_storage_object_name), p_queued_by_membership_id)
  RETURNING id INTO row_id;
  INSERT INTO platform.audit_events (organization_id, actor_kind, actor_principal, action, resource_type, resource_id, before_state,
    after_state, reason, request_id)
  VALUES (p_organization_id, 'system', 'service_role:document_ingest', 'case.receipt.pending.queue', 'case_pending_receipt', row_id, NULL,
    jsonb_build_object('organization_id', p_organization_id, 'student_case_id', p_student_case_id, 'pending_receipt_id', row_id,
      'original_filename', btrim(p_original_filename)), 'Payment receipt accepted from document sorting', p_request_id);
  RETURN jsonb_build_object('organization_id', p_organization_id, 'pending_receipt_id', row_id, 'replayed', FALSE);
END
$$;
REVOKE ALL ON FUNCTION platform.record_pending_receipt_v1(uuid, uuid, uuid, uuid, text, text, bigint, text, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
GRANT EXECUTE ON FUNCTION platform.record_pending_receipt_v1(uuid, uuid, uuid, uuid, text, text, bigint, text, text, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 2) Студент читает свои договор и чеки (только чтение).
-- ---------------------------------------------------------------------------
-- Дело студента и условия те же, что у student_portal_finance_v2 (127): студент-участник, «portal.read.self» и «finance.read.self»,
-- дело активно или закрыто, кабинет открыт, права на организацию и на само дело.
CREATE FUNCTION platform_private.student_portal_money_case_v1()
RETURNS TABLE (organization_id UUID, student_case_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH authority AS MATERIALIZED (
    SELECT current_authority.*
    FROM platform.current_actor_authority() AS current_authority
    JOIN platform.organization_memberships AS student_membership
      ON student_membership.organization_id = current_authority.organization_id
      AND student_membership.id = current_authority.membership_id
      AND student_membership.status = 'active'
      AND student_membership."current_role" = 'student'
    JOIN platform.profiles AS student_profile
      ON student_profile.id = student_membership.profile_id
      AND student_profile.id = current_authority.profile_id
      AND student_profile.auth_user_id = current_authority.auth_user_id
      AND student_profile.auth_user_id = (SELECT auth.uid())
      AND student_profile.status = 'active'
    JOIN platform.organizations AS organization
      ON organization.id = student_membership.organization_id
      AND organization.status = 'active'
    JOIN platform.role_bundle_versions AS bundle
      ON bundle.id = student_membership.current_bundle_id
      AND bundle.role = student_membership."current_role"
      AND bundle.status = 'published'
    WHERE current_authority.platform_role = 'student'
      AND private.platform_has_permission(current_authority.organization_id, 'portal.read.self')
      AND private.platform_has_permission(current_authority.organization_id, 'finance.read.self')
      AND private.platform_has_scope(current_authority.organization_id, 'organization'::platform.scope_kind, current_authority.organization_id)
  )
  SELECT student_case.organization_id, student_case.id
  FROM authority
  JOIN platform.student_cases AS student_case
    ON student_case.organization_id = authority.organization_id
    AND student_case.student_membership_id = authority.membership_id
  WHERE student_case.state IN ('active', 'closed')
    AND student_case.portal_activated_at IS NOT NULL
    AND private.platform_can_read_student_portal_case(student_case.organization_id, student_case.id)
    AND private.platform_has_permission(student_case.organization_id, 'portal.read.self')
    AND private.platform_has_permission(student_case.organization_id, 'finance.read.self')
    AND private.platform_has_scope(student_case.organization_id, 'organization'::platform.scope_kind, student_case.organization_id)
    AND private.platform_has_scope(student_case.organization_id, 'student_case'::platform.scope_kind, student_case.id)
$$;
REVOKE ALL ON FUNCTION platform_private.student_portal_money_case_v1()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;

-- Новая функция точной формы: договор (только текущий), привязанные чеки, чеки в очереди. Сумм, событий оплаты и сотрудников нет.
CREATE FUNCTION platform.student_portal_case_files_v1()
RETURNS TABLE (file_kind TEXT, file_id UUID, original_filename TEXT, declared_mime_type TEXT, byte_size BIGINT, added_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT files.file_kind, files.file_id, files.original_filename, files.declared_mime_type, files.byte_size, files.added_at
  FROM (
    SELECT 'contract'::TEXT AS file_kind, contract.id AS file_id, contract.original_filename, contract.declared_mime_type,
      contract.byte_size, contract.uploaded_at AS added_at, 0 AS sort_group
    FROM platform_private.student_portal_money_case_v1() AS own
    JOIN platform.case_contract_files AS contract
      ON contract.organization_id = own.organization_id AND contract.student_case_id = own.student_case_id
      AND contract.superseded_at IS NULL
    UNION ALL
    SELECT 'receipt'::TEXT, receipt.id, receipt.original_filename, receipt.declared_mime_type, receipt.byte_size, receipt.uploaded_at, 1
    FROM platform_private.student_portal_money_case_v1() AS own
    JOIN platform.payment_receipt_files AS receipt
      ON receipt.organization_id = own.organization_id AND receipt.student_case_id = own.student_case_id
    UNION ALL
    SELECT 'pending_receipt'::TEXT, pending.id, pending.original_filename, pending.declared_mime_type, pending.byte_size, pending.queued_at, 1
    FROM platform_private.student_portal_money_case_v1() AS own
    JOIN platform.case_pending_receipts AS pending
      ON pending.organization_id = own.organization_id AND pending.student_case_id = own.student_case_id
      AND pending.allocated_at IS NULL
  ) AS files
  ORDER BY files.sort_group, files.added_at DESC, files.file_id
$$;

-- Имя объекта Storage для подписанной ссылки: только свой файл. Чужой, несуществующий и «чужого вида» - одинаково 42501.
CREATE FUNCTION platform.student_portal_case_file_target_v1(p_file_kind TEXT, p_file_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE found_row RECORD;
BEGIN
  IF p_file_id IS NULL OR p_file_kind IS NULL OR p_file_kind NOT IN ('contract', 'receipt', 'pending_receipt') THEN
    RAISE EXCEPTION 'case_file_invalid' USING ERRCODE = '22023';
  END IF;
  -- У студента может быть несколько своих дел: файл ищется во всех его делах, а не в первом попавшемся.
  PERFORM 1 FROM platform_private.student_portal_money_case_v1();
  IF NOT FOUND THEN RAISE EXCEPTION 'case_file_forbidden' USING ERRCODE = '42501'; END IF;
  IF p_file_kind = 'contract' THEN
    SELECT f.storage_object_name AS object_name, f.original_filename AS filename INTO found_row FROM platform.case_contract_files f
      JOIN platform_private.student_portal_money_case_v1() AS own
      ON own.organization_id = f.organization_id AND own.student_case_id = f.student_case_id
      WHERE f.id = p_file_id AND f.superseded_at IS NULL;
  ELSIF p_file_kind = 'receipt' THEN
    SELECT f.storage_object_name AS object_name, f.original_filename AS filename INTO found_row FROM platform.payment_receipt_files f
      JOIN platform_private.student_portal_money_case_v1() AS own
      ON own.organization_id = f.organization_id AND own.student_case_id = f.student_case_id
      WHERE f.id = p_file_id;
  ELSE
    -- Чек, ставший привязанным после открытия страницы, остаётся файлом этого же студента.
    SELECT f.storage_object_name AS object_name, f.original_filename AS filename INTO found_row FROM platform.case_pending_receipts f
      JOIN platform_private.student_portal_money_case_v1() AS own
      ON own.organization_id = f.organization_id AND own.student_case_id = f.student_case_id
      WHERE f.id = p_file_id;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'case_file_forbidden' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object('file_kind', p_file_kind, 'file_id', p_file_id, 'storage_object_name', found_row.object_name,
    'original_filename', found_row.filename);
END
$$;

DO $a352_grants$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY['platform.student_portal_case_files_v1()', 'platform.student_portal_case_file_target_v1(text,uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END
$a352_grants$;

COMMENT ON FUNCTION platform.student_portal_case_files_v1() IS
  'Migration 352: the Student''s own current contract, attached receipts and receipts waiting for a payment, read-only; no amounts, staff, hashes or storage names.';
COMMENT ON FUNCTION platform.student_portal_case_file_target_v1(text, uuid) IS
  'Migration 352: storage object name of one of the Student''s own contract / receipt files for a short-lived signed link; anything else is 42501.';

NOTIFY pgrst, 'reload schema';

COMMIT;
