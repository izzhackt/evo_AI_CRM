-- 333 «ИИ раскладывает файлы из amoCRM по чек-листу, куратор подтверждает» (решение владельца 06.11.2026).
--
-- Зачем. Файлы, импортированные из amoCRM, лежат в группе «Из amoCRM (не разобрано)» по одному пункту на файл
-- («Файл amoCRM: <uuid>.png»), все «На проверке». Куратор открывает каждый, чтобы понять, что это. Здесь хранится только
-- ПОДСКАЗКА ИИ (что за документ и с какой уверенностью) и отдельно РЕШЕНИЕ куратора. Сам перенос в пункт чек-листа и
-- одобрение делают существующие команды: change_document_slot_metadata (108) и review_document_version (068/328).
--
-- Что добавляется (одна аддитивная миграция, ничего не заменяется и не удаляется):
--   1) platform_private.document_classification_suggestions: ОДНА строка на (организация, версия файла, политика). Пишет только
--      пакетная команда (service_role). Строка с итогом suggested/unsure неизменна; строка failed может быть переписана
--      повтором (attempts+1, не больше 3). Подсказка никогда не перезаписывает решение куратора и не двоится при повторе.
--   2) platform_private.document_classification_resolutions: решение куратора отдельно от подсказки. Одна строка на версию.
--   3) Согласие и обработка данных (критично): ничего не уходит ИИ, если platform_private.ai_agent_student_ai_allowed(...)
--      (миграция 320) говорит false: студент отказал, либо у него есть кабинет и он не решил на действующей версии политики.
--      Проверка стоит в ТРЁХ местах: выбор кандидатов, запись результата (повторно, перед записью) и чтение подсказок
--      куратором. Правило одно на все ИИ-пути, свой список «разрешённых» здесь не заводится.
--   4) Команды (service_role): document_classification_plan_v1 (счётчики, пробный прогон, файлов не читает),
--      document_classification_context_v1 (настройка провайдера и остаток дневного бюджета),
--      document_classification_candidates_v1 (порция кандидатов), document_classification_record_v1 (запись результата).
--   5) Команды сотрудника (authenticated): staff_document_suggestions_v1 (чтение подсказок по делу; право case.read.full и
--      document.read.full на дело; чтение не шире, чем у вкладки «Документы») и staff_resolve_document_suggestion_v1
--      (запись решения; право document.manage на дело, как у переименования пункта).
--
-- Бюджет: общий дневной потолок распознавания (platform_private.document_recognition_configs.config.dailyOrgBudgetMicros)
-- делится с очередью 162: остаток = потолок - зарезервированное заданиями за сутки (UTC) - потрачено подсказками за сутки.
-- Секреты сюда не попадают: ключ провайдера берёт пакетная команда из окружения (EVO_PLATFORM_GEMINI_API_KEY).
--
-- Forward-only. Повтор отказывает a333_already_applied, пропавшая опора - a333_anchor_drift.
BEGIN;

