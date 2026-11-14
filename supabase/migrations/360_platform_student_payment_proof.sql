-- 360 «Чек студента к уже принятой оплате» (решение владельца 14.11.2026, ветка izzhackt/student-proof-on-paid-payment).
--
-- Зачем. В 358 студент прикладывает чек как запрос на НОВУЮ оплату: куратор принимает его, и создаётся настоящая оплата
-- (record_case_payment_v1), которая не может превысить остаток платежа. Поэтому оплату, которую сотрудник уже записал и принял без
-- файла (например «600 $ · Принято»), студент не мог подтвердить банковским чеком: «Приложить чек» было только у открытого остатка.
-- Теперь студент прикладывает файл к УЖЕ принятой оплате. Это только доказательство: новой оплаты нет, итоги и статус не меняются,
-- куратор ничего не проверяет. Файл ложится туда же, куда ложатся чеки сотрудников (platform.payment_receipt_files и объект Storage
-- payment-receipts/<организация>/<дело>/…), поэтому строка оплаты в CRM показывает ссылку сама (staff_case_agreement_v1 читает эту таблицу).
--
-- Что добавляется (аддитивно, ничего не удаляется):
--   1) platform.student_payment_proof_target_v1(платёж, ключ повтора, хэш файла) - студент (authenticated): проверка ДО загрузки файла.
--      Оплата (не возврат) дела самого студента (граница 352: student_portal_money_case_v1), обязательство не в архиве, у оплаты ещё нет
--      ни одного файла. Чужая, несуществующая и возвратная оплата - одинаково 42501; файл уже есть - 23505 proof_exists. Если файл есть
--      именно от этого запроса (тот же ключ, студент, оплата и хэш), отвечает прежним результатом (replay): повтор после потерянного ответа
--      не превращается в «файл уже есть» и ничего не загружает; тот же ключ с другим файлом - 23505 request_conflict.
--   2) platform.record_student_payment_proof_v1(...) - только service_role: запись метаданных после загрузки в Storage и антивируса.
--      Повторяет проверки (1) под блокировкой дела (так же блокирует дело загрузка сотрудника, поэтому «файла ещё нет» не обходится
--      гонкой), пишет строку payment_receipt_files с автором-студентом, журнал и уведомление. Повтор по p_request_id безопасен.
--   3) platform_private.notify_student_payment_proof - закрытый помощник: уведомление куратору дела и держателям finance.read.full.
--      Прежний вид staff_notifications.kind = 'student_receipt' (CHECK не меняется), ключ события 'student-proof:<файл>'.
--   4) staff_notifications_page_v2: в строке уведомления «чек к оплате» добавляется признак receipt_proof (от него зависят текст
--      «Студент приложил чек к оплате» и ссылка в CRM). Точечная замена с проверкой якоря; остальные строки страницы не меняются.
--   5) Журнал действий: новое действие finance.receipt.attach (объект - прежний payment_receipt_file), приём 358 (переименовать и объединить).
--
-- Что НЕ меняется: student_portal_payment_center_v1 и его строгие разборщики (идентификатор оплаты уже отдаётся студенту как entry_id
-- записи payment), record_case_payment_v1, итоги и статусы платежей, чеки на проверке (358), загрузка чеков сотрудниками (229).
-- Права: студент добавляет файл ТОЛЬКО к оплате своего дела и только один раз; заменить или убрать файл студент не может (такой команды нет,
-- таблица закрыта для всех ролей API); сотрудник по-прежнему может добавить ещё один файл.
-- Forward-only. Повтор отказывает a360_already_applied, пропавшая опора - a360_anchor_drift.
BEGIN;

