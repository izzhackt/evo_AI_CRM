-- 366 «Имена скачиваемых файлов». Скачанный файл назывался 62-значным ключом объекта без расширения, потому что маршруты
-- просили у Storage `download: true` (ответ `Content-Disposition: attachment;` без имени). Решение владельца 21.11.2026:
-- имя «<Тип документа> — <Фамилия>.<расширение>». Приложение передаёт имя в Storage (`download: '<имя>'`), а данные для имени
-- (тип документа, фамилия студента, MIME, исходное имя) отдают четыре новые функции чтения. Ничего существующего не меняется:
-- ни ключи ответов выдачи и погашения, ни права (бегущее приложение строго проверяет набор ключей).
--
--   1) platform.document_download_name_v1(grant_id): версии документов и документы заявки. Тип = display_label места
--      документа, иначе label требования; фамилия = student_profile_fields.student_last_name дела (миграция 160), а если в анкете
--      её нет, то student_display_name дела целиком (порядок слов в нём не гарантирован, угадывать фамилию нельзя).
--   2) platform.company_file_download_name_v1(grant_id): исходное имя и MIME версии файла компании.
--   3) platform.staff_case_file_download_name_v1(kind, file_id, case_id): договор и чеки для сотрудника.
--   4) platform.student_portal_case_file_download_name_v1(kind, file_id): договор, чеки и QR для студента.
--
-- Права те же, что у самой выдачи. 1 и 2 отвечают только владельцу ещё живой выдачи: тот же профиль, членство, пользователь и
-- организация, что записаны в строке выдачи, срок не вышел; чужая выдача, выдача другой организации и просроченная отказывают
-- 42501. 3 и 4 сначала вызывают те самые функции-цели, по которым маршрут уже подписывает ссылку (договор: 327, чек: 229,
-- чек студента: 358, студент: 352/358), то есть отказ там останавливает и здесь; потом читают строку и фамилию дела.
-- Все четыре: STABLE, SECURITY DEFINER, пустой search_path, исполнение только authenticated (anon и service_role не могут).
-- Маршруты вызывают их с запасным путём: любая ошибка даёт прежний `download: true`, скачивание не ломается.
-- Forward-only. Повтор отказывает a366_already_applied, пропавшая опора a366_anchor_drift.
-- Порядок выката: сначала эта миграция, потом приложение (без миграции приложение скачивает по-старому).
BEGIN;

