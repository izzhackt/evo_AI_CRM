-- 358 «Чеки от студента и реквизиты для оплаты» (решение владельца 10.11.2026, ветка izzhackt/student-payment-receipts).
--
-- Зачем. Студент видел в «Оплате» только итоги по платежам. Теперь: (1) один блок «Как оплатить» (реквизиты и QR, общие для всех;
-- правит администратор в CRM); (2) студент сам прикладывает чек (фото или PDF) к платежу куратора или без платежа, указав сумму,
-- валюту и дату; чек получает статус «на проверке» и в деньги НЕ идёт; (3) сотрудник принимает чек (подтверждая или поправляя сумму,
-- валюту, дату и платёж) или отклоняет с причиной. Принятие создаёт настоящую оплату существующей командой record_case_payment_v1 и
-- привязывает файл чека к оплате (как 349); «Оплачено»/«Осталось» пересчитываются там же, где и раньше. Нового кошелька или
-- книги денег нет: добавляются только строки, прежние не удаляются и не переписываются (кроме разового перехода статуса чека).
--
-- Что добавляется (аддитивно):
--   1) platform.student_payment_receipts: чек студента. Строка меняется один раз (pending -> accepted | rejected), DELETE/TRUNCATE
--      запрещены, RLS включён и форсирован, таблица закрыта для всех ролей API.
--   2) platform.payment_details_versions: версии реквизитов организации (текст и QR), только добавление; текущая - с наибольшим номером.
--   3) Студент (authenticated, студент с доступом к финансам, граница 352): student_portal_payment_center_v1() (реквизиты, платежи с
--      историей, чеки без платежа); student_payment_receipt_target_v1(платёж) - проверка перед загрузкой файла.
--   4) Сервер (service_role): record_student_payment_receipt_v1 (метаданные чека после загрузки в Storage и антивируса),
--      record_payment_details_v1 (новая версия реквизитов, только системный администратор).
--   5) Сотрудник (authenticated): staff_payment_receipts_v1 (очередь), staff_student_receipt_download_target_v1,
--      accept_student_payment_receipt_v1, reject_student_payment_receipt_v1, staff_payment_details_v1 (читает и показывает QR только админу).
--   6) Уведомление сотрудников: новый вид staff_notifications.kind = 'student_receipt' (куратору дела и держателям полного чтения финансов).
--   7) student_portal_case_file_target_v1: два новых вида файла для подписанной ссылки - 'student_receipt' и 'payment_details_qr'.
--   8) Журнал действий: четыре действия finance.receipt.* / finance.paymentdetails.update и два типа объекта (приём 311/356).
--
-- Права. Принять или отклонить может администратор организации и сотрудник с тем же правом, что записывает оплату дела сегодня
-- (case.update.append на деле либо ответственный продажник до передачи) при чтении блока «Договор и оплата»; куратор дела входит сюда.
-- Forward-only. Повтор отказывает a358_already_applied, пропавшая опора - a358_anchor_drift.
BEGIN;

DO $a358_anchor$
BEGIN
  IF to_regclass('platform.payment_obligations') IS NULL
    OR to_regclass('platform.payment_events') IS NULL
    OR to_regclass('platform.payment_receipt_files') IS NULL
    OR to_regclass('platform.case_pending_receipts') IS NULL
    OR to_regclass('platform.staff_notifications') IS NULL
    OR to_regprocedure('platform.record_case_payment_v1(uuid,uuid,uuid,uuid,bigint,text,date,text)') IS NULL
    OR to_regprocedure('platform.student_portal_case_file_target_v1(text,uuid)') IS NULL
    OR to_regprocedure('platform_private.student_portal_money_case_v1()') IS NULL
    OR to_regprocedure('platform_private.staff_notification_visible(platform.staff_notifications)') IS NULL
    OR to_regprocedure('platform_private.staff_notification_visible_as(platform.staff_notifications,uuid)') IS NULL
    OR to_regprocedure('platform_private.receipt_staff_can_write(uuid,uuid,uuid)') IS NULL
    OR to_regprocedure('platform_private.p3c_request_child_id(uuid,text)') IS NULL
    OR to_regprocedure('platform_private.p7a_safe_audit_actions()') IS NULL
    OR to_regprocedure('platform_private.p7a_safe_audit_resource_types()') IS NULL
    OR to_regprocedure('platform_private.block_append_only_mutation()') IS NULL THEN
    RAISE EXCEPTION 'a358_anchor_drift: the 189 / 229 / 349 / 352 objects this migration builds on are missing' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('platform.student_payment_receipts') IS NOT NULL OR to_regclass('platform.payment_details_versions') IS NOT NULL THEN
    RAISE EXCEPTION 'a358_already_applied' USING ERRCODE = '55000';
  END IF;
END
$a358_anchor$;