DO $a360_anchor$
BEGIN
  IF to_regclass('platform.payment_receipt_files') IS NULL
    OR to_regclass('platform.payment_events') IS NULL
    OR to_regclass('platform.payment_obligations') IS NULL
    OR to_regclass('platform.student_cases') IS NULL
    OR to_regclass('platform.staff_notifications') IS NULL
    OR to_regclass('platform.student_payment_receipts') IS NULL
    OR to_regprocedure('platform.student_payment_receipt_target_v1(uuid)') IS NULL
    OR to_regprocedure('platform.staff_notifications_page_v2(uuid,timestamp with time zone,uuid)') IS NULL
    OR to_regprocedure('platform_private.student_portal_money_case_v1()') IS NULL
    OR to_regprocedure('platform_private.notify_student_receipt(uuid,uuid,uuid,uuid)') IS NULL
    OR to_regprocedure('platform_private.receipt_staff_can_read(uuid,uuid,uuid)') IS NULL
    OR to_regprocedure('platform_private.lock_p2e_request(uuid)') IS NULL
    OR to_regprocedure('platform_private.p3c_request_child_id(uuid,text)') IS NULL
    OR to_regprocedure('platform_private.p7a_safe_audit_actions()') IS NULL
    OR to_regprocedure('platform_private.p7a_safe_audit_resource_types()') IS NULL THEN
    RAISE EXCEPTION 'a360_anchor_drift: the 189 / 229 / 352 / 358 objects this migration builds on are missing' USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('platform.student_payment_proof_target_v1(uuid,uuid,text)') IS NOT NULL
    OR to_regprocedure('platform.record_student_payment_proof_v1(uuid,uuid,uuid,text,text,bigint,text,text,uuid)') IS NOT NULL
    OR to_regprocedure('platform_private.p7a_safe_audit_actions_pre_student_payment_proof()') IS NOT NULL THEN
    RAISE EXCEPTION 'a360_already_applied' USING ERRCODE = '55000';
  END IF;
END
$a360_anchor$;