DO $a366_anchor$
BEGIN
  IF to_regprocedure('platform.document_download_name_v1(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'a366_already_applied' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('platform_private.document_download_grants') IS NULL
    OR to_regclass('platform_private.company_file_download_grants') IS NULL
    OR to_regclass('platform.document_versions') IS NULL
    OR to_regclass('platform.document_slots') IS NULL
    OR to_regclass('platform.document_requirements') IS NULL
    OR to_regclass('platform.company_file_versions') IS NULL
    OR to_regclass('platform.student_profile_fields') IS NULL
    OR to_regclass('platform.student_cases') IS NULL
    OR to_regclass('platform.case_contract_files') IS NULL
    OR to_regclass('platform.payment_receipt_files') IS NULL
    OR to_regclass('platform.student_payment_receipts') IS NULL
    OR to_regclass('platform.case_pending_receipts') IS NULL
    OR to_regclass('platform.payment_details_versions') IS NULL
    OR to_regprocedure('platform.current_actor_authority()') IS NULL
    OR to_regprocedure('platform.staff_case_contract_file_download_target_v1(uuid,uuid)') IS NULL
    OR to_regprocedure('platform.staff_payment_receipt_download_target_v1(uuid,uuid)') IS NULL
    OR to_regprocedure('platform.staff_student_receipt_download_target_v1(uuid)') IS NULL
    OR to_regprocedure('platform.student_portal_case_file_target_v1(text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'a366_anchor_drift: the 046 / 109 / 160 / 327 / 358 objects this migration builds on are missing' USING ERRCODE = '55000';
  END IF;
END
$a366_anchor$;

-- Фамилия студента дела для имени файла. Не отдаётся клиентским ролям: её зовут только функции ниже.
CREATE FUNCTION platform_private.download_name_surname_v1(p_organization_id UUID, p_student_case_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(
    (SELECT f.value FROM platform.student_profile_fields f
      WHERE f.organization_id = p_organization_id AND f.student_case_id = p_student_case_id
        AND f.field_key = 'student_last_name' AND f.value IS NOT NULL AND f.review_state <> 'conflict'
      ORDER BY f.updated_at DESC LIMIT 1),
    (SELECT c.student_display_name FROM platform.student_cases c
      WHERE c.organization_id = p_organization_id AND c.id = p_student_case_id))
$$;
REVOKE ALL ON FUNCTION platform_private.download_name_surname_v1(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- 1) Документы дела и документы заявки: имя по живой выдаче того же человека.
CREATE FUNCTION platform.document_download_name_v1(p_download_grant_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; g platform_private.document_download_grants%ROWTYPE; v RECORD;
BEGIN
  SELECT a.* INTO actor FROM platform.current_actor_authority() a LIMIT 1;
  IF NOT FOUND OR p_download_grant_id IS NULL THEN
    RAISE EXCEPTION 'download_name_forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT x.* INTO g FROM platform_private.document_download_grants x
  WHERE x.id = p_download_grant_id AND x.organization_id = actor.organization_id
    AND x.grantee_membership_id = actor.membership_id AND x.grantee_profile_id = actor.profile_id
    AND x.grantee_auth_user_id = actor.auth_user_id AND x.expires_at > statement_timestamp();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'download_name_forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT ver.original_filename, ver.declared_mime_type, COALESCE(s.display_label, r.label) AS label INTO v
  FROM platform.document_versions ver
  JOIN platform.document_slots s ON s.organization_id = ver.organization_id AND s.id = ver.document_slot_id
    AND s.student_case_id = ver.student_case_id
  LEFT JOIN platform.document_requirements r ON r.organization_id = s.organization_id AND r.id = s.requirement_id
  WHERE ver.organization_id = g.organization_id AND ver.id = g.document_version_id
    AND ver.student_case_id = g.student_case_id AND ver.document_slot_id = g.document_slot_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'download_name_forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('label', v.label,
    'student_surname', platform_private.download_name_surname_v1(g.organization_id, g.student_case_id),
    'mime_type', v.declared_mime_type, 'original_filename', v.original_filename);
END
$$;

-- 2) Файл компании: у него нет студента, имя по сохранённому имени.
CREATE FUNCTION platform.company_file_download_name_v1(p_download_grant_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; g platform_private.company_file_download_grants%ROWTYPE; v RECORD;
BEGIN
  SELECT a.* INTO actor FROM platform.current_actor_authority() a LIMIT 1;
  IF NOT FOUND OR p_download_grant_id IS NULL THEN
    RAISE EXCEPTION 'download_name_forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT x.* INTO g FROM platform_private.company_file_download_grants x
  WHERE x.id = p_download_grant_id AND x.organization_id = actor.organization_id
    AND x.grantee_membership_id = actor.membership_id AND x.grantee_profile_id = actor.profile_id
    AND x.grantee_auth_user_id = actor.auth_user_id AND x.expires_at > statement_timestamp();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'download_name_forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT ver.original_filename, ver.declared_mime_type INTO v FROM platform.company_file_versions ver
  WHERE ver.organization_id = g.organization_id AND ver.id = g.company_file_version_id
    AND ver.company_file_id = g.company_file_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'download_name_forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('mime_type', v.declared_mime_type, 'original_filename', v.original_filename);
END
$$;

-- 3) Договор и чеки для сотрудника: права проверяют функции-цели, по которым маршрут подписывает ссылку.
CREATE FUNCTION platform.staff_case_file_download_name_v1(p_file_kind TEXT, p_file_id UUID, p_student_case_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE target JSONB; org_id UUID; case_id UUID; v RECORD;
BEGIN
  IF p_file_id IS NULL OR p_file_kind IS NULL OR p_file_kind NOT IN ('contract', 'receipt', 'student_receipt')
    OR (p_file_kind <> 'student_receipt' AND p_student_case_id IS NULL) THEN
    RAISE EXCEPTION 'download_name_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_file_kind = 'contract' THEN
    target := platform.staff_case_contract_file_download_target_v1(p_student_case_id, p_file_id);
    SELECT f.original_filename, f.declared_mime_type INTO v FROM platform.case_contract_files f
    WHERE f.organization_id = (target ->> 'organization_id')::UUID AND f.student_case_id = p_student_case_id AND f.id = p_file_id;
  ELSIF p_file_kind = 'receipt' THEN
    target := platform.staff_payment_receipt_download_target_v1(p_student_case_id, p_file_id);
    SELECT f.original_filename, f.declared_mime_type INTO v FROM platform.payment_receipt_files f
    WHERE f.organization_id = (target ->> 'organization_id')::UUID AND f.student_case_id = p_student_case_id AND f.id = p_file_id;
  ELSE
    target := platform.staff_student_receipt_download_target_v1(p_file_id);
    p_student_case_id := (target ->> 'student_case_id')::UUID;
    SELECT f.original_filename, f.declared_mime_type INTO v FROM platform.student_payment_receipts f
    WHERE f.organization_id = (target ->> 'organization_id')::UUID AND f.student_case_id = p_student_case_id AND f.id = p_file_id;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'download_name_forbidden' USING ERRCODE = '42501';
  END IF;
  org_id := (target ->> 'organization_id')::UUID;
  RETURN jsonb_build_object('label', CASE p_file_kind WHEN 'contract' THEN 'Договор' ELSE 'Чек' END,
    'student_surname', platform_private.download_name_surname_v1(org_id, p_student_case_id),
    'mime_type', v.declared_mime_type, 'original_filename', v.original_filename);
END
$$;

-- 4) Договор, чеки и QR реквизитов для студента: права проверяет student_portal_case_file_target_v1.
CREATE FUNCTION platform.student_portal_case_file_download_name_v1(p_file_kind TEXT, p_file_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v RECORD;
BEGIN
  PERFORM platform.student_portal_case_file_target_v1(p_file_kind, p_file_id);
  IF p_file_kind = 'contract' THEN
    SELECT f.organization_id AS org, f.student_case_id AS case_id, f.original_filename AS filename, f.declared_mime_type AS mime INTO v
    FROM platform.case_contract_files f WHERE f.id = p_file_id;
  ELSIF p_file_kind = 'receipt' THEN
    SELECT f.organization_id AS org, f.student_case_id AS case_id, f.original_filename AS filename, f.declared_mime_type AS mime INTO v
    FROM platform.payment_receipt_files f WHERE f.id = p_file_id;
  ELSIF p_file_kind = 'student_receipt' THEN
    SELECT f.organization_id AS org, f.student_case_id AS case_id, f.original_filename AS filename, f.declared_mime_type AS mime INTO v
    FROM platform.student_payment_receipts f WHERE f.id = p_file_id;
  ELSIF p_file_kind = 'pending_receipt' THEN
    SELECT f.organization_id AS org, f.student_case_id AS case_id, f.original_filename AS filename, f.declared_mime_type AS mime INTO v
    FROM platform.case_pending_receipts f WHERE f.id = p_file_id;
  ELSE
    -- QR реквизитов: файл организации, не студента.
    SELECT w.organization_id AS org, NULL::UUID AS case_id, w.qr_original_filename AS filename, w.qr_mime_type AS mime INTO v
    FROM platform.payment_details_versions w WHERE w.id = p_file_id;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'download_name_forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'label', CASE p_file_kind WHEN 'contract' THEN 'Договор' WHEN 'payment_details_qr' THEN 'Реквизиты' ELSE 'Чек' END,
    'student_surname', CASE WHEN v.case_id IS NULL THEN NULL ELSE platform_private.download_name_surname_v1(v.org, v.case_id) END,
    'mime_type', v.mime, 'original_filename', v.filename);
END
$$;

DO $a366_grants$
DECLARE signature TEXT;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'platform.document_download_name_v1(uuid)',
    'platform.company_file_download_name_v1(uuid)',
    'platform.staff_case_file_download_name_v1(text,uuid,uuid)',
    'platform.student_portal_case_file_download_name_v1(text,uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, service_role, supabase_auth_admin', signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', signature);
  END LOOP;
END
$a366_grants$;

COMMENT ON FUNCTION platform.document_download_name_v1(uuid) IS
  'Имя скачиваемого документа (тип, фамилия, MIME, исходное имя) только владельцу живой выдачи.';
COMMENT ON FUNCTION platform.company_file_download_name_v1(uuid) IS
  'Исходное имя и MIME версии файла компании только владельцу живой выдачи.';
COMMENT ON FUNCTION platform.staff_case_file_download_name_v1(text, uuid, uuid) IS
  'Имя договора или чека для сотрудника: права проверяют функции-цели скачивания.';
COMMENT ON FUNCTION platform.student_portal_case_file_download_name_v1(text, uuid) IS
  'Имя договора, чека или QR для студента: права проверяет student_portal_case_file_target_v1.';

NOTIFY pgrst, 'reload schema';

COMMIT;