-- ---------------------------------------------------------------------------
-- 1) Чек студента.
-- ---------------------------------------------------------------------------
CREATE TABLE platform.student_payment_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  student_membership_id UUID NOT NULL,
  -- Платёж, к которому студент приложил чек (NULL - чек без платежа; платёж выберет сотрудник при принятии).
  payment_obligation_id UUID,
  declared_amount_minor BIGINT NOT NULL CHECK (declared_amount_minor BETWEEN 1 AND 1000000000000),
  declared_currency TEXT NOT NULL CHECK (declared_currency ~ '^[A-Z]{3}$'),
  declared_paid_on DATE NOT NULL,
  original_filename TEXT NOT NULL CHECK (btrim(original_filename) <> ''),
  declared_mime_type TEXT NOT NULL CHECK (declared_mime_type IN ('application/pdf', 'image/jpeg', 'image/png')),
  byte_size BIGINT NOT NULL CHECK (byte_size BETWEEN 1 AND 26214400),
  sha256_hex TEXT NOT NULL CHECK (sha256_hex ~ '^[0-9a-f]{64}$'),
  storage_object_name TEXT NOT NULL CHECK (btrim(storage_object_name) <> ''),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  submit_request_id UUID NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  reviewed_by_membership_id UUID,
  reviewed_at TIMESTAMPTZ,
  review_request_id UUID,
  reject_reason TEXT CHECK (reject_reason IS NULL OR (btrim(reject_reason) <> '' AND char_length(reject_reason) <= 1000)),
  accepted_payment_obligation_id UUID,
  accepted_amount_minor BIGINT CHECK (accepted_amount_minor IS NULL OR accepted_amount_minor > 0),
  accepted_currency TEXT CHECK (accepted_currency IS NULL OR accepted_currency ~ '^[A-Z]{3}$'),
  accepted_paid_on DATE,
  accepted_payment_event_id UUID,
  accepted_receipt_file_id UUID,
  CONSTRAINT student_payment_receipts_org_id_key UNIQUE (organization_id, id),
  CONSTRAINT student_payment_receipts_submit_key UNIQUE (organization_id, submit_request_id),
  CONSTRAINT student_payment_receipts_review_shape CHECK (
    (status = 'pending' AND reviewed_by_membership_id IS NULL AND reviewed_at IS NULL AND review_request_id IS NULL
      AND reject_reason IS NULL AND accepted_payment_obligation_id IS NULL AND accepted_amount_minor IS NULL AND accepted_currency IS NULL
      AND accepted_paid_on IS NULL AND accepted_payment_event_id IS NULL AND accepted_receipt_file_id IS NULL)
    OR (status = 'rejected' AND reviewed_by_membership_id IS NOT NULL AND reviewed_at IS NOT NULL AND review_request_id IS NOT NULL
      AND reject_reason IS NOT NULL AND accepted_payment_obligation_id IS NULL AND accepted_amount_minor IS NULL AND accepted_currency IS NULL
      AND accepted_paid_on IS NULL AND accepted_payment_event_id IS NULL AND accepted_receipt_file_id IS NULL)
    OR (status = 'accepted' AND reviewed_by_membership_id IS NOT NULL AND reviewed_at IS NOT NULL AND review_request_id IS NOT NULL
      AND reject_reason IS NULL AND accepted_payment_obligation_id IS NOT NULL AND accepted_amount_minor IS NOT NULL
      AND accepted_currency IS NOT NULL AND accepted_paid_on IS NOT NULL AND accepted_payment_event_id IS NOT NULL
      AND accepted_receipt_file_id IS NOT NULL)),
  CONSTRAINT student_payment_receipts_case_fkey FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT student_payment_receipts_student_fkey FOREIGN KEY (organization_id, student_membership_id)
    REFERENCES platform.organization_memberships (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT student_payment_receipts_obligation_fkey FOREIGN KEY (organization_id, payment_obligation_id, student_case_id)
    REFERENCES platform.payment_obligations (organization_id, id, student_case_id) ON DELETE RESTRICT,
  CONSTRAINT student_payment_receipts_reviewer_fkey FOREIGN KEY (organization_id, reviewed_by_membership_id)
    REFERENCES platform.organization_memberships (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT student_payment_receipts_accepted_obligation_fkey FOREIGN KEY (organization_id, accepted_payment_obligation_id, student_case_id)
    REFERENCES platform.payment_obligations (organization_id, id, student_case_id) ON DELETE RESTRICT,
  CONSTRAINT student_payment_receipts_event_fkey FOREIGN KEY (organization_id, accepted_payment_event_id)
    REFERENCES platform.payment_events (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT student_payment_receipts_file_fkey FOREIGN KEY (organization_id, accepted_receipt_file_id)
    REFERENCES platform.payment_receipt_files (organization_id, id) ON DELETE RESTRICT
);
-- Один и тот же файл не лежит дважды «на проверке» или «принят» в деле (повторная отправка и двойной учёт). Отклонённый можно приложить снова.
CREATE UNIQUE INDEX student_payment_receipts_live_file_idx
  ON platform.student_payment_receipts (organization_id, student_case_id, sha256_hex) WHERE status IN ('pending', 'accepted');
CREATE INDEX student_payment_receipts_queue_idx ON platform.student_payment_receipts (organization_id, submitted_at, id) WHERE status = 'pending';
CREATE INDEX student_payment_receipts_case_idx ON platform.student_payment_receipts (organization_id, student_case_id, submitted_at DESC);
CREATE INDEX student_payment_receipts_obligation_idx ON platform.student_payment_receipts (organization_id, payment_obligation_id)
  WHERE payment_obligation_id IS NOT NULL;

-- Единственное допустимое изменение: pending -> accepted | rejected один раз; всё, что студент заявил, и файл неизменны.
CREATE FUNCTION platform_private.student_payment_receipt_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.status <> 'pending' OR NEW.status NOT IN ('accepted', 'rejected')
    OR NEW.id <> OLD.id OR NEW.organization_id <> OLD.organization_id OR NEW.student_case_id <> OLD.student_case_id
    OR NEW.student_membership_id <> OLD.student_membership_id
    OR NEW.payment_obligation_id IS DISTINCT FROM OLD.payment_obligation_id
    OR NEW.declared_amount_minor <> OLD.declared_amount_minor OR NEW.declared_currency <> OLD.declared_currency
    OR NEW.declared_paid_on <> OLD.declared_paid_on OR NEW.original_filename <> OLD.original_filename
    OR NEW.declared_mime_type <> OLD.declared_mime_type OR NEW.byte_size <> OLD.byte_size OR NEW.sha256_hex <> OLD.sha256_hex
    OR NEW.storage_object_name <> OLD.storage_object_name OR NEW.submit_request_id <> OLD.submit_request_id
    OR NEW.submitted_at <> OLD.submitted_at THEN
    RAISE EXCEPTION 'student_payment_receipt_immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION platform_private.student_payment_receipt_guard() FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
CREATE TRIGGER student_payment_receipts_update_guard BEFORE UPDATE ON platform.student_payment_receipts
  FOR EACH ROW EXECUTE FUNCTION platform_private.student_payment_receipt_guard();
CREATE TRIGGER student_payment_receipts_no_delete BEFORE DELETE ON platform.student_payment_receipts
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER student_payment_receipts_no_truncate BEFORE TRUNCATE ON platform.student_payment_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
ALTER TABLE platform.student_payment_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.student_payment_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE platform.student_payment_receipts FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;

-- ---------------------------------------------------------------------------
-- 2) Реквизиты для оплаты: версии, только добавление.
-- ---------------------------------------------------------------------------
CREATE TABLE platform.payment_details_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations (id) ON DELETE RESTRICT,
  version_no INTEGER NOT NULL CHECK (version_no >= 1),
  details_text TEXT NOT NULL CHECK (char_length(details_text) <= 4000),
  qr_original_filename TEXT,
  qr_mime_type TEXT CHECK (qr_mime_type IS NULL OR qr_mime_type IN ('image/jpeg', 'image/png')),
  qr_byte_size BIGINT CHECK (qr_byte_size IS NULL OR qr_byte_size BETWEEN 1 AND 26214400),
  qr_sha256_hex TEXT CHECK (qr_sha256_hex IS NULL OR qr_sha256_hex ~ '^[0-9a-f]{64}$'),
  qr_storage_object_name TEXT CHECK (qr_storage_object_name IS NULL OR btrim(qr_storage_object_name) <> ''),
  updated_by_membership_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT payment_details_versions_version_key UNIQUE (organization_id, version_no),
  CONSTRAINT payment_details_versions_qr_shape CHECK (
    (qr_storage_object_name IS NULL AND qr_original_filename IS NULL AND qr_mime_type IS NULL AND qr_byte_size IS NULL AND qr_sha256_hex IS NULL)
    OR (qr_storage_object_name IS NOT NULL AND qr_original_filename IS NOT NULL AND qr_mime_type IS NOT NULL
      AND qr_byte_size IS NOT NULL AND qr_sha256_hex IS NOT NULL)),
  CONSTRAINT payment_details_versions_author_fkey FOREIGN KEY (organization_id, updated_by_membership_id)
    REFERENCES platform.organization_memberships (organization_id, id) ON DELETE RESTRICT
);
CREATE TRIGGER payment_details_versions_no_update BEFORE UPDATE ON platform.payment_details_versions
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER payment_details_versions_no_delete BEFORE DELETE ON platform.payment_details_versions
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER payment_details_versions_no_truncate BEFORE TRUNCATE ON platform.payment_details_versions
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
ALTER TABLE platform.payment_details_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.payment_details_versions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE platform.payment_details_versions FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;

-- ---------------------------------------------------------------------------
-- 3) Закрытые помощники: кто видит и кто разбирает чеки дела.
-- ---------------------------------------------------------------------------
-- Чтение: администратор организации; полное чтение финансов; чтение дела + финансовая сводка; ответственный продажник до передачи.
-- Это ровно чтение блока «Договор и оплата» (staff_case_agreement_v1).
CREATE FUNCTION platform_private.receipt_staff_can_read(p_org UUID, p_member UUID, p_case UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM platform_private.staff_membership_identity(p_org, p_member))
    AND EXISTS (
      SELECT 1 FROM platform.student_cases c
      WHERE c.organization_id = p_org AND c.id = p_case
        AND (
          EXISTS (SELECT 1 FROM platform_private.staff_membership_identity(p_org, p_member) i WHERE i.system_role = 'admin')
          OR platform_private.staff_can_access(p_org, p_member, 'finance.read.full', 'organization', p_org)
          OR (platform_private.staff_can_access(p_org, p_member, 'case.read.full', 'student_case', p_case)
            AND platform_private.staff_has_permission(p_org, p_member, 'finance.read.summary'))
          OR (c.state = 'pending' AND c.responsible_sales_membership_id = p_member)
        )
    )