-- ---------------------------------------------------------------------------
-- 1) Студент: проверка перед загрузкой файла.
-- ---------------------------------------------------------------------------
-- Только оплата (event_type = 'payment') дела самого студента, у которой нет ни одного файла. Чужое, несуществующее и возвраты - 42501
-- (ответ не подсказывает, существует ли чужая оплата). «Файл уже есть» отличим от «нельзя»: страница после этого показывает уже
-- приложенный файл (так бывает, если оплату открыли в двух вкладках или файл приложил сотрудник). Повтор своего же запроса (тот же ключ
-- p_request_id, тот же студент, та же оплата, тот же хэш файла) - не «файл уже есть», а прежний результат: так повтор после потерянного
-- ответа остаётся идемпотентным по ключу, а страница не просит загрузить байты ещё раз.
CREATE FUNCTION platform.student_payment_proof_target_v1(p_payment_event_id UUID, p_request_id UUID DEFAULT NULL, p_sha256_hex TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; picked RECORD; prior platform.audit_events%ROWTYPE; result JSONB;
BEGIN
  SELECT a.* INTO actor FROM platform.current_actor_authority() a WHERE a.platform_role = 'student' LIMIT 1;
  IF NOT FOUND OR p_payment_event_id IS NULL THEN RAISE EXCEPTION 'proof_forbidden' USING ERRCODE = '42501'; END IF;
  SELECT e.organization_id, e.student_case_id, e.id AS payment_event_id, e.payment_obligation_id INTO picked
  FROM platform_private.student_portal_money_case_v1() own
  JOIN platform.payment_events e ON e.organization_id = own.organization_id AND e.student_case_id = own.student_case_id
  JOIN platform.payment_obligations o ON o.organization_id = e.organization_id AND o.id = e.payment_obligation_id
    AND o.student_case_id = e.student_case_id AND o.archived_at IS NULL
  WHERE e.id = p_payment_event_id AND e.event_type = 'payment';
  IF NOT FOUND THEN RAISE EXCEPTION 'proof_forbidden' USING ERRCODE = '42501'; END IF;
  result := jsonb_build_object('organization_id', picked.organization_id, 'student_case_id', picked.student_case_id,
    'student_membership_id', actor.membership_id, 'payment_event_id', picked.payment_event_id,
    'payment_obligation_id', picked.payment_obligation_id);
  IF EXISTS (SELECT 1 FROM platform.payment_receipt_files f
      WHERE f.organization_id = picked.organization_id AND f.payment_event_id = picked.payment_event_id) THEN
    IF p_request_id IS NOT NULL THEN
      SELECT * INTO prior FROM platform.audit_events a WHERE a.request_id = platform_private.p3c_request_child_id(p_request_id, 'audit');
      IF FOUND THEN
        IF prior.action <> 'finance.receipt.attach' OR prior.organization_id <> picked.organization_id
          OR prior.actor_membership_id IS DISTINCT FROM actor.membership_id
          OR prior.after_state ->> 'payment_event_id' IS DISTINCT FROM picked.payment_event_id::TEXT
          OR (p_sha256_hex IS NOT NULL AND prior.after_state ->> 'sha256_hex' IS DISTINCT FROM lower(btrim(p_sha256_hex))) THEN
          RAISE EXCEPTION 'request_conflict' USING ERRCODE = '23505';
        END IF;
        RETURN result || jsonb_build_object('replay', jsonb_build_object('payment_receipt_file_id', prior.resource_id,
          'original_filename', prior.after_state ->> 'original_filename'));
      END IF;
    END IF;
    RAISE EXCEPTION 'proof_exists' USING ERRCODE = '23505';
  END IF;
  RETURN result;
END
$$;

-- ---------------------------------------------------------------------------
-- 2) Уведомление сотрудников: куратору дела и держателям полного чтения финансов (как у чека на проверке, 358).
-- ---------------------------------------------------------------------------
-- Тот же вид 'student_receipt' и те же получатели; отличие - ключ события 'student-proof:<файл>': по нему страница уведомлений
-- (п. 4) отдаёт признак receipt_proof, и CRM пишет «к оплате» и ведёт на оплаты дела, а не в очередь «Чеки на проверке».
CREATE FUNCTION platform_private.notify_student_payment_proof(p_org UUID, p_case UUID, p_file UUID, p_student_membership UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE curator UUID;
BEGIN
  SELECT c.current_curator_membership_id INTO curator FROM platform.student_cases c WHERE c.organization_id = p_org AND c.id = p_case;
  INSERT INTO platform.staff_notifications (organization_id, recipient_membership_id, event_key, kind, student_case_id, actor_membership_id)
  SELECT p_org, m.id, 'student-proof:' || p_file::TEXT, 'student_receipt', p_case, p_student_membership
  FROM platform.organization_memberships m
  JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = p_org AND m.status = 'active' AND p.status = 'active' AND m."current_role" IS DISTINCT FROM 'student'
    AND m.id <> p_student_membership
    AND (m.id = curator OR platform_private.staff_can_access(p_org, m.id, 'finance.read.full', 'organization', p_org))
  ON CONFLICT (organization_id, recipient_membership_id, event_key) DO NOTHING;
END
$$;
REVOKE ALL ON FUNCTION platform_private.notify_student_payment_proof(UUID, UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;

-- ---------------------------------------------------------------------------
-- 3) Сервер: запись метаданных файла после загрузки в Storage и антивируса.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.record_student_payment_proof_v1(
  p_organization_id UUID, p_student_membership_id UUID, p_payment_event_id UUID, p_original_filename TEXT, p_declared_mime_type TEXT,
  p_byte_size BIGINT, p_sha256_hex TEXT, p_storage_object_name TEXT, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE event_row platform.payment_events%ROWTYPE; case_row platform.student_cases%ROWTYPE; prior platform.audit_events%ROWTYPE;
  new_id UUID := gen_random_uuid(); safe_name TEXT; sha TEXT; mime TEXT; student_profile UUID; student_user UUID; audit_request UUID;
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role is required' USING ERRCODE = '42501';
  END IF;
  IF p_organization_id IS NULL OR p_student_membership_id IS NULL OR p_payment_event_id IS NULL OR p_request_id IS NULL
    OR p_original_filename IS NULL OR btrim(p_original_filename) = ''
    OR p_declared_mime_type IS NULL OR lower(btrim(p_declared_mime_type)) NOT IN ('application/pdf', 'image/jpeg', 'image/png')
    OR p_byte_size IS NULL OR p_byte_size NOT BETWEEN 1 AND 26214400
    OR p_sha256_hex IS NULL OR lower(btrim(p_sha256_hex)) !~ '^[0-9a-f]{64}$'
    OR p_storage_object_name IS NULL OR btrim(p_storage_object_name) = '' OR char_length(btrim(p_storage_object_name)) > 512 THEN
    RAISE EXCEPTION 'proof_invalid' USING ERRCODE = '22023';
  END IF;
  sha := lower(btrim(p_sha256_hex));
  mime := lower(btrim(p_declared_mime_type));
  -- Имя файла идёт на страницу студента, в CRM и в журнал: управляющие знаки убираются, длина - по символам (не по байтам).
  safe_name := left(btrim(regexp_replace(p_original_filename, E'[\\x01-\\x1f\\x7f]', '', 'g')), 255);
  IF safe_name = '' THEN safe_name := 'file'; END IF;
  audit_request := platform_private.p3c_request_child_id(p_request_id, 'audit');
  PERFORM platform_private.lock_p2e_request(p_request_id);
  -- Повтор того же запроса: тот же студент, оплата и файл - прежний ответ; чужой запрос под тем же ключом - конфликт.
  SELECT * INTO prior FROM platform.audit_events a WHERE a.request_id = audit_request;
  IF FOUND THEN
    IF prior.action <> 'finance.receipt.attach' OR prior.organization_id <> p_organization_id
      OR prior.actor_membership_id IS DISTINCT FROM p_student_membership_id
      OR prior.after_state ->> 'payment_event_id' IS DISTINCT FROM p_payment_event_id::TEXT
      OR prior.after_state ->> 'sha256_hex' IS DISTINCT FROM sha THEN
      RAISE EXCEPTION 'request_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('organization_id', p_organization_id, 'payment_event_id', p_payment_event_id,
      'payment_receipt_file_id', prior.resource_id, 'original_filename', prior.after_state ->> 'original_filename', 'replayed', TRUE);
  END IF;
  -- Оплата (не возврат) существует.
  SELECT * INTO event_row FROM platform.payment_events e
    WHERE e.organization_id = p_organization_id AND e.id = p_payment_event_id AND e.event_type = 'payment';
  IF NOT FOUND THEN RAISE EXCEPTION 'proof_forbidden' USING ERRCODE = '42501'; END IF;
  -- Дело принадлежит именно этому студенту, активно, кабинет открыт, студент - участник организации. Дело блокируется так же, как его блокирует
  -- загрузка чека сотрудником (record_payment_receipt_file_metadata): «у оплаты ещё нет файла» проверяется уже без гонки.
  SELECT c.* INTO case_row FROM platform.student_cases c
  JOIN platform.organization_memberships m ON m.organization_id = c.organization_id AND m.id = c.student_membership_id
  WHERE c.organization_id = p_organization_id AND c.id = event_row.student_case_id AND c.student_membership_id = p_student_membership_id
    AND c.state IN ('active', 'closed') AND c.portal_activated_at IS NOT NULL AND m.status = 'active' AND m."current_role" = 'student'
  FOR UPDATE OF c;
  IF NOT FOUND THEN RAISE EXCEPTION 'proof_forbidden' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM platform.payment_obligations o WHERE o.organization_id = p_organization_id AND o.id = event_row.payment_obligation_id
      AND o.student_case_id = event_row.student_case_id AND o.archived_at IS NULL) THEN
    RAISE EXCEPTION 'proof_forbidden' USING ERRCODE = '42501';
  END IF;
  -- Путь файла лежит в папке дела этой оплаты (проверяется после принадлежности: чужая оплата отвечает 42501, а не формой пути).
  IF btrim(p_storage_object_name) NOT LIKE 'payment-receipts/' || p_organization_id::TEXT || '/' || event_row.student_case_id::TEXT || '/%' THEN
    RAISE EXCEPTION 'proof_invalid' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM platform.payment_receipt_files f WHERE f.organization_id = p_organization_id AND f.payment_event_id = event_row.id) THEN
    RAISE EXCEPTION 'proof_exists' USING ERRCODE = '23505';
  END IF;
  -- Только строка файла. payment_events и total_paid_minor этой командой не трогаются: деньги и статус остаются прежними.
  INSERT INTO platform.payment_receipt_files (id, organization_id, student_case_id, payment_obligation_id, payment_event_id, original_filename,
    declared_mime_type, byte_size, sha256_hex, storage_object_name, uploaded_by_membership_id)
  VALUES (new_id, p_organization_id, event_row.student_case_id, event_row.payment_obligation_id, event_row.id, safe_name, mime, p_byte_size, sha,
    btrim(p_storage_object_name), p_student_membership_id);
  SELECT pr.id, pr.auth_user_id INTO student_profile, student_user FROM platform.organization_memberships m
    JOIN platform.profiles pr ON pr.id = m.profile_id WHERE m.organization_id = p_organization_id AND m.id = p_student_membership_id;
  INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_membership_id, actor_principal, action, resource_type,
    resource_id, before_state, after_state, reason, request_id)
  VALUES (p_organization_id, 'user', student_profile, p_student_membership_id, 'auth:' || student_user::TEXT, 'finance.receipt.attach',
    'payment_receipt_file', new_id, NULL,
    jsonb_build_object('payment_receipt_file_id', new_id, 'payment_event_id', event_row.id, 'payment_obligation_id', event_row.payment_obligation_id,
      'student_case_id', event_row.student_case_id, 'original_filename', safe_name, 'sha256_hex', sha),
    'Student attached a receipt to a recorded payment', audit_request);
  PERFORM platform_private.notify_student_payment_proof(p_organization_id, event_row.student_case_id, new_id, p_student_membership_id);
  RETURN jsonb_build_object('organization_id', p_organization_id, 'payment_event_id', event_row.id, 'payment_receipt_file_id', new_id,
    'original_filename', safe_name, 'replayed', FALSE);