DO $a333_anchor$
BEGIN
  IF to_regprocedure('platform_private.ai_agent_student_ai_allowed(uuid,uuid)') IS NULL
    OR to_regprocedure('platform_private.student_case_ai_consent(uuid,uuid)') IS NULL
    OR to_regprocedure('platform_private.student_ai_consent_policy_version()') IS NULL
    OR to_regprocedure('platform_private.document_recognition_source(uuid,uuid,uuid)') IS NULL
    OR to_regprocedure('platform_private.require_p2g_service()') IS NULL
    OR to_regprocedure('platform_private.require_case_operator(uuid,uuid,text)') IS NULL
    OR to_regprocedure('platform_private.staff_can_access(uuid,uuid,text,text,uuid)') IS NULL
    OR to_regprocedure('platform_private.block_append_only_mutation()') IS NULL
    OR to_regprocedure('platform.current_actor_authority()') IS NULL
    OR to_regclass('platform_private.document_recognition_configs') IS NULL
    OR to_regclass('platform_private.document_recognition_jobs') IS NULL
    OR to_regclass('platform_private.document_storage_bindings') IS NULL
    OR to_regclass('platform.document_slots') IS NULL
    OR to_regclass('platform.document_versions') IS NULL THEN
    RAISE EXCEPTION 'a333_anchor_drift: the 162 / 320 / 108 objects this migration builds on are missing' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('platform_private.document_classification_suggestions') IS NOT NULL
    OR to_regprocedure('platform.document_classification_plan_v1(uuid,boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'a333_already_applied' USING ERRCODE = '55000';
  END IF;
END
$a333_anchor$;

-- ---------------------------------------------------------------------------
-- 1. Подсказка ИИ.
-- ---------------------------------------------------------------------------
CREATE TABLE platform_private.document_classification_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  student_case_id UUID NOT NULL,
  document_slot_id UUID NOT NULL,
  document_version_id UUID NOT NULL,
  policy_version TEXT NOT NULL CHECK (policy_version ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$'),
  status TEXT NOT NULL CHECK (status IN ('suggested', 'unsure', 'failed')),
  kind_key TEXT CHECK (kind_key IS NULL OR kind_key IN ('passport', 'attestat', 'transcript', 'photo', 'medical',
    'police_certificate', 'bank_statement', 'motivation_letter', 'language_certificate', 'birth_certificate',
    'recommendation_letter', 'application_form', 'payment_receipt', 'other')),
  confidence NUMERIC(4, 3) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  model TEXT CHECK (model IS NULL OR model ~ '^gemini-[a-z0-9][a-z0-9.-]{0,100}$'),
  provider_project_id TEXT CHECK (provider_project_id IS NULL OR provider_project_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
  config_version TEXT CHECK (config_version IS NULL OR config_version ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
  input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  cost_micros BIGINT NOT NULL DEFAULT 0 CHECK (cost_micros >= 0),
  failure_code TEXT CHECK (failure_code IS NULL OR failure_code IN ('provider_rejected', 'provider_unavailable', 'invalid_result',
    'source_unavailable', 'document_not_eligible', 'too_large', 'budget_exhausted')),
  attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts BETWEEN 1 AND 3),
  run_id TEXT NOT NULL CHECK (run_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT document_classification_suggestions_version_key UNIQUE (organization_id, document_version_id, policy_version),
  CONSTRAINT document_classification_suggestions_shape_check CHECK (
    (status IN ('suggested', 'unsure') AND kind_key IS NOT NULL AND confidence IS NOT NULL AND failure_code IS NULL)
    OR (status = 'failed' AND kind_key IS NULL AND confidence IS NULL AND failure_code IS NOT NULL)),
  CONSTRAINT document_classification_suggestions_version_fkey FOREIGN KEY (organization_id, document_version_id, student_case_id,
    document_slot_id) REFERENCES platform.document_versions (organization_id, id, student_case_id, document_slot_id) ON DELETE RESTRICT
);
CREATE INDEX document_classification_suggestions_day_idx
  ON platform_private.document_classification_suggestions (organization_id, created_at);

-- Итог suggested/unsure не меняется никогда. failed переписывается только повтором: attempts растёт, версия и дело те же.
CREATE FUNCTION platform_private.document_classification_suggestion_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.status <> 'failed' OR NEW.attempts <> OLD.attempts + 1
    OR NEW.organization_id <> OLD.organization_id OR NEW.student_case_id <> OLD.student_case_id
    OR NEW.document_slot_id <> OLD.document_slot_id OR NEW.document_version_id <> OLD.document_version_id
    OR NEW.policy_version <> OLD.policy_version THEN
    RAISE EXCEPTION 'document_classification_suggestion_immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER document_classification_suggestions_update_guard BEFORE UPDATE ON platform_private.document_classification_suggestions
  FOR EACH ROW EXECUTE FUNCTION platform_private.document_classification_suggestion_guard();
CREATE TRIGGER document_classification_suggestions_no_delete BEFORE DELETE ON platform_private.document_classification_suggestions
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER document_classification_suggestions_no_truncate BEFORE TRUNCATE ON platform_private.document_classification_suggestions
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();

-- ---------------------------------------------------------------------------
-- 2. Решение куратора: отдельно от подсказки, одна строка на версию, только добавление.
-- ---------------------------------------------------------------------------
CREATE TABLE platform_private.document_classification_resolutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  student_case_id UUID NOT NULL,
  document_slot_id UUID NOT NULL,
  document_version_id UUID NOT NULL,
  suggestion_id UUID REFERENCES platform_private.document_classification_suggestions(id) ON DELETE RESTRICT,
  chosen_kind_key TEXT NOT NULL CHECK (chosen_kind_key IN ('passport', 'attestat', 'transcript', 'photo', 'medical',
    'police_certificate', 'bank_statement', 'motivation_letter', 'language_certificate', 'birth_certificate',
    'recommendation_letter', 'application_form', 'payment_receipt')),
  resolution TEXT NOT NULL CHECK (resolution IN ('accepted_suggestion', 'corrected', 'chosen_without_suggestion')),
  resolved_by_membership_id UUID NOT NULL,
  request_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT document_classification_resolutions_version_key UNIQUE (organization_id, document_version_id),
  CONSTRAINT document_classification_resolutions_shape_check CHECK ((resolution = 'chosen_without_suggestion') = (suggestion_id IS NULL)),
  CONSTRAINT document_classification_resolutions_version_fkey FOREIGN KEY (organization_id, document_version_id, student_case_id,
    document_slot_id) REFERENCES platform.document_versions (organization_id, id, student_case_id, document_slot_id) ON DELETE RESTRICT,
  CONSTRAINT document_classification_resolutions_member_fkey FOREIGN KEY (organization_id, resolved_by_membership_id)
    REFERENCES platform.organization_memberships (organization_id, id) ON DELETE RESTRICT
);
CREATE TRIGGER document_classification_resolutions_no_update BEFORE UPDATE ON platform_private.document_classification_resolutions
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER document_classification_resolutions_no_delete BEFORE DELETE ON platform_private.document_classification_resolutions
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER document_classification_resolutions_no_truncate BEFORE TRUNCATE ON platform_private.document_classification_resolutions
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();

DO $a333_tables$
DECLARE t REGCLASS;
BEGIN
  FOREACH t IN ARRAY ARRAY['platform_private.document_classification_suggestions'::REGCLASS,
    'platform_private.document_classification_resolutions'::REGCLASS] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent', t);
  END LOOP;
END
$a333_tables$;

-- ---------------------------------------------------------------------------
-- 3. Помощники (без грантов).
-- ---------------------------------------------------------------------------
-- Неразобранный файл: активное дело, активный пользовательский пункт группы «Из amoCRM…», «На проверке», у пункта текущая версия.
-- eligible: версия читается тем же предикатом, что очередь 162 (проверка целостности, чистый скан, формат, размер).
CREATE FUNCTION platform_private.doc_class_unsorted(p_organization_id UUID, p_student_case_id UUID DEFAULT NULL)
RETURNS TABLE (student_case_id UUID, document_slot_id UUID, document_version_id UUID, sha256_hex TEXT, byte_size BIGINT,
  mime_type TEXT, bucket_id TEXT, object_name TEXT, eligible BOOLEAN, ai_allowed BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT s.student_case_id, s.id, v.id, v.sha256_hex, v.byte_size, v.declared_mime_type, b.bucket_id, b.object_name,
    EXISTS (SELECT 1 FROM platform_private.document_recognition_source(s.organization_id, s.student_case_id, v.id)),
    platform_private.ai_agent_student_ai_allowed(s.organization_id, s.student_case_id)
  FROM platform.document_slots s
  JOIN platform.student_cases c ON c.organization_id = s.organization_id AND c.id = s.student_case_id AND c.state = 'active'
  JOIN platform.document_versions v ON v.organization_id = s.organization_id AND v.student_case_id = s.student_case_id
    AND v.document_slot_id = s.id AND v.id = s.current_version_id
  LEFT JOIN platform_private.document_storage_bindings b ON b.organization_id = v.organization_id
    AND b.student_case_id = v.student_case_id AND b.document_slot_id = v.document_slot_id AND b.document_version_id = v.id
  WHERE s.organization_id = p_organization_id
    AND (p_student_case_id IS NULL OR s.student_case_id = p_student_case_id)
    AND s.removed_at IS NULL AND s.intent_kind = 'custom' AND s.status = 'submitted'
    AND s.group_label ~* '^[[:space:]]*Из amoCRM'
    AND NOT EXISTS (SELECT 1 FROM platform_private.document_classification_resolutions r
      WHERE r.organization_id = s.organization_id AND r.document_version_id = v.id)
$$;

-- Слово для отчёта о покрытии: только объясняет решение ai_agent_student_ai_allowed, само не решает.
CREATE FUNCTION platform_private.doc_class_consent_band(p_organization_id UUID, p_student_case_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN c.status = 'declined' THEN 'declined'
    WHEN c.status = 'granted' AND c.policy_version = platform_private.student_ai_consent_policy_version() THEN 'granted'
    WHEN c.has_portal THEN 'undecided' ELSE 'no_portal' END
  FROM platform_private.student_case_ai_consent(p_organization_id, p_student_case_id) c
$$;

-- Версия уже обработана: подсказка с итогом или три неудачных попытки.
CREATE FUNCTION platform_private.doc_class_done(p_organization_id UUID, p_version_id UUID, p_policy TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM platform_private.document_classification_suggestions g
    WHERE g.organization_id = p_organization_id AND g.document_version_id = p_version_id AND g.policy_version = p_policy
      AND (g.status IN ('suggested', 'unsure') OR g.attempts >= 3))
$$;

DO $a333_helpers$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY['platform_private.doc_class_unsorted(uuid,uuid)', 'platform_private.doc_class_consent_band(uuid,uuid)',
    'platform_private.doc_class_done(uuid,uuid,text)', 'platform_private.document_classification_suggestion_guard()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin', f);
  END LOOP;
END
$a333_helpers$;

-- ---------------------------------------------------------------------------
-- 4. Пакетные команды (service_role).
-- ---------------------------------------------------------------------------
-- Пробный прогон: только числа, ни одного идентификатора дела и ни одного чтения файла.
CREATE FUNCTION platform.document_classification_plan_v1(p_organization_id UUID, p_only_explicit_consent BOOLEAN DEFAULT FALSE)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r JSONB;
BEGIN
  PERFORM platform_private.require_p2g_service();
  IF p_organization_id IS NULL OR p_only_explicit_consent IS NULL THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  WITH u AS (
    SELECT x.student_case_id, x.document_version_id, x.eligible, x.ai_allowed,
      platform_private.doc_class_consent_band(p_organization_id, x.student_case_id) AS band,
      platform_private.doc_class_done(p_organization_id, x.document_version_id, 'doc-kind-v1') AS done
    FROM platform_private.doc_class_unsorted(p_organization_id) x
  ), p AS (
    SELECT u.*, (u.ai_allowed AND (NOT p_only_explicit_consent OR u.band = 'granted')) AS ai_path FROM u
  )
  SELECT jsonb_build_object(
    'unsorted_files', (SELECT count(*) FROM p),
    'unsorted_students', (SELECT count(DISTINCT student_case_id) FROM p),
    'ai_path_files', (SELECT count(*) FROM p WHERE ai_path),
    'ai_path_students', (SELECT count(DISTINCT student_case_id) FROM p WHERE ai_path),
    'ai_path_students_granted', (SELECT count(DISTINCT student_case_id) FROM p WHERE ai_path AND band = 'granted'),
    'ai_path_students_no_portal', (SELECT count(DISTINCT student_case_id) FROM p WHERE ai_path AND band = 'no_portal'),
    'manual_path_files', (SELECT count(*) FROM p WHERE NOT ai_path),
    'manual_path_students', (SELECT count(DISTINCT student_case_id) FROM p WHERE NOT ai_path),
    'manual_students_declined', (SELECT count(DISTINCT student_case_id) FROM p WHERE NOT ai_path AND band = 'declined'),
    'manual_students_undecided', (SELECT count(DISTINCT student_case_id) FROM p WHERE NOT ai_path AND band = 'undecided'),
    'manual_students_policy_filter', (SELECT count(DISTINCT student_case_id) FROM p WHERE NOT ai_path AND band IN ('granted', 'no_portal')),
    'already_classified_files', (SELECT count(*) FROM p WHERE ai_path AND done),
    'not_readable_files', (SELECT count(*) FROM p WHERE ai_path AND NOT done AND NOT eligible),
    'to_classify_files', (SELECT count(*) FROM p WHERE ai_path AND NOT done AND eligible),
    'to_classify_students', (SELECT count(DISTINCT student_case_id) FROM p WHERE ai_path AND NOT done AND eligible)
  ) INTO r;
  RETURN r;
END
$$;

-- Настройка провайдера (та же строка, что у очереди 162) и остаток дневного бюджета. Ключа здесь нет.
CREATE FUNCTION platform.document_classification_context_v1(p_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE cfg platform_private.document_recognition_configs%ROWTYPE; v_reserved NUMERIC; v_spent NUMERIC; v_day DATE := (statement_timestamp() AT TIME ZONE 'UTC')::DATE;
BEGIN
  PERFORM platform_private.require_p2g_service();
  IF p_organization_id IS NULL THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023'; END IF;
  SELECT * INTO cfg FROM platform_private.document_recognition_configs WHERE organization_id = p_organization_id AND enabled;
  IF NOT FOUND THEN RAISE EXCEPTION 'provider_not_configured' USING ERRCODE = '55000'; END IF;
  SELECT COALESCE(sum(reserved_cost_micros), 0) INTO v_reserved FROM platform_private.document_recognition_jobs
    WHERE organization_id = p_organization_id AND reservation_day = v_day AND reservation_released_at IS NULL;
  SELECT COALESCE(sum(cost_micros), 0) INTO v_spent FROM platform_private.document_classification_suggestions
    WHERE organization_id = p_organization_id AND (created_at AT TIME ZONE 'UTC')::DATE = v_day;
  RETURN jsonb_build_object('config', cfg.config,
    'budget_left_micros', GREATEST(0, (cfg.config->>'dailyOrgBudgetMicros')::NUMERIC - v_reserved - v_spent)::BIGINT);
END
$$;

-- Порция кандидатов: согласие проверяется здесь (первое из трёх мест), уже обработанное и решённое не возвращается.
CREATE FUNCTION platform.document_classification_candidates_v1(p_organization_id UUID, p_limit INTEGER, p_only_explicit_consent BOOLEAN,
  p_run_id TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r JSONB;
BEGIN
  PERFORM platform_private.require_p2g_service();
  IF p_organization_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 OR p_only_explicit_consent IS NULL
    OR p_run_id IS NULL OR p_run_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$' THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('student_case_id', t.student_case_id, 'document_slot_id', t.document_slot_id,
    'document_version_id', t.document_version_id, 'sha256', t.sha256_hex, 'bytes', t.byte_size, 'mime', t.mime_type,
    'bucket_id', t.bucket_id, 'object_name', t.object_name,
    'attempts', COALESCE((SELECT g.attempts FROM platform_private.document_classification_suggestions g
      WHERE g.organization_id = p_organization_id AND g.document_version_id = t.document_version_id AND g.policy_version = 'doc-kind-v1'), 0))
    ORDER BY t.ord), '[]'::JSONB) INTO r
  FROM (
    SELECT x.*, row_number() OVER (ORDER BY x.student_case_id, x.document_version_id) AS ord
    FROM platform_private.doc_class_unsorted(p_organization_id) x
    WHERE x.eligible AND x.ai_allowed AND x.bucket_id = 'platform-documents' AND x.object_name IS NOT NULL
      AND (NOT p_only_explicit_consent OR platform_private.doc_class_consent_band(p_organization_id, x.student_case_id) = 'granted')
      AND NOT platform_private.doc_class_done(p_organization_id, x.document_version_id, 'doc-kind-v1')
      -- Неудача этого же прогона не возвращается в нём снова: повтор - следующим запуском (до трёх попыток всего).
      AND NOT EXISTS (SELECT 1 FROM platform_private.document_classification_suggestions f WHERE f.organization_id = p_organization_id
        AND f.document_version_id = x.document_version_id AND f.policy_version = 'doc-kind-v1' AND f.run_id = p_run_id)
    ORDER BY x.student_case_id, x.document_version_id LIMIT p_limit
  ) t;
  RETURN r;
END
$$;

-- Запись результата: согласие и «ещё неразобранный» проверяются заново (второе место). Повтор не двоит и не перезаписывает.
CREATE FUNCTION platform.document_classification_record_v1(p_organization_id UUID, p_document_version_id UUID, p_status TEXT,
  p_kind_key TEXT, p_confidence NUMERIC, p_model TEXT, p_provider_project_id TEXT, p_config_version TEXT,
  p_input_tokens INTEGER, p_output_tokens INTEGER, p_cost_micros BIGINT, p_failure_code TEXT, p_run_id TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE u RECORD; g platform_private.document_classification_suggestions%ROWTYPE;
BEGIN
  PERFORM platform_private.require_p2g_service();
  IF p_organization_id IS NULL OR p_document_version_id IS NULL OR p_status IS NULL OR p_status NOT IN ('suggested', 'unsure', 'failed')
    OR p_run_id IS NULL OR p_cost_micros IS NULL OR p_cost_micros < 0 THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO u FROM platform_private.doc_class_unsorted(p_organization_id) x WHERE x.document_version_id = p_document_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_candidate' USING ERRCODE = '22023'; END IF;
  IF NOT u.ai_allowed THEN RAISE EXCEPTION 'ai_consent_missing' USING ERRCODE = '42501'; END IF;
  SELECT * INTO g FROM platform_private.document_classification_suggestions
    WHERE organization_id = p_organization_id AND document_version_id = p_document_version_id AND policy_version = 'doc-kind-v1' FOR UPDATE;
  IF FOUND THEN
    IF g.status IN ('suggested', 'unsure') OR g.attempts >= 3 THEN
      RETURN jsonb_build_object('recorded', FALSE, 'reason', 'exists');
    END IF;
    UPDATE platform_private.document_classification_suggestions SET status = p_status, kind_key = p_kind_key, confidence = p_confidence,
      model = p_model, provider_project_id = p_provider_project_id, config_version = p_config_version, input_tokens = p_input_tokens,
      output_tokens = p_output_tokens, cost_micros = g.cost_micros + p_cost_micros, failure_code = p_failure_code, attempts = g.attempts + 1,
      run_id = p_run_id, updated_at = statement_timestamp() WHERE id = g.id;
    RETURN jsonb_build_object('recorded', TRUE, 'reason', 'retried');
  END IF;
  INSERT INTO platform_private.document_classification_suggestions (organization_id, student_case_id, document_slot_id, document_version_id,
    policy_version, status, kind_key, confidence, model, provider_project_id, config_version, input_tokens, output_tokens, cost_micros,
    failure_code, run_id)
  VALUES (p_organization_id, u.student_case_id, u.document_slot_id, u.document_version_id, 'doc-kind-v1', p_status, p_kind_key,
    p_confidence, p_model, p_provider_project_id, p_config_version, p_input_tokens, p_output_tokens, p_cost_micros, p_failure_code, p_run_id);
  RETURN jsonb_build_object('recorded', TRUE, 'reason', 'new');
END
$$;

-- ---------------------------------------------------------------------------
-- 5. Сотрудник (authenticated).
-- ---------------------------------------------------------------------------
-- Подсказки по делу. Без согласия студента подсказок нет (третье место проверки): записанное раньше скрыто, не удалено.
CREATE FUNCTION platform.staff_document_suggestions_v1(p_organization_id UUID, p_student_case_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a RECORD; v_allowed BOOLEAN; v_items JSONB;
BEGIN
  IF p_organization_id IS NULL OR p_student_case_id IS NULL THEN
    RAISE EXCEPTION 'Student case is unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT x.organization_id, x.membership_id INTO a FROM platform.current_actor_authority() x
    WHERE x.organization_id = p_organization_id AND x.membership_id IS NOT NULL AND x.platform_role IS DISTINCT FROM 'student' LIMIT 1;
  IF NOT FOUND
    OR NOT platform_private.staff_can_access(p_organization_id, a.membership_id, 'case.read.full', 'student_case', p_student_case_id)
    OR NOT platform_private.staff_can_access(p_organization_id, a.membership_id, 'document.read.full', 'student_case', p_student_case_id) THEN
    RAISE EXCEPTION 'Student case is unavailable' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform.student_cases c WHERE c.organization_id = p_organization_id AND c.id = p_student_case_id) THEN
    RAISE EXCEPTION 'Student case is unavailable' USING ERRCODE = '42501';
  END IF;
  v_allowed := platform_private.ai_agent_student_ai_allowed(p_organization_id, p_student_case_id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('document_slot_id', x.document_slot_id, 'document_version_id', x.document_version_id,
    'status', g.status, 'kind_key', g.kind_key, 'confidence', g.confidence) ORDER BY g.created_at, g.id), '[]'::JSONB) INTO v_items
  FROM platform_private.doc_class_unsorted(p_organization_id, p_student_case_id) x
  JOIN platform_private.document_classification_suggestions g ON g.organization_id = p_organization_id
    AND g.document_version_id = x.document_version_id AND g.policy_version = 'doc-kind-v1' AND g.status IN ('suggested', 'unsure')
  WHERE v_allowed;
  RETURN jsonb_build_object('ai_allowed', v_allowed, 'items', v_items);
END
$$;

-- Решение куратора. Вызывается ПОСЛЕ переноса и одобрения существующими командами; идемпотентно по request_id и по версии.
CREATE FUNCTION platform.staff_resolve_document_suggestion_v1(p_organization_id UUID, p_student_case_id UUID, p_document_version_id UUID,
  p_kind_key TEXT, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE op RECORD; v RECORD; g platform_private.document_classification_suggestions%ROWTYPE; rr platform_private.document_classification_resolutions%ROWTYPE;
  v_resolution TEXT;
BEGIN
  IF p_organization_id IS NULL OR p_student_case_id IS NULL OR p_document_version_id IS NULL OR p_request_id IS NULL
    OR p_kind_key IS NULL OR p_kind_key NOT IN ('passport', 'attestat', 'transcript', 'photo', 'medical', 'police_certificate',
      'bank_statement', 'motivation_letter', 'language_certificate', 'birth_certificate', 'recommendation_letter', 'application_form',
      'payment_receipt') THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO op FROM platform_private.require_case_operator(p_organization_id, p_student_case_id, 'document.manage');
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

DO $a333_grants$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY['platform.document_classification_plan_v1(uuid,boolean)', 'platform.document_classification_context_v1(uuid)',
    'platform.document_classification_candidates_v1(uuid,integer,boolean,text)',
    'platform.document_classification_record_v1(uuid,uuid,text,text,numeric,text,text,text,integer,integer,bigint,text,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['platform.staff_document_suggestions_v1(uuid,uuid)',
    'platform.staff_resolve_document_suggestion_v1(uuid,uuid,uuid,text,uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END
$a333_grants$;

COMMENT ON TABLE platform_private.document_classification_suggestions IS
  'Migration 333: AI suggestion of what an amoCRM-imported file is (kind and confidence). Written only by the batch command; never overwrites a curator decision.';
COMMENT ON TABLE platform_private.document_classification_resolutions IS
  'Migration 333: the curator decision, separate from the AI suggestion. Append-only, one row per document version.';

NOTIFY pgrst, 'reload schema';

COMMIT;