$$;
-- Разбор: чтение (выше) + право записи оплаты дела (как record_case_payment_v1 и 229) либо администратор организации.
CREATE FUNCTION platform_private.receipt_staff_can_review(p_org UUID, p_member UUID, p_case UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT platform_private.receipt_staff_can_read(p_org, p_member, p_case)
    AND (
      EXISTS (SELECT 1 FROM platform_private.staff_membership_identity(p_org, p_member) i WHERE i.system_role = 'admin')
      OR platform_private.staff_can_access(p_org, p_member, 'case.update.append', 'student_case', p_case)
      OR EXISTS (SELECT 1 FROM platform.student_cases c WHERE c.organization_id = p_org AND c.id = p_case
        AND c.state = 'pending' AND c.responsible_sales_membership_id = p_member)
    )
$$;
-- Системный администратор организации (правит реквизиты).
CREATE FUNCTION platform_private.payment_details_is_admin(p_org UUID, p_member UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM platform_private.staff_membership_identity(p_org, p_member) i WHERE i.system_role = 'admin')
$$;
REVOKE ALL ON FUNCTION platform_private.receipt_staff_can_read(UUID, UUID, UUID), platform_private.receipt_staff_can_review(UUID, UUID, UUID),
  platform_private.payment_details_is_admin(UUID, UUID) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;

-- Уведомление: куратору дела и всем, кто читает финансы организации целиком (кроме самого студента-автора).
CREATE FUNCTION platform_private.notify_student_receipt(p_org UUID, p_case UUID, p_receipt UUID, p_student_membership UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE curator UUID;
BEGIN
  SELECT c.current_curator_membership_id INTO curator FROM platform.student_cases c WHERE c.organization_id = p_org AND c.id = p_case;
  INSERT INTO platform.staff_notifications (organization_id, recipient_membership_id, event_key, kind, student_case_id, actor_membership_id)
  SELECT p_org, m.id, 'student-receipt:' || p_receipt::TEXT, 'student_receipt', p_case, p_student_membership
  FROM platform.organization_memberships m
  JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = p_org AND m.status = 'active' AND p.status = 'active' AND m."current_role" IS DISTINCT FROM 'student'
    AND m.id <> p_student_membership
    AND (m.id = curator OR platform_private.staff_can_access(p_org, m.id, 'finance.read.full', 'organization', p_org))
  ON CONFLICT (organization_id, recipient_membership_id, event_key) DO NOTHING;
END
$$;
REVOKE ALL ON FUNCTION platform_private.notify_student_receipt(UUID, UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;

-- Уведомление студенту о решении («Что нового» / «Входящие», сайт и приложение): та же таблица platform.notifications, что у сообщений
-- чата (330). Заголовок несёт слова решения: «Чек принят: 100.50 USD» / «Чек отклонён: причина»; клиент выводит их на языке студента.
CREATE FUNCTION platform_private.notify_student_receipt_decision(p_org UUID, p_receipt UUID, p_accepted BOOLEAN, p_text TEXT, p_actor UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r platform.student_payment_receipts%ROWTYPE; v_notification UUID; v_title TEXT; v_text TEXT;
BEGIN
  SELECT * INTO r FROM platform.student_payment_receipts x WHERE x.organization_id = p_org AND x.id = p_receipt;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM platform.organization_memberships m JOIN platform.profiles pr ON pr.id = m.profile_id
      WHERE m.organization_id = p_org AND m.id = r.student_membership_id AND m.status = 'active' AND pr.status = 'active') THEN
    RETURN;
  END IF;
  -- Лента студента принимает подпись до 300 знаков без пробелов по краям: длинная причина укорачивается до 280 знаков и «…»
  -- (полная причина остаётся в истории оплат).
  v_text := btrim(regexp_replace(p_text, E'[\\x01-\\x1f\\x7f]+', ' ', 'g'));
  IF char_length(v_text) > 280 THEN v_text := btrim(left(v_text, 280)) || '…'; END IF;
  v_title := (CASE WHEN p_accepted THEN 'Чек принят: ' ELSE 'Чек отклонён: ' END) || v_text;
  INSERT INTO platform.notifications (organization_id, student_case_id, recipient_membership_id, category, title, body, dedupe_key,
    created_by_membership_id)
  VALUES (p_org, r.student_case_id, r.student_membership_id, 'payment.receipt', v_title, v_title,
    'payment_receipt:' || p_receipt::TEXT || CASE WHEN p_accepted THEN ':accepted' ELSE ':rejected' END, p_actor)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_notification;
  IF v_notification IS NOT NULL THEN
    INSERT INTO platform.notification_events (organization_id, notification_id, student_case_id, recipient_membership_id, event_type,
      actor_membership_id, reason, request_id)
    VALUES (p_org, v_notification, r.student_case_id, r.student_membership_id, 'created', p_actor,
      'Student payment receipt decision', gen_random_uuid());
  END IF;
END
$$;
REVOKE ALL ON FUNCTION platform_private.notify_student_receipt_decision(UUID, UUID, BOOLEAN, TEXT, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;

-- Свои уведомления о чеках для «Что нового»: форма та же, что у чата (330); subject_label - сумма или причина (текст после «: »).
CREATE FUNCTION platform_private.own_payment_receipt_notifications()
RETURNS TABLE (notification_id UUID, category TEXT, event_code TEXT, subject_label TEXT, detail TEXT,
  due_at TIMESTAMPTZ, created_at TIMESTAMPTZ, read_at TIMESTAMPTZ)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT n.id, n.category,
    CASE WHEN n.dedupe_key LIKE '%:accepted' THEN 'payment_receipt_accepted' ELSE 'payment_receipt_rejected' END,
    substr(n.title, strpos(n.title, ': ') + 2), NULL::TEXT, NULL::TIMESTAMPTZ, n.created_at, n.read_at
  FROM platform.current_actor_authority() a
  JOIN platform.notifications n ON n.organization_id = a.organization_id AND n.recipient_membership_id = a.membership_id
  WHERE a.platform_role = 'student' AND n.category = 'payment.receipt'
    AND private.platform_has_permission(a.organization_id, 'notification.read.self')
    AND private.platform_can_read_student_portal_case(n.organization_id, n.student_case_id)
$$;
REVOKE ALL ON FUNCTION platform_private.own_payment_receipt_notifications()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;

-- ---------------------------------------------------------------------------
-- 4) Студент: страница «Оплата» одним чтением и проверка перед загрузкой.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.student_portal_payment_center_v1()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE org UUID; case_ids UUID[]; details JSONB := NULL; dues JSONB; loose JSONB; current_details platform.payment_details_versions%ROWTYPE;
BEGIN
  SELECT min(own.organization_id::TEXT)::UUID, array_agg(own.student_case_id) INTO org, case_ids FROM platform_private.student_portal_money_case_v1() own;
  IF case_ids IS NULL THEN
    RETURN jsonb_build_object('details', NULL, 'dues', '[]'::JSONB, 'unassigned', '[]'::JSONB, 'can_upload', FALSE);
  END IF;
  SELECT * INTO current_details FROM platform.payment_details_versions v WHERE v.organization_id = org ORDER BY v.version_no DESC LIMIT 1;
  IF FOUND AND (btrim(current_details.details_text) <> '' OR current_details.qr_storage_object_name IS NOT NULL) THEN
    details := jsonb_build_object('text', current_details.details_text, 'has_qr', current_details.qr_storage_object_name IS NOT NULL,
      'qr_id', CASE WHEN current_details.qr_storage_object_name IS NULL THEN NULL ELSE current_details.id END,
      'updated_at', current_details.created_at);
  END IF;

  SELECT COALESCE(jsonb_agg(due.item ORDER BY due.due_at NULLS LAST, due.id), '[]'::JSONB) INTO dues FROM (
    SELECT o.id, o.due_at, jsonb_build_object(
      'obligation_id', o.id, 'label', o.label, 'category', o.category, 'amount_minor', o.amount_minor, 'paid_minor', o.total_paid_minor,
      'refunded_minor', o.total_refunded_minor,
      'outstanding_minor', o.amount_minor - o.total_paid_minor + o.total_refunded_minor, 'currency', o.currency, 'due_at', o.due_at,
      'derived_status', platform_private.derive_obligation_status(o.amount_minor, o.total_paid_minor, o.total_refunded_minor, o.due_at, transaction_timestamp()),
      'overdue', (o.due_at IS NOT NULL AND o.due_at < transaction_timestamp()
        AND o.amount_minor - o.total_paid_minor + o.total_refunded_minor > 0),
      'next_action', o.next_action,
      'entries', COALESCE((
        SELECT jsonb_agg(entry.item ORDER BY entry.day DESC, entry.at DESC, entry.id) FROM (
          SELECT e.id, (e.occurred_at AT TIME ZONE 'Asia/Bishkek')::DATE AS day, e.occurred_at AS at,
            jsonb_build_object('kind', CASE e.event_type WHEN 'refund' THEN 'refund' ELSE 'payment' END, 'entry_id', e.id, 'status', 'accepted',
              'amount_minor', e.amount_minor, 'currency', e.currency, 'on_date', (e.occurred_at AT TIME ZONE 'Asia/Bishkek')::DATE,
              'reject_reason', NULL, 'file_kind', CASE WHEN f.id IS NULL THEN NULL ELSE 'receipt' END, 'file_id', f.id,
              'filename', f.original_filename) AS item
          FROM platform.payment_events e
          LEFT JOIN LATERAL (SELECT pf.id, pf.original_filename FROM platform.payment_receipt_files pf
            WHERE pf.organization_id = e.organization_id AND pf.payment_event_id = e.id ORDER BY pf.uploaded_at, pf.id LIMIT 1) f ON TRUE
          WHERE e.organization_id = o.organization_id AND e.payment_obligation_id = o.id
          UNION ALL
          SELECT r.id, r.declared_paid_on, r.submitted_at,
            jsonb_build_object('kind', 'receipt', 'entry_id', r.id, 'status', CASE r.status WHEN 'pending' THEN 'review' ELSE 'rejected' END,
              'amount_minor', r.declared_amount_minor, 'currency', r.declared_currency, 'on_date', r.declared_paid_on,
              'reject_reason', r.reject_reason, 'file_kind', 'student_receipt', 'file_id', r.id, 'filename', r.original_filename)
          FROM platform.student_payment_receipts r
          WHERE r.organization_id = o.organization_id AND r.payment_obligation_id = o.id AND r.status IN ('pending', 'rejected')
        ) entry), '[]'::JSONB)
    ) AS item
    FROM platform.payment_obligations o
    WHERE o.organization_id = org AND o.student_case_id = ANY (case_ids) AND o.archived_at IS NULL
  ) due;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', 'receipt', 'entry_id', r.id,
    'status', CASE r.status WHEN 'pending' THEN 'review' ELSE 'rejected' END, 'amount_minor', r.declared_amount_minor,
    'currency', r.declared_currency, 'on_date', r.declared_paid_on, 'reject_reason', r.reject_reason, 'file_kind', 'student_receipt',
    'file_id', r.id, 'filename', r.original_filename) ORDER BY r.declared_paid_on DESC, r.submitted_at DESC, r.id), '[]'::JSONB) INTO loose
  FROM platform.student_payment_receipts r
  WHERE r.organization_id = org AND r.student_case_id = ANY (case_ids) AND r.payment_obligation_id IS NULL AND r.status IN ('pending', 'rejected');

  RETURN jsonb_build_object('details', details, 'dues', dues, 'unassigned', loose, 'can_upload', TRUE);