END
$$;

-- ---------------------------------------------------------------------------
-- 4) Страница уведомлений сотрудника: признак «чек к оплате».
-- ---------------------------------------------------------------------------
-- Только строки вида 'student_receipt' с ключом 'student-proof:…' получают ещё одно поле; остальные строки страницы остаются прежними.
DO $a360_page$
DECLARE
  v_def TEXT;
  v_from CONSTANT TEXT := E'      ) AS item\n    FROM platform.staff_notifications n\n    LEFT JOIN platform.team_chat_messages m ON m.id = n.message_id';
  v_to CONSTANT TEXT := E'      ) || CASE WHEN n.kind = ''student_receipt'' AND n.event_key LIKE ''student-proof:%'' THEN jsonb_build_object(''receipt_proof'', TRUE)\n'
    || E'        ELSE ''{}''::JSONB END AS item\n    FROM platform.staff_notifications n\n    LEFT JOIN platform.team_chat_messages m ON m.id = n.message_id';
BEGIN
  v_def := pg_catalog.pg_get_functiondef('platform.staff_notifications_page_v2(uuid,timestamp with time zone,uuid)'::regprocedure);
  IF (length(v_def) - length(replace(v_def, v_from, ''))) / length(v_from) <> 1 THEN
    RAISE EXCEPTION 'a360_anchor_drift: staff_notifications_page_v2 is not the 188 / 351 body' USING ERRCODE = '55000';
  END IF;
  EXECUTE replace(v_def, v_from, v_to);
