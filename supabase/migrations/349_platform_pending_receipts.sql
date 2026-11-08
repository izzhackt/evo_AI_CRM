-- 349 «Чек об оплате из разбора документов ждёт оплату» (решение владельца 08.11.2026, пункт 4 разбора встречи 07.11).
--
-- Зачем. Принятый как «Чек об оплате» файл должен попасть в «Деньги». Модель 189 держит чек только у события оплаты
-- (payment_receipt_files.payment_event_id NOT NULL), а сумму из файла никто не читает и не выдумывает. Поэтому чек ложится
-- отдельной строкой «ждёт оплату»; финансы привязывают его к уже внесённой оплате этого дела. Суммы, транши и итоги не трогаются.
--
-- Что добавляется (аддитивно, ничего не заменяется и не удаляется):
--   1) platform.case_pending_receipts: одна строка на версию файла (повтор приёма не двоит), только добавление
--      (DELETE/TRUNCATE запрещены, UPDATE допускает только привязку один раз), RLS включён и форсирован, таблица закрыта.
--   2) record_pending_receipt_v1 (service_role): записывает чек, объект Storage уже скопирован сервером в
--      payment-receipts/<орг>/<дело>/<версия файла> (тот же бакет, путь читает готовый маршрут скачивания 189).
--   3) staff_case_pending_receipts_v1 (authenticated): чек-лист «ждут оплату» для читающих блок «Договор и оплата» (то же право чтения, что у 189).
--   4) allocate_pending_receipt_v1 (authenticated): привязка к оплате дела, те же права записи, что у record_case_payment_v1;
--      строка payment_receipt_files и отметка привязки одной транзакцией, повтор безопасен.
-- Forward-only. Повтор отказывает a349_already_applied, пропавшая опора - a349_anchor_drift.
BEGIN;

DO $a349_anchor$
BEGIN
  IF to_regclass('platform.payment_receipt_files') IS NULL
    OR to_regclass('platform.payment_events') IS NULL
    OR to_regprocedure('platform.staff_case_agreement_v1(uuid)') IS NULL
    OR to_regprocedure('platform.current_actor_authority()') IS NULL
    OR to_regprocedure('platform_private.staff_can_access(uuid,uuid,text,text,uuid)') IS NULL
    OR to_regprocedure('platform_private.staff_membership_identity(uuid,uuid)') IS NULL
    OR to_regprocedure('platform_private.block_append_only_mutation()') IS NULL THEN
    RAISE EXCEPTION 'a349_anchor_drift: the 189 / 229 objects this migration builds on are missing' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('platform.case_pending_receipts') IS NOT NULL THEN
    RAISE EXCEPTION 'a349_already_applied' USING ERRCODE = '55000';
  END IF;
END
$a349_anchor$;