END
$$;

-- Проверка перед загрузкой файла: свой платёж (или любое своё дело, если платёж не выбран) -> адрес записи. Чужой платёж - 42501.
CREATE FUNCTION platform.student_payment_receipt_target_v1(p_payment_obligation_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; picked RECORD;
BEGIN
  SELECT a.* INTO actor FROM platform.current_actor_authority() a WHERE a.platform_role = 'student' LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'receipt_forbidden' USING ERRCODE = '42501'; END IF;
  IF p_payment_obligation_id IS NOT NULL THEN
    SELECT o.organization_id, o.student_case_id, o.id AS obligation_id, o.currency INTO picked
    FROM platform_private.student_portal_money_case_v1() own
    JOIN platform.payment_obligations o ON o.organization_id = own.organization_id AND o.student_case_id = own.student_case_id
    WHERE o.id = p_payment_obligation_id AND o.archived_at IS NULL;
  ELSE
    -- Без платежа: чек уходит в самое новое дело студента с доступом к финансам.
    SELECT own.organization_id, own.student_case_id, NULL::UUID AS obligation_id, NULL::TEXT AS currency INTO picked
    FROM platform_private.student_portal_money_case_v1() own
    JOIN platform.student_cases c ON c.organization_id = own.organization_id AND c.id = own.student_case_id
    ORDER BY c.created_at DESC, c.id LIMIT 1;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'receipt_forbidden' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object('organization_id', picked.organization_id, 'student_case_id', picked.student_case_id,
    'student_membership_id', actor.membership_id, 'payment_obligation_id', picked.obligation_id, 'currency', picked.currency);
END
$$;

-- ---------------------------------------------------------------------------
-- 5) Сервер: запись метаданных чека после загрузки файла и антивируса.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.record_student_payment_receipt_v1(
  p_organization_id UUID, p_student_membership_id UUID, p_student_case_id UUID, p_payment_obligation_id UUID,
  p_amount_minor BIGINT, p_currency TEXT, p_paid_on DATE, p_original_filename TEXT, p_declared_mime_type TEXT, p_byte_size BIGINT,
  p_sha256_hex TEXT, p_storage_object_name TEXT, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE existing platform.student_payment_receipts%ROWTYPE; case_row platform.student_cases%ROWTYPE; obligation_row platform.payment_obligations%ROWTYPE;
  new_id UUID := gen_random_uuid(); curr TEXT; student_profile UUID; student_user UUID; pending_count BIGINT; safe_name TEXT; v_constraint TEXT;
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role is required' USING ERRCODE = '42501';
  END IF;
  IF p_organization_id IS NULL OR p_student_membership_id IS NULL OR p_student_case_id IS NULL OR p_request_id IS NULL
    OR p_amount_minor IS NULL OR p_amount_minor NOT BETWEEN 1 AND 1000000000000 OR p_currency IS NULL OR upper(btrim(p_currency)) !~ '^[A-Z]{3}$'
    OR p_paid_on IS NULL OR p_original_filename IS NULL OR btrim(p_original_filename) = ''
    OR lower(btrim(p_declared_mime_type)) NOT IN ('application/pdf', 'image/jpeg', 'image/png')
    OR p_byte_size IS NULL OR p_byte_size NOT BETWEEN 1 AND 26214400 OR lower(btrim(p_sha256_hex)) !~ '^[0-9a-f]{64}$'
    OR p_storage_object_name IS NULL
    OR p_storage_object_name NOT LIKE 'payment-receipts/' || p_organization_id::TEXT || '/' || p_student_case_id::TEXT || '/%' THEN
    RAISE EXCEPTION 'receipt_invalid' USING ERRCODE = '22023';
  END IF;
  curr := upper(btrim(p_currency));
  -- Имя файла идёт на страницу студента и в журнал: управляющие знаки убираются, длина - по символам (не по байтам).
  safe_name := left(btrim(regexp_replace(p_original_filename, E'[\\x01-\\x1f\\x7f]', '', 'g')), 255);
  IF safe_name = '' THEN safe_name := 'file'; END IF;
  PERFORM platform_private.lock_p2e_request(p_request_id);
  SELECT * INTO existing FROM platform.student_payment_receipts r WHERE r.organization_id = p_organization_id AND r.submit_request_id = p_request_id;
  IF FOUND THEN
    IF existing.student_membership_id <> p_student_membership_id OR existing.sha256_hex <> lower(btrim(p_sha256_hex)) THEN
      RAISE EXCEPTION 'request_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('organization_id', p_organization_id, 'receipt_id', existing.id, 'status', existing.status, 'replayed', TRUE);
  END IF;
  IF p_paid_on > (statement_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE + 1 OR p_paid_on < (statement_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE - 1100 THEN
    RAISE EXCEPTION 'receipt_invalid_date' USING ERRCODE = '22023';
  END IF;
  -- Дело принадлежит именно этому студенту, активно, кабинет открыт; студент-участник организации.
  SELECT c.* INTO case_row FROM platform.student_cases c
  JOIN platform.organization_memberships m ON m.organization_id = c.organization_id AND m.id = c.student_membership_id
  WHERE c.organization_id = p_organization_id AND c.id = p_student_case_id AND c.student_membership_id = p_student_membership_id
    AND c.state IN ('active', 'closed') AND c.portal_activated_at IS NOT NULL AND m.status = 'active' AND m."current_role" = 'student';
  IF NOT FOUND THEN RAISE EXCEPTION 'receipt_forbidden' USING ERRCODE = '42501'; END IF;
  IF p_payment_obligation_id IS NOT NULL THEN
    SELECT * INTO obligation_row FROM platform.payment_obligations o WHERE o.organization_id = p_organization_id AND o.id = p_payment_obligation_id
      AND o.student_case_id = p_student_case_id AND o.archived_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'receipt_forbidden' USING ERRCODE = '42501'; END IF;
    IF obligation_row.currency <> curr THEN RAISE EXCEPTION 'receipt_currency_mismatch' USING ERRCODE = '22023'; END IF;
  END IF;
  SELECT count(*) INTO pending_count FROM platform.student_payment_receipts r
    WHERE r.organization_id = p_organization_id AND r.student_membership_id = p_student_membership_id AND r.status = 'pending';
  IF pending_count >= 10 THEN RAISE EXCEPTION 'receipt_too_many' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM platform.student_payment_receipts r WHERE r.organization_id = p_organization_id AND r.student_case_id = p_student_case_id
      AND r.sha256_hex = lower(btrim(p_sha256_hex)) AND r.status IN ('pending', 'accepted')) THEN
    RAISE EXCEPTION 'receipt_duplicate' USING ERRCODE = '23505';
  END IF;
  BEGIN
    INSERT INTO platform.student_payment_receipts (id, organization_id, student_case_id, student_membership_id, payment_obligation_id,
      declared_amount_minor, declared_currency, declared_paid_on, original_filename, declared_mime_type, byte_size, sha256_hex,
      storage_object_name, submit_request_id)
    VALUES (new_id, p_organization_id, p_student_case_id, p_student_membership_id, p_payment_obligation_id, p_amount_minor, curr, p_paid_on,
      safe_name, lower(btrim(p_declared_mime_type)), p_byte_size, lower(btrim(p_sha256_hex)),
      btrim(p_storage_object_name), p_request_id);
  EXCEPTION WHEN unique_violation THEN
    -- Гонка двух одинаковых отправок: тот же файл - «уже отправлен» (проверка выше её не ловит), тот же запрос - повтор.
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint = 'student_payment_receipts_submit_key' THEN
      SELECT * INTO existing FROM platform.student_payment_receipts r WHERE r.organization_id = p_organization_id AND r.submit_request_id = p_request_id;
      RETURN jsonb_build_object('organization_id', p_organization_id, 'receipt_id', existing.id, 'status', existing.status, 'replayed', TRUE);
    END IF;
    RAISE EXCEPTION 'receipt_duplicate' USING ERRCODE = '23505';
  END;
  SELECT pr.id, pr.auth_user_id INTO student_profile, student_user FROM platform.organization_memberships m
    JOIN platform.profiles pr ON pr.id = m.profile_id WHERE m.organization_id = p_organization_id AND m.id = p_student_membership_id;
  INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_membership_id, actor_principal, action, resource_type,
    resource_id, before_state, after_state, reason, request_id)
  VALUES (p_organization_id, 'user', student_profile, p_student_membership_id, 'auth:' || student_user::TEXT, 'finance.receipt.submit',
    'student_payment_receipt', new_id, NULL,
    jsonb_build_object('receipt_id', new_id, 'student_case_id', p_student_case_id, 'payment_obligation_id', p_payment_obligation_id,
      'amount_minor', p_amount_minor, 'currency', curr, 'paid_on', p_paid_on, 'original_filename', safe_name),
    'Student attached a payment receipt for review', platform_private.p3c_request_child_id(p_request_id, 'audit'));
  PERFORM platform_private.notify_student_receipt(p_organization_id, p_student_case_id, new_id, p_student_membership_id);
  RETURN jsonb_build_object('organization_id', p_organization_id, 'receipt_id', new_id, 'status', 'pending', 'replayed', FALSE);
END
$$;

-- ---------------------------------------------------------------------------
-- 6) Сотрудник: очередь, файл, принять, отклонить.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.staff_payment_receipts_v1(p_student_case_id UUID DEFAULT NULL, p_status TEXT DEFAULT 'pending', p_limit INTEGER DEFAULT 100)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; items JSONB; total BIGINT;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('pending', 'accepted', 'rejected') OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'receipt_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT a.* INTO actor FROM platform.current_actor_authority() a
  JOIN platform_private.staff_membership_identity(a.organization_id, a.membership_id) i ON TRUE
  WHERE a.platform_role IS DISTINCT FROM 'student' LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'receipt_forbidden' USING ERRCODE = '42501'; END IF;
  WITH visible AS MATERIALIZED (
    SELECT r.* FROM platform.student_payment_receipts r
    WHERE r.organization_id = actor.organization_id AND r.status = p_status
      AND (p_student_case_id IS NULL OR r.student_case_id = p_student_case_id)
      AND platform_private.receipt_staff_can_read(r.organization_id, actor.membership_id, r.student_case_id)
  ), shown AS (
    SELECT * FROM visible ORDER BY submitted_at, id LIMIT p_limit
  )
  SELECT (SELECT count(*) FROM visible), COALESCE(jsonb_agg(jsonb_build_object(
    'receipt_id', s.id, 'student_case_id', s.student_case_id, 'student_display_name', c.student_display_name,
    'payment_obligation_id', s.payment_obligation_id, 'payment_label', declared.label,
    'amount_minor', s.declared_amount_minor::TEXT, 'currency', s.declared_currency, 'paid_on', s.declared_paid_on,
    'original_filename', s.original_filename, 'submitted_at', s.submitted_at, 'status', s.status, 'reject_reason', s.reject_reason,
    'reviewed_at', s.reviewed_at,
    'can_review', platform_private.receipt_staff_can_review(s.organization_id, actor.membership_id, s.student_case_id),
    'dues', COALESCE((SELECT jsonb_agg(jsonb_build_object('payment_obligation_id', o.id, 'label', o.label, 'currency', o.currency,
        'outstanding_minor', (o.amount_minor - o.total_paid_minor + o.total_refunded_minor)::TEXT) ORDER BY o.created_at, o.id)
      FROM platform.payment_obligations o WHERE o.organization_id = s.organization_id AND o.student_case_id = s.student_case_id
        AND o.archived_at IS NULL AND o.amount_minor - o.total_paid_minor + o.total_refunded_minor > 0), '[]'::JSONB)
  ) ORDER BY s.submitted_at, s.id), '[]'::JSONB)
  INTO total, items
  FROM shown s
  JOIN platform.student_cases c ON c.organization_id = s.organization_id AND c.id = s.student_case_id
  LEFT JOIN platform.payment_obligations declared ON declared.organization_id = s.organization_id AND declared.id = s.payment_obligation_id;
  RETURN jsonb_build_object('organization_id', actor.organization_id, 'status', p_status, 'total', COALESCE(total, 0), 'receipts', items);