END
$a360_page$;

-- ---------------------------------------------------------------------------
-- 5) Журнал действий: allowlist (приём 311/356/358 - переименовать и объединить). Тип объекта payment_receipt_file уже есть (229/230).
-- ---------------------------------------------------------------------------
ALTER FUNCTION platform_private.p7a_safe_audit_actions() RENAME TO p7a_safe_audit_actions_pre_student_payment_proof;
CREATE FUNCTION platform_private.p7a_safe_audit_actions()
RETURNS TEXT[] LANGUAGE SQL IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT pg_catalog.array_agg(DISTINCT allowed.action ORDER BY allowed.action)
  FROM pg_catalog.unnest(
    platform_private.p7a_safe_audit_actions_pre_student_payment_proof()
      || ARRAY[
    'finance.receipt.attach'
      ]::TEXT[]
  ) AS allowed(action)
$$;
REVOKE ALL ON FUNCTION
  platform_private.p7a_safe_audit_actions_pre_student_payment_proof(),
  platform_private.p7a_safe_audit_actions()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- Права.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION platform.record_student_payment_proof_v1(uuid, uuid, uuid, text, text, bigint, text, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
GRANT EXECUTE ON FUNCTION platform.record_student_payment_proof_v1(uuid, uuid, uuid, text, text, bigint, text, text, uuid) TO service_role;
REVOKE ALL ON FUNCTION platform.student_payment_proof_target_v1(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
GRANT EXECUTE ON FUNCTION platform.student_payment_proof_target_v1(uuid, uuid, text) TO authenticated;

DO $a360_verify$
DECLARE f RECORD;
BEGIN
  FOR f IN SELECT p.oid, p.proname, p.prosecdef, p.proconfig FROM pg_catalog.pg_proc p
    WHERE p.pronamespace = 'platform'::REGNAMESPACE AND p.proname IN ('student_payment_proof_target_v1', 'record_student_payment_proof_v1') LOOP
    IF NOT f.prosecdef OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
      OR has_function_privilege('anon', f.oid, 'EXECUTE') OR has_function_privilege('supabase_auth_admin', f.oid, 'EXECUTE')
      OR has_function_privilege('evo_ai_agent', f.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'a360_verify_function: %', f.proname USING ERRCODE = '55000';
    END IF;
    IF f.proname = 'record_student_payment_proof_v1'
      THEN IF has_function_privilege('authenticated', f.oid, 'EXECUTE') OR NOT has_function_privilege('service_role', f.oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'a360_verify_service_grant: %', f.proname USING ERRCODE = '55000'; END IF;
      ELSIF has_function_privilege('service_role', f.oid, 'EXECUTE') OR NOT has_function_privilege('authenticated', f.oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'a360_verify_user_grant: %', f.proname USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE
      AND p.proname IN ('student_payment_proof_target_v1', 'record_student_payment_proof_v1')) <> 2 THEN
    RAISE EXCEPTION 'a360_verify_function: both functions must exist' USING ERRCODE = '55000';
  END IF;
  IF has_function_privilege('authenticated', 'platform_private.notify_student_payment_proof(uuid,uuid,uuid,uuid)'::regprocedure, 'EXECUTE')
    OR has_function_privilege('service_role', 'platform_private.notify_student_payment_proof(uuid,uuid,uuid,uuid)'::regprocedure, 'EXECUTE')
    OR has_function_privilege('anon', 'platform_private.notify_student_payment_proof(uuid,uuid,uuid,uuid)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'a360_verify_helper_open' USING ERRCODE = '55000';
  END IF;
  IF NOT ('finance.receipt.attach' = ANY (platform_private.p7a_safe_audit_actions()))
    OR 'finance.receipt.attach' = ANY (platform_private.p7a_safe_audit_actions_pre_student_payment_proof())
    OR cardinality(platform_private.p7a_safe_audit_actions()) <> cardinality(platform_private.p7a_safe_audit_actions_pre_student_payment_proof()) + 1
    OR NOT ('payment_receipt_file' = ANY (platform_private.p7a_safe_audit_resource_types()))
    OR (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE AND p.proname = 'staff_notifications_page_v2'
        AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[] AND p.prosrc LIKE '%receipt_proof%') <> 1
    OR NOT has_function_privilege('authenticated', 'platform.staff_notifications_page_v2(uuid,timestamp with time zone,uuid)'::regprocedure, 'EXECUTE')
    OR has_function_privilege('anon', 'platform.staff_notifications_page_v2(uuid,timestamp with time zone,uuid)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'a360_verify_allowlist_or_page' USING ERRCODE = '55000';
  END IF;
  IF has_table_privilege('authenticated', 'platform.payment_receipt_files', 'INSERT') OR has_table_privilege('service_role', 'platform.payment_receipt_files', 'INSERT')
    OR has_table_privilege('authenticated', 'platform.payment_receipt_files', 'UPDATE') OR has_table_privilege('authenticated', 'platform.payment_receipt_files', 'DELETE') THEN
    RAISE EXCEPTION 'a360_verify_files_table_open' USING ERRCODE = '55000';
  END IF;
END
$a360_verify$;

COMMENT ON FUNCTION platform.record_student_payment_proof_v1(uuid, uuid, uuid, text, text, bigint, text, text, uuid) IS
  'Migration 360: the Student attaches a receipt FILE to an already recorded payment. Proof only: one payment_receipt_files row, no new payment, no change of totals. One file per payment, never replaced by the Student. Service role only.';

COMMIT;