CREATE TABLE platform.case_pending_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  source_document_version_id UUID NOT NULL,
  original_filename TEXT NOT NULL CHECK (btrim(original_filename) <> ''),
  declared_mime_type TEXT NOT NULL CHECK (declared_mime_type IN ('application/pdf', 'image/jpeg', 'image/png')),
  byte_size BIGINT NOT NULL CHECK (byte_size BETWEEN 1 AND 26214400),
  sha256_hex TEXT NOT NULL CHECK (sha256_hex ~ '^[0-9a-f]{64}$'),
  storage_object_name TEXT NOT NULL CHECK (btrim(storage_object_name) <> ''),
  queued_by_membership_id UUID NOT NULL,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  allocated_payment_event_id UUID,
  allocated_receipt_file_id UUID,
  allocated_by_membership_id UUID,
  allocated_at TIMESTAMPTZ,
  CONSTRAINT case_pending_receipts_org_id_key UNIQUE (organization_id, id),
  CONSTRAINT case_pending_receipts_version_key UNIQUE (organization_id, source_document_version_id),
  CONSTRAINT case_pending_receipts_allocation_shape CHECK (
    (allocated_payment_event_id IS NULL AND allocated_receipt_file_id IS NULL AND allocated_by_membership_id IS NULL AND allocated_at IS NULL)
    OR (allocated_payment_event_id IS NOT NULL AND allocated_receipt_file_id IS NOT NULL AND allocated_by_membership_id IS NOT NULL AND allocated_at IS NOT NULL)),
  CONSTRAINT case_pending_receipts_case_fkey FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT case_pending_receipts_version_fkey FOREIGN KEY (organization_id, source_document_version_id)
    REFERENCES platform.document_versions (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT case_pending_receipts_queued_by_fkey FOREIGN KEY (organization_id, queued_by_membership_id)
    REFERENCES platform.organization_memberships (organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX case_pending_receipts_open_idx ON platform.case_pending_receipts (organization_id, student_case_id, queued_at)
  WHERE allocated_at IS NULL;

-- Единственное допустимое изменение: привязка один раз (поля чека и дела неизменны).
CREATE FUNCTION platform_private.case_pending_receipt_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.allocated_at IS NOT NULL OR NEW.allocated_at IS NULL
    OR NEW.id <> OLD.id OR NEW.organization_id <> OLD.organization_id OR NEW.student_case_id <> OLD.student_case_id
    OR NEW.source_document_version_id <> OLD.source_document_version_id OR NEW.original_filename <> OLD.original_filename
    OR NEW.declared_mime_type <> OLD.declared_mime_type OR NEW.byte_size <> OLD.byte_size OR NEW.sha256_hex <> OLD.sha256_hex
    OR NEW.storage_object_name <> OLD.storage_object_name OR NEW.queued_by_membership_id <> OLD.queued_by_membership_id
    OR NEW.queued_at <> OLD.queued_at THEN
    RAISE EXCEPTION 'case_pending_receipt_immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION platform_private.case_pending_receipt_guard() FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
CREATE TRIGGER case_pending_receipts_update_guard BEFORE UPDATE ON platform.case_pending_receipts
  FOR EACH ROW EXECUTE FUNCTION platform_private.case_pending_receipt_guard();
CREATE TRIGGER case_pending_receipts_no_delete BEFORE DELETE ON platform.case_pending_receipts
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER case_pending_receipts_no_truncate BEFORE TRUNCATE ON platform.case_pending_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();

ALTER TABLE platform.case_pending_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.case_pending_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE platform.case_pending_receipts FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;

-- Служебная запись (сервер уже проверил право сотрудника через staff_case_agreement_v1 и скопировал объект Storage).
CREATE FUNCTION platform.record_pending_receipt_v1(
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

-- Чтение: те же двери, что у блока «Договор и оплата» (staff_case_agreement_v1 сам отказывает 42501 и считает can_write).
CREATE FUNCTION platform.staff_case_pending_receipts_v1(p_student_case_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE agreement JSONB; org UUID;
BEGIN
  IF p_student_case_id IS NULL THEN RAISE EXCEPTION 'case_agreement_invalid' USING ERRCODE = '22023'; END IF;
  agreement := platform.staff_case_agreement_v1(p_student_case_id);
  org := (agreement ->> 'organization_id')::UUID;
  RETURN jsonb_build_object('organization_id', org, 'student_case_id', p_student_case_id,
    'receipts', COALESCE((SELECT jsonb_agg(jsonb_build_object('pending_receipt_id', pending.id, 'original_filename', pending.original_filename,
      'queued_at', pending.queued_at) ORDER BY pending.queued_at, pending.id)
      FROM platform.case_pending_receipts pending
      WHERE pending.organization_id = org AND pending.student_case_id = p_student_case_id AND pending.allocated_at IS NULL), '[]'::JSONB));
END
$$;

-- Привязка к уже внесённой оплате этого дела. Суммы и итоги не меняются: добавляется только файл-подтверждение (как в 229).
CREATE FUNCTION platform.allocate_pending_receipt_v1(p_organization_id UUID, p_pending_receipt_id UUID, p_payment_event_id UUID, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; pending platform.case_pending_receipts%ROWTYPE; event_row platform.payment_events%ROWTYPE;
  file_id UUID := gen_random_uuid(); result JSONB;
BEGIN
  IF p_organization_id IS NULL OR p_pending_receipt_id IS NULL OR p_payment_event_id IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'case_agreement_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT a.* INTO actor FROM platform.current_actor_authority() a WHERE a.organization_id = p_organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'case_agreement_forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO pending FROM platform.case_pending_receipts WHERE organization_id = p_organization_id AND id = p_pending_receipt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'case_agreement_forbidden' USING ERRCODE = '42501'; END IF;
  -- Право записи ровно то же, что у внесения оплаты (record_case_payment_v1): case.update.append на деле или ответственный продажник до передачи.
  IF NOT (
    platform_private.staff_can_access(p_organization_id, actor.membership_id, 'case.update.append', 'student_case', pending.student_case_id)
    OR EXISTS (SELECT 1 FROM platform.student_cases c WHERE c.organization_id = p_organization_id AND c.id = pending.student_case_id
      AND c.state = 'pending' AND c.responsible_sales_membership_id = actor.membership_id)
  ) THEN
    RAISE EXCEPTION 'case_agreement_forbidden' USING ERRCODE = '42501';
  END IF;
  IF pending.allocated_at IS NOT NULL THEN
    IF pending.allocated_payment_event_id = p_payment_event_id THEN
      RETURN jsonb_build_object('organization_id', p_organization_id, 'pending_receipt_id', pending.id, 'payment_event_id', p_payment_event_id,
        'payment_receipt_file_id', pending.allocated_receipt_file_id, 'replayed', TRUE);
    END IF;
    RAISE EXCEPTION 'receipt_already_allocated' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO event_row FROM platform.payment_events e WHERE e.organization_id = p_organization_id AND e.id = p_payment_event_id
    AND e.student_case_id = pending.student_case_id AND e.event_type = 'payment';
  IF NOT FOUND THEN RAISE EXCEPTION 'payment_event_unavailable' USING ERRCODE = '22023'; END IF;
  INSERT INTO platform.payment_receipt_files (id, organization_id, student_case_id, payment_obligation_id, payment_event_id, original_filename,
    declared_mime_type, byte_size, sha256_hex, storage_object_name, uploaded_by_membership_id)
  VALUES (file_id, p_organization_id, pending.student_case_id, event_row.payment_obligation_id, p_payment_event_id, pending.original_filename,
    pending.declared_mime_type, pending.byte_size, pending.sha256_hex, pending.storage_object_name, actor.membership_id);
  UPDATE platform.case_pending_receipts SET allocated_payment_event_id = p_payment_event_id, allocated_receipt_file_id = file_id,
    allocated_by_membership_id = actor.membership_id, allocated_at = statement_timestamp()
    WHERE organization_id = p_organization_id AND id = pending.id;
  result := jsonb_build_object('organization_id', p_organization_id, 'pending_receipt_id', pending.id, 'payment_event_id', p_payment_event_id,
    'payment_receipt_file_id', file_id, 'replayed', FALSE);
  INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal, action, resource_type, resource_id,
    before_state, after_state, reason, request_id)
  VALUES (p_organization_id, 'user', actor.profile_id, 'auth:' || actor.auth_user_id::TEXT, 'case.receipt.pending.allocate',
    'payment_receipt_file', file_id, NULL, result, 'Pending payment receipt attached to a payment', p_request_id);
  RETURN result;
END
$$;

DO $a349_grants$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY['platform.record_pending_receipt_v1(uuid,uuid,uuid,uuid,text,text,bigint,text,text,uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['platform.staff_case_pending_receipts_v1(uuid)', 'platform.allocate_pending_receipt_v1(uuid,uuid,uuid,uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END
$a349_grants$;

COMMENT ON TABLE platform.case_pending_receipts IS
  'Migration 349: a payment receipt accepted from document sorting that waits to be attached to a payment of the case. Append-only, one row per document version.';

COMMIT;