END
$$;

CREATE FUNCTION platform.staff_student_receipt_download_target_v1(p_receipt_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; r platform.student_payment_receipts%ROWTYPE;
BEGIN
  SELECT a.* INTO actor FROM platform.current_actor_authority() a
  JOIN platform_private.staff_membership_identity(a.organization_id, a.membership_id) i ON TRUE
  WHERE a.platform_role IS DISTINCT FROM 'student' LIMIT 1;
  IF NOT FOUND OR p_receipt_id IS NULL THEN RAISE EXCEPTION 'receipt_forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO r FROM platform.student_payment_receipts x WHERE x.organization_id = actor.organization_id AND x.id = p_receipt_id;
  IF NOT FOUND OR NOT platform_private.receipt_staff_can_read(r.organization_id, actor.membership_id, r.student_case_id) THEN
    RAISE EXCEPTION 'receipt_forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('organization_id', r.organization_id, 'student_case_id', r.student_case_id, 'receipt_id', r.id,
    'storage_object_name', r.storage_object_name);
END
$$;

CREATE FUNCTION platform.accept_student_payment_receipt_v1(
  p_organization_id UUID, p_receipt_id UUID, p_payment_obligation_id UUID, p_amount_minor BIGINT, p_currency TEXT, p_paid_on DATE, p_request_id UUID,
  p_new_due_label TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; r platform.student_payment_receipts%ROWTYPE; paid JSONB; event_id UUID; file_id UUID := gen_random_uuid(); curr TEXT;
  obligation_id UUID; result JSONB; new_label TEXT; created_due JSONB; created_due_id UUID;
BEGIN
  IF p_organization_id IS NULL OR p_receipt_id IS NULL OR p_request_id IS NULL OR p_amount_minor IS NULL OR p_amount_minor <= 0
    OR p_currency IS NULL OR upper(btrim(p_currency)) !~ '^[A-Z]{3}$' OR p_paid_on IS NULL THEN
    RAISE EXCEPTION 'receipt_invalid' USING ERRCODE = '22023';
  END IF;
  curr := upper(btrim(p_currency));
  SELECT a.* INTO actor FROM platform.current_actor_authority() a WHERE a.organization_id = p_organization_id AND a.platform_role IS DISTINCT FROM 'student';
  IF NOT FOUND THEN RAISE EXCEPTION 'receipt_forbidden' USING ERRCODE = '42501'; END IF;
  PERFORM platform_private.lock_p2e_request(p_request_id);
  SELECT * INTO r FROM platform.student_payment_receipts x WHERE x.organization_id = p_organization_id AND x.id = p_receipt_id FOR UPDATE;
  IF NOT FOUND OR NOT platform_private.receipt_staff_can_review(p_organization_id, actor.membership_id, r.student_case_id) THEN
    RAISE EXCEPTION 'receipt_forbidden' USING ERRCODE = '42501';
  END IF;
  IF r.status = 'accepted' AND r.review_request_id = p_request_id THEN
    RETURN jsonb_build_object('organization_id', p_organization_id, 'receipt_id', r.id, 'status', 'accepted', 'payment_event_id', r.accepted_payment_event_id,
      'payment_receipt_file_id', r.accepted_receipt_file_id, 'replayed', TRUE)
      || COALESCE((SELECT jsonb_build_object('created_payment_obligation_id', e.after_state -> 'created_payment_obligation_id')
        FROM platform.audit_events e WHERE e.request_id = platform_private.p3c_request_child_id(p_request_id, 'audit')
          AND e.after_state ? 'created_payment_obligation_id'), '{}'::JSONB);
  END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'receipt_not_pending' USING ERRCODE = '22023'; END IF;
  IF p_paid_on > (statement_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE + 1 OR p_paid_on < (statement_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE - 1100 THEN
    RAISE EXCEPTION 'receipt_invalid_date' USING ERRCODE = '22023';
  END IF;
  new_label := NULLIF(btrim(COALESCE(p_new_due_label, '')), '');
  IF new_label IS NOT NULL THEN
    -- «Создать платёж на эту сумму»: нового платежа нет в деле - он создаётся тем же путём, что и в блоке «Договор и оплата»
    -- (save_case_tranche_v1: те же права и журнал), и чек принимается на него в этой же транзакции.
    IF p_payment_obligation_id IS NOT NULL OR char_length(new_label) > 500 THEN RAISE EXCEPTION 'receipt_invalid' USING ERRCODE = '22023'; END IF;
    created_due := platform.save_case_tranche_v1(p_organization_id, platform_private.p3c_request_child_id(p_request_id, 'due'), r.student_case_id,
      NULL, p_amount_minor, curr, NULL, new_label, FALSE);
    created_due_id := (created_due ->> 'payment_obligation_id')::UUID;
    obligation_id := created_due_id;
  ELSE
    obligation_id := COALESCE(p_payment_obligation_id, r.payment_obligation_id);
  END IF;
  IF obligation_id IS NULL THEN RAISE EXCEPTION 'receipt_obligation_required' USING ERRCODE = '22023'; END IF;
  -- Настоящая оплата тем же путём, что и ручная: права, остаток, валюта, журнал оплаты - в record_case_payment_v1.
  paid := platform.record_case_payment_v1(p_organization_id, platform_private.p3c_request_child_id(p_request_id, 'payment'), r.student_case_id,
    obligation_id, p_amount_minor, curr, p_paid_on, 'Оплата принята по чеку студента');
  event_id := (paid ->> 'payment_event_id')::UUID;
  INSERT INTO platform.payment_receipt_files (id, organization_id, student_case_id, payment_obligation_id, payment_event_id, original_filename,
    declared_mime_type, byte_size, sha256_hex, storage_object_name, uploaded_by_membership_id)
  VALUES (file_id, p_organization_id, r.student_case_id, obligation_id, event_id, r.original_filename, r.declared_mime_type, r.byte_size,
    r.sha256_hex, r.storage_object_name, r.student_membership_id);
  UPDATE platform.student_payment_receipts SET status = 'accepted', reviewed_by_membership_id = actor.membership_id,
    reviewed_at = statement_timestamp(), review_request_id = p_request_id, accepted_payment_obligation_id = obligation_id,
    accepted_amount_minor = p_amount_minor, accepted_currency = curr, accepted_paid_on = p_paid_on, accepted_payment_event_id = event_id,
    accepted_receipt_file_id = file_id
    WHERE organization_id = p_organization_id AND id = r.id;
  result := jsonb_build_object('organization_id', p_organization_id, 'receipt_id', r.id, 'status', 'accepted', 'payment_event_id', event_id,
    'payment_receipt_file_id', file_id, 'replayed', FALSE);
  IF created_due_id IS NOT NULL THEN result := result || jsonb_build_object('created_payment_obligation_id', created_due_id); END IF;
  PERFORM platform_private.notify_student_receipt_decision(p_organization_id, r.id, TRUE, p_amount_minor / 100 || '.' || lpad((p_amount_minor % 100)::TEXT, 2, '0') || ' ' || curr, actor.membership_id);
  INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_membership_id, actor_principal, action, resource_type,
    resource_id, before_state, after_state, reason, request_id)
  VALUES (p_organization_id, 'user', actor.profile_id, actor.membership_id, 'auth:' || actor.auth_user_id::TEXT, 'finance.receipt.accept',
    'student_payment_receipt', r.id,
    jsonb_build_object('declared_amount_minor', r.declared_amount_minor, 'declared_currency', r.declared_currency, 'declared_paid_on', r.declared_paid_on,
      'payment_obligation_id', r.payment_obligation_id),
    result || jsonb_build_object('amount_minor', p_amount_minor, 'currency', curr, 'paid_on', p_paid_on, 'payment_obligation_id', obligation_id),
    'Student payment receipt accepted', platform_private.p3c_request_child_id(p_request_id, 'audit'));
  RETURN result;
END
$$;

CREATE FUNCTION platform.reject_student_payment_receipt_v1(p_organization_id UUID, p_receipt_id UUID, p_reason TEXT, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; r platform.student_payment_receipts%ROWTYPE; why TEXT; result JSONB;
BEGIN
  why := btrim(COALESCE(p_reason, ''));
  IF p_organization_id IS NULL OR p_receipt_id IS NULL OR p_request_id IS NULL OR why = '' OR char_length(why) > 1000
    OR why ~ E'[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]' THEN
    RAISE EXCEPTION 'receipt_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT a.* INTO actor FROM platform.current_actor_authority() a WHERE a.organization_id = p_organization_id AND a.platform_role IS DISTINCT FROM 'student';
  IF NOT FOUND THEN RAISE EXCEPTION 'receipt_forbidden' USING ERRCODE = '42501'; END IF;
  PERFORM platform_private.lock_p2e_request(p_request_id);
  SELECT * INTO r FROM platform.student_payment_receipts x WHERE x.organization_id = p_organization_id AND x.id = p_receipt_id FOR UPDATE;
  IF NOT FOUND OR NOT platform_private.receipt_staff_can_review(p_organization_id, actor.membership_id, r.student_case_id) THEN
    RAISE EXCEPTION 'receipt_forbidden' USING ERRCODE = '42501';
  END IF;
  IF r.status = 'rejected' AND r.review_request_id = p_request_id THEN
    RETURN jsonb_build_object('organization_id', p_organization_id, 'receipt_id', r.id, 'status', 'rejected', 'replayed', TRUE);
  END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'receipt_not_pending' USING ERRCODE = '22023'; END IF;
  UPDATE platform.student_payment_receipts SET status = 'rejected', reviewed_by_membership_id = actor.membership_id,
    reviewed_at = statement_timestamp(), review_request_id = p_request_id, reject_reason = why
    WHERE organization_id = p_organization_id AND id = r.id;
  result := jsonb_build_object('organization_id', p_organization_id, 'receipt_id', r.id, 'status', 'rejected', 'replayed', FALSE);
  PERFORM platform_private.notify_student_receipt_decision(p_organization_id, r.id, FALSE, why, actor.membership_id);
  INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_membership_id, actor_principal, action, resource_type,
    resource_id, before_state, after_state, reason, request_id)
  VALUES (p_organization_id, 'user', actor.profile_id, actor.membership_id, 'auth:' || actor.auth_user_id::TEXT, 'finance.receipt.reject',
    'student_payment_receipt', r.id, NULL, result || jsonb_build_object('reason', why), 'Student payment receipt rejected',
    platform_private.p3c_request_child_id(p_request_id, 'audit'));
  RETURN result;
END
$$;

-- ---------------------------------------------------------------------------
-- 7) Реквизиты: чтение и новая версия (только системный администратор).
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.staff_payment_details_v1()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; v platform.payment_details_versions%ROWTYPE; author TEXT;
BEGIN
  SELECT a.* INTO actor FROM platform.current_actor_authority() a WHERE a.platform_role IS DISTINCT FROM 'student'
    AND platform_private.payment_details_is_admin(a.organization_id, a.membership_id) LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment_details_forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM platform.payment_details_versions x WHERE x.organization_id = actor.organization_id ORDER BY x.version_no DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('organization_id', actor.organization_id, 'version_no', 0, 'text', '', 'has_qr', FALSE, 'qr_id', NULL,
      'qr_filename', NULL, 'updated_at', NULL, 'updated_by_display_name', NULL);
  END IF;
  SELECT i.display_name INTO author FROM platform_private.staff_membership_identity(actor.organization_id, v.updated_by_membership_id) i;
  RETURN jsonb_build_object('organization_id', actor.organization_id, 'version_no', v.version_no, 'text', v.details_text,
    'has_qr', v.qr_storage_object_name IS NOT NULL, 'qr_id', CASE WHEN v.qr_storage_object_name IS NULL THEN NULL ELSE v.id END,
    'qr_filename', v.qr_original_filename, 'updated_at', v.created_at, 'updated_by_display_name', author);
END
$$;

CREATE FUNCTION platform.staff_payment_details_qr_target_v1(p_version_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; v platform.payment_details_versions%ROWTYPE;
BEGIN
  SELECT a.* INTO actor FROM platform.current_actor_authority() a WHERE a.platform_role IS DISTINCT FROM 'student'
    AND platform_private.payment_details_is_admin(a.organization_id, a.membership_id) LIMIT 1;
  IF NOT FOUND OR p_version_id IS NULL THEN RAISE EXCEPTION 'payment_details_forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM platform.payment_details_versions x WHERE x.organization_id = actor.organization_id AND x.id = p_version_id
    AND x.qr_storage_object_name IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment_details_forbidden' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object('organization_id', actor.organization_id, 'version_id', v.id, 'storage_object_name', v.qr_storage_object_name,
    'mime_type', v.qr_mime_type);
END
$$;

-- p_qr_mode: 'keep' (оставить прежний QR), 'replace' (новый файл уже в Storage), 'remove' (убрать QR).
CREATE FUNCTION platform.record_payment_details_v1(
  p_organization_id UUID, p_membership_id UUID, p_details_text TEXT, p_qr_mode TEXT, p_qr_original_filename TEXT, p_qr_mime_type TEXT,
  p_qr_byte_size BIGINT, p_qr_sha256_hex TEXT, p_qr_storage_object_name TEXT, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE prev platform.payment_details_versions%ROWTYPE; new_id UUID := gen_random_uuid(); next_no INTEGER; body TEXT; identity RECORD;
  q_name TEXT; q_file TEXT; q_mime TEXT; q_size BIGINT; q_sha TEXT; result JSONB;
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role is required' USING ERRCODE = '42501';
  END IF;
  body := btrim(COALESCE(p_details_text, ''));
  IF p_organization_id IS NULL OR p_membership_id IS NULL OR p_request_id IS NULL OR char_length(body) > 4000
    OR body ~ E'[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]'
    OR p_qr_mode IS NULL OR p_qr_mode NOT IN ('keep', 'replace', 'remove') THEN
    RAISE EXCEPTION 'payment_details_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_qr_mode = 'replace' AND (p_qr_storage_object_name IS NULL
    OR p_qr_storage_object_name NOT LIKE 'payment-details/' || p_organization_id::TEXT || '/%'
    OR p_qr_original_filename IS NULL OR btrim(p_qr_original_filename) = '' OR lower(COALESCE(p_qr_mime_type, '')) NOT IN ('image/jpeg', 'image/png')
    OR p_qr_byte_size IS NULL OR p_qr_byte_size NOT BETWEEN 1 AND 26214400 OR lower(COALESCE(p_qr_sha256_hex, '')) !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'payment_details_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT i.* INTO identity FROM platform_private.staff_membership_identity(p_organization_id, p_membership_id) i WHERE i.system_role = 'admin';
  IF NOT FOUND THEN RAISE EXCEPTION 'payment_details_forbidden' USING ERRCODE = '42501'; END IF;
  PERFORM platform_private.lock_p2e_request(p_request_id);
  IF EXISTS (SELECT 1 FROM platform.audit_events e WHERE e.request_id = platform_private.p3c_request_child_id(p_request_id, 'audit')) THEN
    SELECT * INTO prev FROM platform.payment_details_versions x WHERE x.organization_id = p_organization_id ORDER BY x.version_no DESC LIMIT 1;
    RETURN jsonb_build_object('organization_id', p_organization_id, 'version_id', prev.id, 'version_no', prev.version_no, 'replayed', TRUE);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('evo:payment-details:' || p_organization_id::TEXT, 0));
  SELECT * INTO prev FROM platform.payment_details_versions x WHERE x.organization_id = p_organization_id ORDER BY x.version_no DESC LIMIT 1;
  next_no := CASE WHEN FOUND THEN prev.version_no + 1 ELSE 1 END;
  IF p_qr_mode = 'keep' AND prev.qr_storage_object_name IS NOT NULL THEN
    q_name := prev.qr_storage_object_name; q_file := prev.qr_original_filename; q_mime := prev.qr_mime_type; q_size := prev.qr_byte_size; q_sha := prev.qr_sha256_hex;
  ELSIF p_qr_mode = 'replace' THEN
    q_name := btrim(p_qr_storage_object_name); q_file := left(btrim(p_qr_original_filename), 255); q_mime := lower(p_qr_mime_type);
    q_size := p_qr_byte_size; q_sha := lower(p_qr_sha256_hex);
  END IF;
  INSERT INTO platform.payment_details_versions (id, organization_id, version_no, details_text, qr_original_filename, qr_mime_type, qr_byte_size,
    qr_sha256_hex, qr_storage_object_name, updated_by_membership_id)
  VALUES (new_id, p_organization_id, next_no, body, q_file, q_mime, q_size, q_sha, q_name, p_membership_id);
  result := jsonb_build_object('organization_id', p_organization_id, 'version_id', new_id, 'version_no', next_no, 'replayed', FALSE);
  INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_membership_id, actor_principal, action, resource_type,
    resource_id, before_state, after_state, reason, request_id)
  VALUES (p_organization_id, 'user', identity.profile_id, p_membership_id, 'auth:' || identity.auth_user_id::TEXT, 'finance.paymentdetails.update',
    'payment_details', new_id,
    CASE WHEN prev.id IS NULL THEN NULL ELSE jsonb_build_object('version_no', prev.version_no, 'has_qr', prev.qr_storage_object_name IS NOT NULL,
      'text_length', char_length(prev.details_text)) END,
    result || jsonb_build_object('has_qr', q_name IS NOT NULL, 'text_length', char_length(body), 'qr_mode', p_qr_mode),
    'Organization payment details updated', platform_private.p3c_request_child_id(p_request_id, 'audit'));
  RETURN result;
END
$$;

-- ---------------------------------------------------------------------------
-- 8) Студент скачивает свой чек и QR реквизитов (расширение 352: тот же вызов, два новых вида).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION platform.student_portal_case_file_target_v1(p_file_kind TEXT, p_file_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE found_row RECORD;
BEGIN
  IF p_file_id IS NULL OR p_file_kind IS NULL OR p_file_kind NOT IN ('contract', 'receipt', 'pending_receipt', 'student_receipt', 'payment_details_qr') THEN
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
  ELSIF p_file_kind = 'student_receipt' THEN
    -- Свой чек, ещё не принятый или отклонённый; принятый скачивается как 'receipt'.
    SELECT f.storage_object_name AS object_name, f.original_filename AS filename INTO found_row FROM platform.student_payment_receipts f
      JOIN platform_private.student_portal_money_case_v1() AS own
      ON own.organization_id = f.organization_id AND own.student_case_id = f.student_case_id
      WHERE f.id = p_file_id AND f.student_membership_id = (SELECT a.membership_id FROM platform.current_actor_authority() a LIMIT 1);
  ELSIF p_file_kind = 'payment_details_qr' THEN
    -- Только QR текущей версии реквизитов своей организации.
    SELECT v.qr_storage_object_name AS object_name, v.qr_original_filename AS filename INTO found_row FROM platform.payment_details_versions v
      WHERE v.id = p_file_id AND v.qr_storage_object_name IS NOT NULL
        AND v.organization_id IN (SELECT own.organization_id FROM platform_private.student_portal_money_case_v1() own)
        AND v.version_no = (SELECT max(w.version_no) FROM platform.payment_details_versions w WHERE w.organization_id = v.organization_id);
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

-- ---------------------------------------------------------------------------
-- 9) Уведомления сотрудников: вид 'student_receipt' (по образцу 'case_message' из 191).
-- ---------------------------------------------------------------------------
ALTER TABLE platform.staff_notifications DROP CONSTRAINT staff_notifications_kind_check;
ALTER TABLE platform.staff_notifications DROP CONSTRAINT staff_notifications_check;
ALTER TABLE platform.staff_notifications
  ADD CONSTRAINT staff_notifications_kind_check CHECK (kind IN (
    'task_assigned', 'task_updated', 'chat_mention', 'case_help',
    'case_task_assigned', 'task_due', 'case_message', 'student_receipt'
  )),
  ADD CONSTRAINT staff_notifications_check CHECK (
    (kind = 'case_help' AND help_request_id IS NOT NULL AND student_case_id IS NOT NULL
      AND message_id IS NULL AND staff_task_id IS NULL AND case_task_id IS NULL)
    OR (kind = 'chat_mention' AND message_id IS NOT NULL
      AND staff_task_id IS NULL AND help_request_id IS NULL AND student_case_id IS NULL AND case_task_id IS NULL)
    OR (kind IN ('task_assigned', 'task_updated') AND staff_task_id IS NOT NULL
      AND message_id IS NULL AND help_request_id IS NULL AND student_case_id IS NULL AND case_task_id IS NULL)
    OR (kind = 'case_task_assigned' AND case_task_id IS NOT NULL AND student_case_id IS NOT NULL
      AND staff_task_id IS NULL AND message_id IS NULL AND help_request_id IS NULL)
    OR (kind = 'task_due' AND help_request_id IS NULL AND message_id IS NULL AND student_case_id IS NULL
      AND ((staff_task_id IS NOT NULL AND case_task_id IS NULL) OR (staff_task_id IS NULL AND case_task_id IS NOT NULL)))
    OR (kind = 'case_message' AND student_case_id IS NOT NULL AND actor_membership_id IS NOT NULL
      AND message_id IS NULL AND staff_task_id IS NULL AND help_request_id IS NULL AND case_task_id IS NULL)
    OR (kind = 'student_receipt' AND student_case_id IS NOT NULL AND actor_membership_id IS NOT NULL
      AND message_id IS NULL AND staff_task_id IS NULL AND help_request_id IS NULL AND case_task_id IS NULL)
  );

-- Видимость: обе формы (с токеном сессии и с явным участником) получают одно дополнительное условие рядом с 'case_message'.
DO $a358_visible$
DECLARE
  v_def TEXT;
  v_from CONSTANT TEXT := 'OR (n.kind = ''case_message'' AND platform_private.staff_can_access(';
BEGIN
  v_def := pg_catalog.pg_get_functiondef('platform_private.staff_notification_visible(platform.staff_notifications)'::regprocedure);
  IF (length(v_def) - length(replace(v_def, v_from, ''))) / length(v_from) <> 1 THEN
    RAISE EXCEPTION 'a358_anchor_drift: staff_notification_visible is not the 191 body' USING ERRCODE = '55000';
  END IF;
  EXECUTE replace(v_def, v_from, 'OR (n.kind = ''student_receipt'' AND platform_private.receipt_staff_can_read(n.organization_id, a.membership_id, n.student_case_id))'
    || E'\n        ' || v_from);
  v_def := pg_catalog.pg_get_functiondef('platform_private.staff_notification_visible_as(platform.staff_notifications,uuid)'::regprocedure);
  IF (length(v_def) - length(replace(v_def, v_from, ''))) / length(v_from) <> 1 THEN
    RAISE EXCEPTION 'a358_anchor_drift: staff_notification_visible_as is not the 351 body' USING ERRCODE = '55000';
  END IF;
  EXECUTE replace(v_def, v_from, 'OR (n.kind = ''student_receipt'' AND platform_private.receipt_staff_can_read(n.organization_id, p_membership_id, n.student_case_id))'
    || E'\n    ' || v_from);
END
$a358_visible$;

-- Лента студента и «отметить прочитанным» узнают новый источник (рядом с чатом, 330): точечная замена с проверкой якорей.
DO $a358_student_feed$
DECLARE
  v_def TEXT;
  v_feed_from CONSTANT TEXT := 'FROM platform_private.own_case_chat_notifications() n';
  v_read_from CONSTANT TEXT := E'SELECT 1 FROM platform_private.own_case_chat_notifications() chat\n        WHERE chat.notification_id = notification.id\n      )';
BEGIN
  v_def := pg_catalog.pg_get_functiondef('platform.student_portal_notifications_v2()'::regprocedure);
  IF (length(v_def) - length(replace(v_def, v_feed_from, ''))) / length(v_feed_from) <> 1 THEN
    RAISE EXCEPTION 'a358_anchor_drift: student_portal_notifications_v2 changed' USING ERRCODE = '55000';
  END IF;
  EXECUTE replace(v_def, v_feed_from, v_feed_from || E'\n    UNION ALL\n    SELECT n.notification_id,n.category,n.event_code,n.subject_label,n.detail,n.due_at,n.created_at,n.read_at\n    FROM platform_private.own_payment_receipt_notifications() n');
  v_def := pg_catalog.pg_get_functiondef('platform.mark_own_student_portal_notification_read_v2(uuid,uuid)'::regprocedure);
  IF (length(v_def) - length(replace(v_def, v_read_from, ''))) / length(v_read_from) <> 1 THEN
    RAISE EXCEPTION 'a358_anchor_drift: mark_own_student_portal_notification_read_v2 changed' USING ERRCODE = '55000';
  END IF;
  EXECUTE replace(v_def, v_read_from, v_read_from || E'\n      OR EXISTS (\n        SELECT 1 FROM platform_private.own_payment_receipt_notifications() receipt\n        WHERE receipt.notification_id = notification.id\n      )');
END
$a358_student_feed$;

-- ---------------------------------------------------------------------------
-- 10) Журнал действий: allowlist (приём 311/356 - переименовать и объединить).
-- ---------------------------------------------------------------------------
ALTER FUNCTION platform_private.p7a_safe_audit_actions() RENAME TO p7a_safe_audit_actions_pre_student_receipts;
CREATE FUNCTION platform_private.p7a_safe_audit_actions()
RETURNS TEXT[] LANGUAGE SQL IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT pg_catalog.array_agg(DISTINCT allowed.action ORDER BY allowed.action)
  FROM pg_catalog.unnest(
    platform_private.p7a_safe_audit_actions_pre_student_receipts()
      || ARRAY[
    'finance.paymentdetails.update',
    'finance.receipt.accept',
    'finance.receipt.reject',
    'finance.receipt.submit'
      ]::TEXT[]
  ) AS allowed(action)
$$;
ALTER FUNCTION platform_private.p7a_safe_audit_resource_types() RENAME TO p7a_safe_audit_resource_types_pre_student_receipts;
CREATE FUNCTION platform_private.p7a_safe_audit_resource_types()
RETURNS TEXT[] LANGUAGE SQL IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT pg_catalog.array_agg(DISTINCT allowed.resource_type ORDER BY allowed.resource_type)
  FROM pg_catalog.unnest(
    platform_private.p7a_safe_audit_resource_types_pre_student_receipts()
      || ARRAY[
    'payment_details',
    'student_payment_receipt'
      ]::TEXT[]
  ) AS allowed(resource_type)
$$;
REVOKE ALL ON FUNCTION
  platform_private.p7a_safe_audit_actions_pre_student_receipts(),
  platform_private.p7a_safe_audit_actions(),
  platform_private.p7a_safe_audit_resource_types_pre_student_receipts(),
  platform_private.p7a_safe_audit_resource_types()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- Права.
-- ---------------------------------------------------------------------------
DO $a358_grants$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'platform.record_student_payment_receipt_v1(uuid,uuid,uuid,uuid,bigint,text,date,text,text,bigint,text,text,uuid)',
    'platform.record_payment_details_v1(uuid,uuid,text,text,text,text,bigint,text,text,uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY[
    'platform.student_portal_payment_center_v1()', 'platform.student_payment_receipt_target_v1(uuid)',
    'platform.staff_payment_receipts_v1(uuid,text,integer)', 'platform.staff_student_receipt_download_target_v1(uuid)',
    'platform.accept_student_payment_receipt_v1(uuid,uuid,uuid,bigint,text,date,uuid,text)',
    'platform.reject_student_payment_receipt_v1(uuid,uuid,text,uuid)', 'platform.staff_payment_details_v1()',
    'platform.staff_payment_details_qr_target_v1(uuid)', 'platform.student_portal_case_file_target_v1(text,uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END
$a358_grants$;

DO $a358_verify$
DECLARE f RECORD;
BEGIN
  FOR f IN SELECT p.oid, p.proname, p.prosecdef, p.proconfig FROM pg_catalog.pg_proc p
    WHERE p.pronamespace = 'platform'::REGNAMESPACE AND p.proname IN ('student_portal_payment_center_v1', 'student_payment_receipt_target_v1',
      'record_student_payment_receipt_v1', 'staff_payment_receipts_v1', 'staff_student_receipt_download_target_v1', 'accept_student_payment_receipt_v1',
      'reject_student_payment_receipt_v1', 'staff_payment_details_v1', 'staff_payment_details_qr_target_v1', 'record_payment_details_v1') LOOP
    IF NOT f.prosecdef OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
      OR has_function_privilege('anon', f.oid, 'EXECUTE') OR has_function_privilege('supabase_auth_admin', f.oid, 'EXECUTE')
      OR has_function_privilege('evo_ai_agent', f.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'a358_verify_function: %', f.proname USING ERRCODE = '55000';
    END IF;
    IF f.proname IN ('record_student_payment_receipt_v1', 'record_payment_details_v1')
      THEN IF has_function_privilege('authenticated', f.oid, 'EXECUTE') OR NOT has_function_privilege('service_role', f.oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'a358_verify_service_grant: %', f.proname USING ERRCODE = '55000'; END IF;
      ELSIF has_function_privilege('service_role', f.oid, 'EXECUTE') OR NOT has_function_privilege('authenticated', f.oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'a358_verify_user_grant: %', f.proname USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF has_table_privilege('authenticated', 'platform.student_payment_receipts', 'SELECT')
    OR has_table_privilege('service_role', 'platform.student_payment_receipts', 'SELECT')
    OR has_table_privilege('authenticated', 'platform.payment_details_versions', 'SELECT')
    OR has_table_privilege('service_role', 'platform.payment_details_versions', 'SELECT') THEN
    RAISE EXCEPTION 'a358_verify_tables' USING ERRCODE = '55000';
  END IF;
  IF NOT ('finance.receipt.accept' = ANY (platform_private.p7a_safe_audit_actions()))
    OR NOT ('student_payment_receipt' = ANY (platform_private.p7a_safe_audit_resource_types()))
    OR cardinality(platform_private.p7a_safe_audit_actions()) <> cardinality(platform_private.p7a_safe_audit_actions_pre_student_receipts()) + 4
    OR cardinality(platform_private.p7a_safe_audit_resource_types()) <> cardinality(platform_private.p7a_safe_audit_resource_types_pre_student_receipts()) + 2
    OR strpos(pg_get_functiondef('platform_private.staff_notification_visible(platform.staff_notifications)'::regprocedure), 'student_receipt') = 0
    OR strpos(pg_get_functiondef('platform_private.staff_notification_visible_as(platform.staff_notifications,uuid)'::regprocedure), 'student_receipt') = 0 THEN
    RAISE EXCEPTION 'a358_verify_allowlist_or_visibility' USING ERRCODE = '55000';
  END IF;
END
$a358_verify$;

COMMENT ON TABLE platform.student_payment_receipts IS
  'Migration 358: a payment receipt the student attached. Status pending (money not counted) -> accepted (a real payment via record_case_payment_v1) or rejected (reason). One transition, never deleted.';
COMMENT ON TABLE platform.payment_details_versions IS
  'Migration 358: organization-wide payment details (text and QR) shown to every student in «Оплата». Append-only versions; the highest version_no is current.';

COMMIT;
