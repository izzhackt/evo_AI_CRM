-- 276_platform_ai_agent_autosend_send_path — «ИИ-агент» P4: своя точка входа
-- автоответчика в канонический путь исходящих WhatsApp (план §11, правило 9;
-- ADR 0031). Контракт: docs/EVO_AI_AGENT_PLAN_2026-10-06.md §11, §15 P4;
-- docs/PLAN_CHANGES.md (07.10, P4).
--
-- Перечитаны 044/049/050/077/097/101/156/259–266. Ручная отправка
-- (platform.request_manual_whatsapp_send_with_authorization) требует вошедшего
-- сотрудника; claim, finish и сверка — service_role. Автоответчик получает
-- свою точку входа, дальше — тот же код:
--  * platform.manual_send_authorizations: столбцы kind ('manual' по
--    умолчанию | 'ai_autosend') и ai_autosend_decision_id, проверка «ровно
--    один источник» (manual — без решения; ai_autosend — с решением и без
--    черновика), внешний ключ (организация, решение, диалог, сообщение) на
--    журнал и уникальность решения. Новые столбцы со значением по умолчанию —
--    только каталог (без перезаписи таблицы); проверка и ключ сканируют
--    небольшую таблицу под ACCESS EXCLUSIVE до конца транзакции миграции
--    (ручная отправка на эти секунды ждёт);
--  * BEFORE INSERT триггер guard_ai_autosend_authorization: строка
--    ai_autosend — только из ai_autosend_authorize_v1 (GUC
--    evo.ai_autosend_authorize = on), решение в статусе scheduled, текст и
--    SHA-256 — журнала, автор — ответственный сотрудник. Строки manual
--    проходят без изменений; прежние триггеры (текущий цикл входящих 050,
--    полномочие и access_version автора 156) работают для обоих видов;
--  * помощники без грантов: ai_autosend_claim_lock (тот же advisory-замок,
--    что у точного claim ручной отправки 101: снятие работы с очереди и claim
--    не пересекаются), ai_autosend_staff_signal (исходящее не автоответчика,
--    ручная авторизация, отправка в очереди или без исхода — кроме своей,
--    билет окна ИИ), ai_autosend_check (единственная реализация правил 1–4,
--    6–8, 11 и 13 для этапов due / commit / authorize), ai_autosend_skip,
--    ai_autosend_retire_work (не взятая работа решения — в dead letter
--    p2g_dead_letter_work; если её сообщения PGMQ уже нет — в то же
--    dead_lettered напрямую, без архива), ai_autosend_cancel_pending (отмена
--    scheduled и авторизованных, но ещё не взятых claim автоответов: работа
--    снимается с очереди), ai_autosend_pause, ai_autosend_call_task (задача
--    «Позвонить клиенту»: создатель = исполнитель = ответственный, срок —
--    10:00 дня звонка по Бишкеку, высокий приоритет; события, квитанция,
--    связь с лидом, уведомление «task_assigned», аудит system);
--  * platform.ai_autosend_authorize_v1 и platform.ai_autosend_record_v1 —
--    EXECUTE только у service_role (и require_p2g_service): авторизация
--    сохранённого текста и постановка работы manual_whatsapp_send
--    (p3c_enqueue_authenticated_work, одна попытка); повтор авторизации ещё
--    не взятой работы проверяет все правила заново и не старше 60 с (иначе
--    работа снимается, решение cancelled); запись исхода и автопауза
--    (463/475, три ошибки подряд). Отказы не бросают исключение: журнал и
--    пауза фиксируются;
--  * транскрипт и состояние чата (266) пересоздаются из своих md5-исходников
--    заменой фрагментов: origin = 'autoreply' и ключ kind у попытки —
--    только у строк ai_autosend; автоответ, снятый до claim, в попытках не
--    показывается. Для ручных отправок ответ байт в байт прежний.
--
-- Запрос ручной отправки, claim (обе перегрузки), finish, сверка, постановка
-- в очередь и прежние триггеры не пересоздаются: их md5 проверяются в конце.
-- Повторный запуск в той же точке цепочки ничего не меняет.
BEGIN;

DO $ai276_preconditions$
DECLARE r RECORD;
BEGIN
  IF to_regclass('platform_private.ai_autosend_log') IS NULL
    OR to_regprocedure('platform_private.ai_autosend_window(platform_private.ai_autosend_settings,timestamp with time zone)') IS NULL THEN
    RAISE EXCEPTION 'ai_agent_p4_requires_275' USING ERRCODE = '55000';
  END IF;
  -- Канонический путь, к которому подключается автоответчик, — ровно тот, что
  -- перечитан (266 и раньше).
  FOR r IN SELECT * FROM (VALUES
    ('platform.request_manual_whatsapp_send_with_authorization(uuid,uuid,uuid,uuid,text,text,text,uuid)', '5a2689b4b1e7e61a6a8b5c155c5fe6a9'),
    ('platform.claim_manual_whatsapp_send_item(uuid,uuid,integer,text,uuid)', '53f27c1f3f33cbc36b554f7f01986736'),
    ('platform_private.claim_next_manual_whatsapp_send_internal(uuid,integer,text,uuid,uuid)', '2c30f5bbc507db484643357921f2ca7d'),
    ('platform_private.claim_next_manual_whatsapp_send_internal(uuid,integer,text,uuid)', '95d095c0c2023a910ff09ea5de98420a'),
    ('platform.finish_manual_whatsapp_send(uuid,uuid,uuid,uuid,platform.durable_work_finish_outcome,text,text,timestamp with time zone,uuid)', '360648359239d08ee8f0cb6b8da9f690'),
    ('platform_private.p3c_enqueue_authenticated_work(uuid,platform.durable_work_kind,uuid,uuid,text,integer,uuid,platform.durable_work_operation,uuid,uuid,text)', 'abadeb64bdccc941f80de5b3c5c3856b'),
    ('platform_private.manual_whatsapp_send_attempt_states(uuid,uuid)', 'd7c460b4fc128f6e7d78de015e215721'),
    ('platform.request_manual_whatsapp_reconciliation(uuid,uuid,uuid,uuid,text)', '2e86f7f7109c40bfad1d25100248f697'),
    ('platform_private.capture_manual_send_authority()', 'debe84f79fb2e518e2067535c57fedd5'),
    ('platform_private.guard_p3c_current_inbound_cycle()', '9518087f0a8d8d6e2f3b1d59f5f702a5'),
    ('platform_private.require_p2g_service()', 'e88643b1caf48ccc5c5ccf08a778705f')
  ) AS pinned(signature, expected_md5) LOOP
    IF (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = r.signature::REGPROCEDURE)
      IS DISTINCT FROM r.expected_md5 THEN
      RAISE EXCEPTION 'ai_autosend_send_path_drift: % is not the definition 276 was written against', r.signature
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$ai276_preconditions$;

-- ---------------------------------------------------------------------------
-- Авторизация отправки: вид и ровно один источник.
-- ---------------------------------------------------------------------------
ALTER TABLE platform.manual_send_authorizations
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS ai_autosend_decision_id UUID;

DO $ai276_constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'platform.manual_send_authorizations'::REGCLASS
    AND conname = 'manual_send_authorizations_kind_check') THEN
    ALTER TABLE platform.manual_send_authorizations
      ADD CONSTRAINT manual_send_authorizations_kind_check CHECK (kind IN ('manual', 'ai_autosend'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'platform.manual_send_authorizations'::REGCLASS
    AND conname = 'manual_send_authorizations_one_source_check') THEN
    ALTER TABLE platform.manual_send_authorizations
      ADD CONSTRAINT manual_send_authorizations_one_source_check CHECK (
        (kind = 'manual' AND ai_autosend_decision_id IS NULL)
        OR (kind = 'ai_autosend' AND ai_autosend_decision_id IS NOT NULL AND ai_draft_id IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'platform.manual_send_authorizations'::REGCLASS
    AND conname = 'manual_send_authorizations_ai_decision_fkey') THEN
    ALTER TABLE platform.manual_send_authorizations
      ADD CONSTRAINT manual_send_authorizations_ai_decision_fkey
        FOREIGN KEY (organization_id, ai_autosend_decision_id, conversation_id, source_message_id)
        REFERENCES platform_private.ai_autosend_log(organization_id, id, conversation_id, client_message_id)
        ON DELETE RESTRICT;
  END IF;
END
$ai276_constraints$;
CREATE UNIQUE INDEX IF NOT EXISTS manual_send_authorizations_ai_decision_key
  ON platform.manual_send_authorizations (organization_id, ai_autosend_decision_id)
  WHERE ai_autosend_decision_id IS NOT NULL;

-- Строка ai_autosend — только из ai_autosend_authorize_v1: GUC выставлен,
-- решение в статусе scheduled, текст и SHA-256 — журнала, автор —
-- ответственный сотрудник настроек. Строка manual проходит как раньше.
CREATE OR REPLACE FUNCTION platform_private.guard_ai_autosend_authorization()
RETURNS TRIGGER LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.kind = 'manual' THEN
    RETURN NEW;
  END IF;
  IF COALESCE(current_setting('evo.ai_autosend_authorize', TRUE), '') <> 'on'
    OR NOT EXISTS (SELECT 1 FROM platform_private.ai_autosend_log l
      JOIN platform_private.ai_autosend_settings s ON s.organization_id = l.organization_id
      WHERE l.organization_id = NEW.organization_id AND l.id = NEW.ai_autosend_decision_id
        AND l.conversation_id = NEW.conversation_id AND l.client_message_id = NEW.source_message_id
        AND l.status = 'scheduled' AND l.text = NEW.final_text AND l.text_sha256 = NEW.final_text_sha256
        AND s.responsible_membership_id = NEW.authorized_by_membership_id) THEN
    RAISE EXCEPTION 'ai_autosend_authorization_forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION platform_private.guard_ai_autosend_authorization()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
DROP TRIGGER IF EXISTS manual_send_authorizations_ai_autosend_guard ON platform.manual_send_authorizations;
CREATE TRIGGER manual_send_authorizations_ai_autosend_guard BEFORE INSERT ON platform.manual_send_authorizations
  FOR EACH ROW EXECUTE FUNCTION platform_private.guard_ai_autosend_authorization();

-- ---------------------------------------------------------------------------
-- Помощники (platform_private, без грантов).
-- ---------------------------------------------------------------------------

-- Замок точного claim ручной отправки организации (101:
-- claim_manual_whatsapp_send_item). Все функции, которые могут снять
-- автоответ с очереди, берут его первым — до замков чата, решения и
-- настроек; так снятие и claim не пересекаются и не ждут друг друга по кругу.
CREATE OR REPLACE FUNCTION platform_private.ai_autosend_claim_lock(p_organization_id UUID)
RETURNS VOID LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'evo:p5b:manual-whatsapp-exact-claim:' || p_organization_id::TEXT, 0))
$$;

-- Сотрудник в чате после p_since (§11, правило 3): исходящее не
-- автоответчика (из CRM или с телефона), ручная авторизация, отправка в
-- очереди или без исхода (manual_whatsapp_send_attempt_states, 266; любого
-- вида — неизвестный исход блокирует и автоответчик; кроме авторизации
-- p_exclude_authorization — повтор авторизации самого решения), билет окна
-- ИИ.
CREATE OR REPLACE FUNCTION platform_private.ai_autosend_staff_signal(p_organization_id UUID, p_conversation_id UUID,
  p_since TIMESTAMPTZ, p_exclude_authorization UUID DEFAULT NULL)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM platform.communication_messages m
      WHERE m.organization_id = p_organization_id AND m.conversation_id = p_conversation_id
        AND m.direction = 'outbound' AND m.created_at > p_since
        AND NOT EXISTS (SELECT 1 FROM platform.manual_send_authorizations a
          WHERE a.organization_id = m.organization_id AND a.id = m.manual_send_authorization_id
            AND a.kind = 'ai_autosend'))
    OR EXISTS (SELECT 1 FROM platform.manual_send_authorizations a
      WHERE a.organization_id = p_organization_id AND a.conversation_id = p_conversation_id
        AND a.kind = 'manual' AND a.authorized_at > p_since)
    OR EXISTS (SELECT 1 FROM platform_private.manual_whatsapp_send_attempt_states(p_organization_id, p_conversation_id) s
      WHERE (s.status IN ('queued', 'prepared') OR (s.status = 'unknown' AND NOT s.readback_settled))
        AND s.manual_send_authorization_id IS DISTINCT FROM p_exclude_authorization)
    OR EXISTS (SELECT 1 FROM platform_private.ai_tickets t
      WHERE t.organization_id = p_organization_id AND t.conversation_id = p_conversation_id AND t.issued_at > p_since)
$$;

-- Сколько автоответов уже учтено для лимитов правила 3 (кроме самого
-- решения): в чате за час, в чате за «ночь» (24-часовой отрезок интервала от
-- его начала) и на номер (организацию) за час. Учитываются scheduled,
-- authorized, sent, unknown и shadow (shadow — как будто отправлено).
CREATE OR REPLACE FUNCTION platform_private.ai_autosend_usage(p_log platform_private.ai_autosend_log, p_at TIMESTAMPTZ)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'chatHour', count(*) FILTER (WHERE l.conversation_id = p_log.conversation_id
      AND l.committed_at > p_at - INTERVAL '1 hour'),
    'chatNight', count(*) FILTER (WHERE l.conversation_id = p_log.conversation_id
      AND l.interval_start = p_log.interval_start
      AND l.committed_at >= p_log.interval_start
        + floor(extract(epoch FROM p_at - p_log.interval_start) / 86400) * INTERVAL '1 day'),
    'numberHour', count(*) FILTER (WHERE l.committed_at > p_at - INTERVAL '1 hour'))
  FROM platform_private.ai_autosend_log l
  WHERE l.organization_id = p_log.organization_id AND l.id IS DISTINCT FROM p_log.id
    AND l.status IN ('scheduled', 'authorized', 'sent', 'unknown', 'shadow')
    AND l.committed_at >= least(p_at - INTERVAL '1 hour', p_log.interval_start)
$$;

-- Единственная реализация правил 1–4, 6–8, 11 и 13 (и 5 — числа — при
-- commit). Этапы: due (поступление и повторная проверка перед контекстом:
-- 11, 1–3, финальная фраза в интервале), commit (+ 4, 5, 6, 7, 13, цитаты из
-- предложенных, подтверждённый язык живого режима), authorize (+ shadow,
-- возраст ≤ 5 минут + задержка, 4, 6, 7, 13 по сохранённому тексту). Код
-- причины или NULL.
CREATE OR REPLACE FUNCTION platform_private.ai_autosend_check(p_log platform_private.ai_autosend_log, p_stage TEXT,
  p_text TEXT, p_cited BIGINT[])
RETURNS TEXT LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_now TIMESTAMPTZ := clock_timestamp(); v_settings platform_private.ai_autosend_settings;
  v_ai platform_private.ai_settings; v_conv platform.communication_conversations; v_msg platform.communication_messages;
  v_window JSONB; v_view JSONB; v_usage JSONB; v_reason TEXT;
  v_counted CONSTANT TEXT[] := ARRAY['scheduled', 'authorized', 'sent', 'unknown', 'shadow'];
BEGIN
  IF p_stage IS NULL OR p_stage NOT IN ('due', 'commit', 'authorize') THEN
    RAISE EXCEPTION 'ai_autosend_check_stage' USING ERRCODE = '22023';
  END IF;
  v_settings := platform_private.ai_autosend_settings_row(p_log.organization_id);
  v_ai := platform_private.ai_settings_row(p_log.organization_id);
  -- 11. Включён, согласие записано, не на паузе; при отправке — не shadow
  -- (кроме чата живого теста — и только после трёх ночей проверки).
  IF NOT v_settings.enabled OR NOT EXISTS (SELECT 1 FROM platform.organizations o
    WHERE o.id = p_log.organization_id AND o.status = 'active') THEN
    RETURN 'disabled';
  END IF;
  IF v_ai.gemini_consent_at IS NULL THEN
    RETURN 'no_consent';
  END IF;
  IF v_settings.pause_code IS NOT NULL THEN
    RETURN 'paused';
  END IF;
  IF p_stage = 'authorize' AND v_settings.shadow_mode
    AND platform_private.ai_autosend_mode(v_settings, p_log.conversation_id) <> 'live_test' THEN
    RETURN 'shadow_mode';
  END IF;
  -- 1. Открытый личный чат продаж (@c.us / @lid сессии crm_primary), ответ на
  -- живое входящее клиента (не импорт истории).
  SELECT * INTO v_conv FROM platform.communication_conversations c
  WHERE c.organization_id = p_log.organization_id AND c.id = p_log.conversation_id;
  IF NOT FOUND OR v_conv.queue <> 'sales' THEN
    RETURN 'not_sales';
  END IF;
  IF v_conv.status <> 'open' THEN
    RETURN 'conversation_closed';
  END IF;
  IF v_conv.waha_session_name <> 'crm_primary' OR NOT EXISTS (SELECT 1 FROM platform_private.waha_direct_chat_bindings b
    WHERE b.organization_id = v_conv.organization_id AND b.conversation_id = v_conv.id
      AND b.waha_session_name = 'crm_primary') THEN
    RETURN 'not_direct';
  END IF;
  SELECT * INTO v_msg FROM platform.communication_messages m
  WHERE m.organization_id = p_log.organization_id AND m.id = p_log.client_message_id
    AND m.conversation_id = p_log.conversation_id;
  IF NOT FOUND OR v_msg.direction <> 'inbound' THEN
    RETURN 'not_inbound';
  END IF;
  IF v_msg.message_identity_source = 'private_waha_history_binding' THEN
    RETURN 'history_message';
  END IF;
  -- 2. Самое новое входящее, пришло внутри того же интервала, не старше 5
  -- минут (при отправке — 5 минут плюс выбранная задержка).
  IF platform_private.ai_latest_inbound(p_log.organization_id, p_log.conversation_id) IS DISTINCT FROM v_msg.id THEN
    RETURN 'not_latest';
  END IF;
  v_window := platform_private.ai_autosend_window(v_settings, v_now);
  IF NOT (v_window ->> 'inside')::BOOLEAN
    OR (v_window ->> 'intervalStart')::TIMESTAMPTZ IS DISTINCT FROM p_log.interval_start
    OR v_msg.created_at < p_log.interval_start THEN
    RETURN 'outside_interval';
  END IF;
  IF v_now - v_msg.created_at > INTERVAL '5 minutes'
    + make_interval(secs => (CASE WHEN p_stage = 'authorize' THEN COALESCE(p_log.delay_s, 0) ELSE 0 END)) THEN
    RETURN 'too_old';
  END IF;
  -- 3. Чат не исключён; сотрудник не писал после клиента и не был активен 15
  -- минут; не только медиа; финальная фраза в этом интервале не сказана;
  -- лимиты чата за час и ночь (24-часовые отрезки от начала интервала) и
  -- номера за час.
  IF EXISTS (SELECT 1 FROM platform_private.ai_autosend_exclusions x
    WHERE x.organization_id = p_log.organization_id AND x.conversation_id = p_log.conversation_id) THEN
    RETURN 'excluded';
  END IF;
  IF platform_private.ai_autosend_staff_signal(p_log.organization_id, p_log.conversation_id,
    least(v_msg.created_at, v_now - INTERVAL '15 minutes'), p_log.manual_send_authorization_id) THEN
    RETURN 'staff_active';
  END IF;
  v_view := platform_private.ai_message_view(v_msg);
  IF COALESCE(btrim(v_view ->> 'text'), '') = '' THEN
    RETURN 'media_only';
  END IF;
  IF EXISTS (SELECT 1 FROM platform_private.ai_autosend_log l
    WHERE l.organization_id = p_log.organization_id AND l.conversation_id = p_log.conversation_id
      AND l.interval_start = p_log.interval_start AND l.id <> p_log.id AND l.kind = 'final_phrase'
      AND l.status = ANY (v_counted)) THEN
    RETURN 'handed_off';
  END IF;
  v_usage := platform_private.ai_autosend_usage(p_log, v_now);
  IF (v_usage ->> 'chatHour')::INTEGER >= v_settings.limit_chat_hour THEN
    RETURN 'limit_chat_hour';
  END IF;
  IF (v_usage ->> 'chatNight')::INTEGER >= v_settings.limit_chat_night THEN
    RETURN 'limit_chat_night';
  END IF;
  IF (v_usage ->> 'numberHour')::INTEGER >= v_settings.limit_number_hour THEN
    RETURN 'limit_number_hour';
  END IF;
  IF p_stage = 'due' THEN
    RETURN NULL;
  END IF;
  -- Язык живого режима подтверждён (фразы и строка-раскрытие).
  IF p_log.mode IN ('live', 'live_test')
    AND NOT platform_private.ai_autosend_language_confirmed(v_settings, p_log.language) THEN
    RETURN 'phrase_unconfirmed';
  END IF;
  -- 4. Цитаты — клиентские фрагменты этой организации, документ разрешён для
  -- автоответчика, ready и не заменён. 6. На их страницах нет открытых
  -- пунктов «Листа сверки».
  IF cardinality(COALESCE(p_cited, '{}')) > 0 THEN
    IF EXISTS (SELECT 1 FROM unnest(p_cited) x(id) WHERE NOT EXISTS (SELECT 1 FROM platform_private.ai_chunks c
      JOIN platform_private.ai_documents d ON d.organization_id = c.organization_id AND d.id = c.document_id
      WHERE c.id = x.id AND c.organization_id = p_log.organization_id AND d.audience = 'client'
        AND d.autosend_allowed AND d.status = 'ready' AND d.superseded_by_id IS NULL)) THEN
      RETURN 'source_not_allowed';
    END IF;
    IF EXISTS (SELECT 1 FROM platform_private.ai_chunks c JOIN platform_private.ai_review_items r
      ON r.organization_id = c.organization_id AND r.document_id = c.document_id
      WHERE c.id = ANY (p_cited) AND r.status IN ('open', 'applying')
        AND r.page_no BETWEEN COALESCE(c.page_from, 1) AND COALESCE(c.page_to, 300)) THEN
      RETURN 'open_review';
    END IF;
  END IF;
  IF p_stage = 'commit' AND NOT (COALESCE(p_cited, '{}') <@ p_log.offered_chunk_ids) THEN
    RETURN 'citation_not_offered';
  END IF;
  -- 7 и 13. Стоп-слова, ссылки, пометки [n], длина.
  v_reason := platform_private.ai_autosend_text_reason(p_text);
  IF v_reason IS NOT NULL THEN
    RETURN v_reason;
  END IF;
  -- 5. Числа ответа — дословно в цитируемых фрагментах (финальная фраза
  -- равна вычисленной и не проверяется).
  IF p_stage = 'commit' AND p_log.kind = 'answer'
    AND NOT platform_private.ai_autosend_numbers_ok(p_log.body, p_cited) THEN
    RETURN 'number_unsupported';
  END IF;
  RETURN NULL;
END
$$;

-- Решение пропущено с причиной (журнал, правило 12); аренда снимается.
CREATE OR REPLACE FUNCTION platform_private.ai_autosend_skip(p_decision_id UUID, p_reason TEXT)
RETURNS platform_private.ai_autosend_log LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  UPDATE platform_private.ai_autosend_log l SET status = 'skipped', reason_code = p_reason,
    reason_ru = platform_private.ai_autosend_reason_ru(p_reason), lease_owner = NULL, lease_expires_at = NULL,
    finished_at = clock_timestamp(), updated_at = clock_timestamp()
  WHERE l.id = p_decision_id
  RETURNING l.*
$$;

-- Снять с очереди не взятую работу автоответа (её решение отменяется):
-- dead letter p2g_dead_letter_work (045: сообщение PGMQ архивируется). Не
-- вышло, а сообщения PGMQ уже нет (точный claim находит работу только через
-- него — её никто не возьмёт), — работа закрывается тем же состоянием
-- dead_lettered напрямую: те же строки dead letter и события, что пишет 045,
-- без архива. Иначе она навсегда «в очереди»: чат «сотрудник активен», в
-- попытках — queued. Работу не ai_autosend этого решения, взятую claim (есть
-- попытка) или не queued не трогает. TRUE — работа снята. Вызывающий держит
-- ai_autosend_claim_lock организации.
CREATE OR REPLACE FUNCTION platform_private.ai_autosend_retire_work(p_organization_id UUID, p_decision_id UUID,
  p_work_item_id UUID, p_reason TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_item platform_private.durable_work_items; v_request UUID; v_evidence TEXT; v_dead_message BIGINT;
BEGIN
  SELECT * INTO v_item FROM platform_private.durable_work_items i
  WHERE i.organization_id = p_organization_id AND i.id = p_work_item_id FOR UPDATE;
  IF NOT FOUND OR v_item.state <> 'queued' OR v_item.attempt_count <> 0 OR v_item.kind <> 'manual_whatsapp_send'
    OR NOT EXISTS (SELECT 1 FROM platform.manual_send_authorizations a
      WHERE a.organization_id = v_item.organization_id AND a.id = v_item.manual_send_authorization_id
        AND a.kind = 'ai_autosend' AND a.ai_autosend_decision_id = p_decision_id)
    OR EXISTS (SELECT 1 FROM platform_private.durable_work_attempts a
      WHERE a.organization_id = v_item.organization_id AND a.work_item_id = v_item.id) THEN
    RETURN FALSE;
  END IF;
  v_request := platform_private.p3c_request_child_id(p_decision_id, 'ai-autosend-cancel');
  v_evidence := 'ai-autosend:' || COALESCE(p_reason, 'cancelled');
  BEGIN
    PERFORM platform_private.p2g_dead_letter_work(v_item.id, NULL, 'ai_autosend_cancelled', v_evidence, v_request);
    RETURN TRUE;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  IF EXISTS (SELECT 1 FROM pgmq.q_platform_work_v1 q WHERE q.msg_id = v_item.queue_message_id) THEN
    RETURN FALSE;
  END IF;
  BEGIN
    v_dead_message := pgmq.send('platform_dead_letter_v1',
      jsonb_build_object('v', 1, 'work_item_id', v_item.id, 'kind', v_item.kind), 0);
    UPDATE platform_private.durable_work_items i SET state = 'dead_lettered', leased_until = NULL,
      completed_at = statement_timestamp()
    WHERE i.id = v_item.id;
    INSERT INTO platform_private.durable_work_dead_letters (organization_id, work_item_id, attempt_id,
      active_queue_message_id, dead_letter_queue_message_id, reason_code, evidence_ref, request_id)
    VALUES (v_item.organization_id, v_item.id, NULL, v_item.queue_message_id, v_dead_message, 'ai_autosend_cancelled',
      v_evidence || ':queue-row-missing', v_request);
    INSERT INTO platform_private.durable_work_events (organization_id, work_item_id, attempt_id, event_type,
      previous_state, new_state, queue_message_id, evidence_ref, request_id)
    VALUES (v_item.organization_id, v_item.id, NULL, 'dead_lettered', 'queued', 'dead_lettered',
      v_item.queue_message_id, v_evidence || ':queue-row-missing', v_request);
    RETURN TRUE;
  EXCEPTION WHEN OTHERS THEN
    RETURN FALSE;
  END;
END
$$;

-- Отмена ждущих автоответов организации (или одного чата, одного решения,
-- одного режима): scheduled → cancelled; authorized, работа которых ещё в
-- очереди и не взята claim (queued, ни одной попытки), → работа в dead letter
-- (p2g_dead_letter_work 045: сообщение PGMQ архивируется, очередь ручных
-- отправок им больше не занята), решение cancelled. Работу, уже взятую
-- claim, не трогает: её исход запишет record. p_authorized_before — только
-- авторизованные раньше этого момента (уборка); тогда scheduled не трогаются.
-- Замок claim (ai_autosend_claim_lock) берётся перед первой работой.
CREATE OR REPLACE FUNCTION platform_private.ai_autosend_cancel_pending(p_organization_id UUID,
  p_conversation_id UUID, p_decision_id UUID, p_reason TEXT, p_mode TEXT DEFAULT NULL,
  p_authorized_before TIMESTAMPTZ DEFAULT NULL)
RETURNS INTEGER LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_count INTEGER := 0; v_rows INTEGER; v_locked BOOLEAN := FALSE; v_pending RECORD;
  v_item platform_private.durable_work_items;
BEGIN
  IF p_authorized_before IS NULL THEN
    UPDATE platform_private.ai_autosend_log l SET status = 'cancelled', reason_code = p_reason,
      reason_ru = platform_private.ai_autosend_reason_ru(p_reason), lease_owner = NULL, lease_expires_at = NULL,
      finished_at = clock_timestamp(), updated_at = clock_timestamp()
    WHERE l.organization_id = p_organization_id AND l.status = 'scheduled'
      AND (p_conversation_id IS NULL OR l.conversation_id = p_conversation_id)
      AND (p_decision_id IS NULL OR l.id = p_decision_id)
      AND (p_mode IS NULL OR l.mode = p_mode);
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_count := v_rows;
  END IF;
  FOR v_pending IN SELECT l.id, l.work_item_id FROM platform_private.ai_autosend_log l
    JOIN platform_private.durable_work_items i ON i.organization_id = l.organization_id AND i.id = l.work_item_id
    WHERE l.organization_id = p_organization_id AND l.status = 'authorized'
      AND i.state = 'queued' AND i.attempt_count = 0
      AND (p_conversation_id IS NULL OR l.conversation_id = p_conversation_id)
      AND (p_decision_id IS NULL OR l.id = p_decision_id)
      AND (p_mode IS NULL OR l.mode = p_mode)
      AND (p_authorized_before IS NULL OR l.authorized_at < p_authorized_before)
    ORDER BY l.id LOOP
    IF NOT v_locked THEN
      PERFORM platform_private.ai_autosend_claim_lock(p_organization_id);
      v_locked := TRUE;
    END IF;
    SELECT * INTO v_item FROM platform_private.durable_work_items i
    WHERE i.organization_id = p_organization_id AND i.id = v_pending.work_item_id FOR UPDATE;
    CONTINUE WHEN v_item.state <> 'queued' OR v_item.attempt_count <> 0
      OR EXISTS (SELECT 1 FROM platform_private.durable_work_attempts a
        WHERE a.organization_id = v_item.organization_id AND a.work_item_id = v_item.id);
    -- Выключатель не должен падать из-за уборки: если снять работу с
    -- очереди нельзя, решение всё равно cancelled — повтор authorize его не
    -- отдаст, а без authorize работу никто не берёт (точный claim ждёт её id
    -- из ответа authorize); такую работу добирает уборка (maintenance_v1).
    PERFORM platform_private.ai_autosend_retire_work(p_organization_id, v_pending.id, v_item.id, p_reason);
    UPDATE platform_private.ai_autosend_log l SET status = 'cancelled', reason_code = p_reason,
      reason_ru = platform_private.ai_autosend_reason_ru(p_reason), lease_owner = NULL, lease_expires_at = NULL,
      finished_at = clock_timestamp(), updated_at = clock_timestamp()
    WHERE l.id = v_pending.id AND l.status = 'authorized';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_count := v_count + v_rows;
  END LOOP;
  RETURN v_count;
END
$$;

-- Пауза (правило 11): первая причина сохраняется, ждущие автоответы
-- (scheduled и ещё не взятые claim) отменяются, смена состояния — в аудит
-- (без текстов). Снимает паузу только человек (ai_agent_autosend_pause_v1,
-- 277).
CREATE OR REPLACE FUNCTION platform_private.ai_autosend_pause(p_organization_id UUID, p_code TEXT, p_by_kind TEXT,
  p_by_membership_id UUID, p_by_profile_id UUID, p_principal TEXT, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_settings platform_private.ai_autosend_settings; v_cancelled INTEGER; v_changed BOOLEAN := FALSE;
BEGIN
  PERFORM platform_private.ai_autosend_claim_lock(p_organization_id);
  PERFORM platform_private.ai_autosend_settings_row(p_organization_id);
  SELECT * INTO v_settings FROM platform_private.ai_autosend_settings s
  WHERE s.organization_id = p_organization_id FOR UPDATE;
  IF v_settings.pause_code IS NULL THEN
    UPDATE platform_private.ai_autosend_settings s SET pause_code = p_code, pause_by_kind = p_by_kind,
      paused_at = clock_timestamp(), paused_by = CASE WHEN p_by_kind = 'user' THEN p_by_membership_id END,
      version = s.version + 1, updated_at = clock_timestamp()
    WHERE s.organization_id = p_organization_id;
    v_changed := TRUE;
  END IF;
  v_cancelled := platform_private.ai_autosend_cancel_pending(p_organization_id, NULL, NULL, 'paused');
  IF v_changed AND p_by_kind <> 'user' THEN
    INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal, action,
      resource_type, resource_id, before_state, after_state, reason, request_id)
    VALUES (p_organization_id, (CASE WHEN p_by_kind = 'system' THEN 'system' ELSE 'service' END)::platform.audit_actor_kind,
      NULL, p_principal, 'ai.agent.autosend.pause', 'organization', p_organization_id,
      jsonb_build_object('pauseCode', NULL), jsonb_build_object('pauseCode', p_code, 'byKind', p_by_kind,
        'cancelled', v_cancelled), 'ИИ-агент: автоответчик на паузе', COALESCE(p_request_id, gen_random_uuid()));
  END IF;
  RETURN jsonb_build_object('paused', TRUE, 'pauseCode', COALESCE(v_settings.pause_code, p_code), 'changed', v_changed,
    'cancelled', v_cancelled);
END
$$;

-- Задача «Позвонить клиенту» (§11, §18 Q7) по чату сводки: создатель =
-- исполнитель = ответственный сотрудник, срок — 10:00 дня звонка по Бишкеку,
-- приоритет high; события, квитанция, связь с лидом (canonical_lead_id) и
-- аудит (system). Ответственный не может получить задачу — taskSkipped.
-- Один раз на (сводка, чат).
CREATE OR REPLACE FUNCTION platform_private.ai_autosend_call_task(p_summary_id UUID, p_conversation_id UUID,
  p_call_date DATE)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_org UUID; v_settings platform_private.ai_autosend_settings; v_existing platform_private.ai_autosend_call_tasks;
  v_member RECORD; v_lead UUID; v_request UUID; v_task platform.staff_tasks; v_payload JSONB; v_result JSONB;
  v_at TIMESTAMPTZ := clock_timestamp(); v_event UUID;
BEGIN
  SELECT s.organization_id INTO v_org FROM platform_private.ai_autosend_summaries s WHERE s.id = p_summary_id;
  IF NOT FOUND OR p_call_date IS NULL THEN
    RAISE EXCEPTION 'ai_autosend_call_task_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_existing FROM platform_private.ai_autosend_call_tasks t
  WHERE t.summary_id = p_summary_id AND t.conversation_id = p_conversation_id;
  IF FOUND THEN
    RETURN jsonb_build_object('taskId', v_existing.staff_task_id, 'taskSkipped', v_existing.staff_task_id IS NULL,
      'callDate', v_existing.call_date);
  END IF;
  v_settings := platform_private.ai_autosend_settings_row(v_org);
  v_request := platform_private.p3c_request_child_id(p_summary_id, 'ai-autosend-call-task:' || p_conversation_id::TEXT);
  SELECT m.id, m.profile_id INTO v_member FROM platform.organization_memberships m
  JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = v_org AND m.id = v_settings.responsible_membership_id
    AND m.status = 'active' AND p.status = 'active'
    AND platform_private.staff_can_receive_assignment(v_org, m.id, 'staff.task.complete', 'staff_task', NULL)
    AND platform_private.staff_can_receive_assignment(v_org, m.id, 'staff.task.read', 'staff_task', NULL)
  FOR SHARE OF m, p;
  IF NOT FOUND THEN
    INSERT INTO platform_private.ai_autosend_call_tasks (summary_id, conversation_id, organization_id, call_date,
      skipped_reason)
    VALUES (p_summary_id, p_conversation_id, v_org, p_call_date, 'assignee_unavailable');
    RETURN jsonb_build_object('taskId', NULL, 'taskSkipped', TRUE, 'callDate', p_call_date);
  END IF;
  SELECT c.canonical_lead_id INTO v_lead FROM platform.communication_conversations c
  WHERE c.organization_id = v_org AND c.id = p_conversation_id;
  INSERT INTO platform.staff_tasks (organization_id, creator_membership_id, assignee_membership_id, title, description,
    status, priority, due_at, created_at, updated_at)
  VALUES (v_org, v_member.id, v_member.id, 'Позвонить клиенту',
    'Автоответчик сказал клиенту, что ему позвонит руководитель. Откройте чат продаж и позвоните.',
    'open', 'high', (p_call_date + TIME '10:00') AT TIME ZONE 'Asia/Bishkek', v_at, v_at)
  RETURNING * INTO v_task;
  v_payload := jsonb_build_object('operation', 'create', 'source', 'ai_autosend', 'summary_id', p_summary_id,
    'conversation_id', p_conversation_id, 'call_date', p_call_date);
  v_result := jsonb_build_object('staff_task_id', v_task.id, 'version', v_task.version::TEXT, 'request_id', v_request,
    'changed_at', v_at);
  INSERT INTO platform.staff_task_events (organization_id, staff_task_id, actor_membership_id, actor_profile_id, action,
    version, before_state, after_state, request_id, created_at)
  VALUES (v_org, v_task.id, v_member.id, v_member.profile_id, 'create', v_task.version, NULL, to_jsonb(v_task),
    v_request, v_at)
  RETURNING id INTO v_event;
  -- Создатель = исполнитель, поэтому триггер уведомлений (142) автора события
  -- не уведомит; задачу поставил автоответчик — уведомление «task_assigned»
  -- тем же ключом события, без автора.
  INSERT INTO platform.staff_notifications (organization_id, recipient_membership_id, event_key, kind, staff_task_id)
  VALUES (v_org, v_member.id, 'task:' || v_event::TEXT, 'task_assigned', v_task.id)
  ON CONFLICT (organization_id, recipient_membership_id, event_key) DO NOTHING;
  INSERT INTO platform_private.staff_task_receipts (request_id, organization_id, actor_membership_id, staff_task_id,
    request_payload, result)
  VALUES (v_request, v_org, v_member.id, v_task.id, v_payload, v_result);
  IF v_lead IS NOT NULL THEN
    INSERT INTO platform_private.staff_lead_task_links (request_id, organization_id, actor_membership_id, staff_task_id,
      lead_id, input, result)
    VALUES (v_request, v_org, v_member.id, v_task.id, v_lead, v_payload, v_result);
  END IF;
  INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal, action,
    resource_type, resource_id, before_state, after_state, reason, request_id, created_at)
  VALUES (v_org, 'system', NULL, 'ai-autosend', 'staff.task.create', 'staff_task', v_task.id, NULL,
    v_result || jsonb_build_object('assigneeMembershipId', v_member.id, 'leadId', v_lead, 'summaryId', p_summary_id),
    'ИИ-агент: задача «Позвонить клиенту» после финальной фразы автоответчика', v_request, v_at);
  INSERT INTO platform_private.ai_autosend_call_tasks (summary_id, conversation_id, organization_id, call_date,
    staff_task_id)
  VALUES (p_summary_id, p_conversation_id, v_org, p_call_date, v_task.id);
  RETURN jsonb_build_object('taskId', v_task.id, 'taskSkipped', FALSE, 'callDate', p_call_date);
END
$$;

DO $ai276_private_acl$
DECLARE f REGPROCEDURE;
BEGIN
  FOR f IN SELECT p.oid::REGPROCEDURE FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform_private' AND p.proname LIKE 'ai\_autosend\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent', f);
  END LOOP;
END
$ai276_private_acl$;

-- ===========================================================================
-- Сервер CRM (platform, EXECUTE только у service_role).
-- ===========================================================================

-- Авторизация одного автоответа (правило 9): только сохранённый текст
-- решения, автор — ответственный сотрудник. Отказ: решение skipped с
-- причиной (кроме «не scheduled» и «ещё рано»), {authorized:false, reason};
-- исключение не бросается — журнал и пауза фиксируются. Успех — поля ответа
-- ручного запроса (request_manual_whatsapp_send_with_authorization) для
-- executePlatformManualWhatsAppSend и authorized:true.
--
-- Повтор уже авторизованного решения. Работа ещё в очереди и не взята claim:
-- повтор не старше 60 с после авторизации и все правила колонки authorize
-- (и ответственный — автор авторизации) проверяются заново на сохранённом
-- тексте; не прошло — работа снимается с очереди (dead letter), решение
-- cancelled, {authorized:false}. Работа уже взята — {authorized:false,
-- reason:'already_claimed'} (отправка идёт у того, кто её взял). Решение с
-- итогом (sent, failed, unknown) — прежний ответ с decision_status.
CREATE OR REPLACE FUNCTION platform.ai_autosend_authorize_v1(p_organization_id UUID, p_decision_id UUID,
  p_provider_status TEXT, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_now TIMESTAMPTZ := clock_timestamp(); v_conversation UUID; v_row platform_private.ai_autosend_log;
  v_settings platform_private.ai_autosend_settings; v_reason TEXT; v_member RECORD; v_authz_id UUID; v_key TEXT;
  v_enqueue JSONB; v_result JSONB; v_authz platform.manual_send_authorizations; v_item RECORD;
BEGIN
  PERFORM platform_private.require_p2g_service();
  IF p_organization_id IS NULL OR p_decision_id IS NULL OR p_request_id IS NULL
    OR p_provider_status IS NULL OR p_provider_status !~ '^[A-Z][A-Z_]{0,39}$' THEN
    RAISE EXCEPTION 'ai_autosend_authorize_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT l.conversation_id INTO v_conversation FROM platform_private.ai_autosend_log l
  WHERE l.organization_id = p_organization_id AND l.id = p_decision_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_autosend_decision_unknown' USING ERRCODE = 'P0002';
  END IF;
  -- Порядок блокировок: замок claim организации (снятие с очереди, пауза),
  -- затем, как у функций агента, чат (advisory) и строка.
  PERFORM platform_private.ai_autosend_claim_lock(p_organization_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('ai_autosend:' || v_conversation::TEXT, 275));
  SELECT * INTO v_row FROM platform_private.ai_autosend_log l
  WHERE l.organization_id = p_organization_id AND l.id = p_decision_id FOR UPDATE;

  IF v_row.manual_send_authorization_id IS NOT NULL THEN
    SELECT * INTO v_authz FROM platform.manual_send_authorizations a
    WHERE a.organization_id = v_row.organization_id AND a.id = v_row.manual_send_authorization_id;
    SELECT i.id, i.state, i.attempt_count, i.queue_message_id, i.business_key_sha256 INTO v_item
    FROM platform_private.durable_work_items i
    WHERE i.organization_id = v_row.organization_id AND i.id = v_row.work_item_id FOR UPDATE;
    IF v_row.status = 'authorized' AND v_item.state = 'queued' AND v_item.attempt_count = 0 THEN
      -- Ещё не взята claim: решение снова проходит колонку authorize — после
      -- первой авторизации могли написать сотрудник или клиент, выключить
      -- автоответчик, поставить паузу или исключить чат.
      IF v_now - v_row.authorized_at > INTERVAL '60 seconds' THEN
        v_reason := 'send_expired';
      ELSIF p_provider_status <> 'WORKING' THEN
        v_reason := 'provider_down';
      ELSE
        v_reason := platform_private.ai_autosend_check(v_row, 'authorize', v_row.text, v_row.cited_chunk_ids);
        IF v_reason IS NULL AND NOT EXISTS (SELECT 1 FROM platform.organization_memberships m
          JOIN platform.profiles p ON p.id = m.profile_id
          JOIN platform.organizations o ON o.id = m.organization_id
          WHERE m.organization_id = v_row.organization_id AND m.id = v_authz.authorized_by_membership_id
            AND m.profile_id = v_authz.authorized_by_profile_id
            AND m.status = 'active' AND p.status = 'active' AND o.status = 'active'
            AND m."current_role" IS DISTINCT FROM 'student'
            AND platform_private.staff_can_access(m.organization_id, m.id, 'communication.manual.send', 'conversation',
              v_row.conversation_id)) THEN
          v_reason := 'responsible_unavailable';
        END IF;
      END IF;
      IF v_reason IS NOT NULL THEN
        PERFORM platform_private.ai_autosend_cancel_pending(v_row.organization_id, NULL, v_row.id, v_reason);
        IF v_reason = 'provider_down' THEN
          PERFORM platform_private.ai_autosend_pause(v_row.organization_id, 'provider_down', 'service', NULL, NULL,
            'service_role', NULL);
        END IF;
        SELECT * INTO v_row FROM platform_private.ai_autosend_log l WHERE l.id = v_row.id;
        INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal, action,
          resource_type, resource_id, before_state, after_state, reason, request_id)
        VALUES (v_row.organization_id, 'service', NULL, 'service_role', 'ai.agent.autosend.cancel',
          'manual_send_authorization', v_authz.id, jsonb_build_object('decisionStatus', 'authorized'),
          jsonb_build_object('decisionId', v_row.id, 'decisionStatus', v_row.status, 'reasonCode', v_reason,
            'workItemId', v_row.work_item_id, 'providerStatus', p_provider_status),
          'ИИ-агент: повтор авторизации не прошёл проверку, автоответ снят с очереди',
          platform_private.p3c_request_child_id(v_row.id, 'ai-autosend-replay-cancel'));
        RETURN jsonb_build_object('authorized', FALSE, 'reason', v_reason,
          'reasonRu', platform_private.ai_autosend_reason_ru(v_reason), 'decisionId', v_row.id, 'status', v_row.status);
      END IF;
    ELSIF v_row.status IN ('authorized', 'cancelled') THEN
      RETURN jsonb_build_object('authorized', FALSE,
        'reason', CASE WHEN v_row.status = 'cancelled' THEN 'not_scheduled' ELSE 'already_claimed' END,
        'decisionId', v_row.id, 'status', v_row.status);
    END IF;
    RETURN jsonb_build_object('authorized', TRUE, 'replayed', TRUE, 'ai_autosend_decision_id', v_row.id,
      'organization_id', v_authz.organization_id, 'manual_send_authorization_id', v_authz.id,
      'communication_conversation_id', v_authz.conversation_id, 'source_message_id', v_authz.source_message_id,
      'ai_draft_id', NULL, 'final_text', v_authz.final_text, 'final_text_sha256', v_authz.final_text_sha256,
      'authorized_by_membership_id', v_authz.authorized_by_membership_id, 'state', 'manual_send_authorized',
      'requested_by_membership_id', v_authz.authorized_by_membership_id, 'work_item_id', v_item.id,
      'work_state', v_item.state, 'queue_message_id', v_item.queue_message_id,
      'business_key_sha256', v_item.business_key_sha256, 'waha_readiness', 'ready',
      'waha_readiness_evidence_kind', 'provider_observed', 'waha_readiness_fresh', TRUE,
      'waha_readiness_observed_at', v_row.authorized_at, 'decision_status', v_row.status);
  END IF;
  IF v_row.status <> 'scheduled' THEN
    RETURN jsonb_build_object('authorized', FALSE, 'reason', 'not_scheduled', 'decisionId', v_row.id,
      'status', v_row.status);
  END IF;
  IF v_now < v_row.send_at - INTERVAL '5 seconds' THEN
    RETURN jsonb_build_object('authorized', FALSE, 'reason', 'not_due', 'decisionId', v_row.id, 'status', v_row.status,
      'sendAt', v_row.send_at);
  END IF;
  -- Правило 11: сессия не в WORKING — пауза (живая проверка CRM).
  IF p_provider_status <> 'WORKING' THEN
    v_row := platform_private.ai_autosend_skip(v_row.id, 'provider_down');
    PERFORM platform_private.ai_autosend_pause(v_row.organization_id, 'provider_down', 'service', NULL, NULL,
      'service_role', NULL);
    RETURN jsonb_build_object('authorized', FALSE, 'reason', 'provider_down', 'reasonRu', v_row.reason_ru,
      'decisionId', v_row.id, 'status', v_row.status);
  END IF;
  v_reason := platform_private.ai_autosend_check(v_row, 'authorize', v_row.text, v_row.cited_chunk_ids);
  IF v_reason IS NULL THEN
    v_settings := platform_private.ai_autosend_settings_row(v_row.organization_id);
    -- Ответственный сотрудник: активен (профиль, членство, организация), не
    -- студент и может отправлять в этот чат (communication.manual.send).
    SELECT m.id, m.profile_id, p.auth_user_id INTO v_member FROM platform.organization_memberships m
    JOIN platform.profiles p ON p.id = m.profile_id
    JOIN platform.organizations o ON o.id = m.organization_id
    WHERE m.organization_id = v_row.organization_id AND m.id = v_settings.responsible_membership_id
      AND m.status = 'active' AND p.status = 'active' AND o.status = 'active'
      AND m."current_role" IS DISTINCT FROM 'student'
      AND platform_private.staff_can_access(m.organization_id, m.id, 'communication.manual.send', 'conversation',
        v_row.conversation_id);
    IF NOT FOUND THEN
      v_reason := 'responsible_unavailable';
    END IF;
  END IF;
  IF v_reason IS NOT NULL THEN
    v_row := platform_private.ai_autosend_skip(v_row.id, v_reason);
    RETURN jsonb_build_object('authorized', FALSE, 'reason', v_reason, 'reasonRu', v_row.reason_ru,
      'decisionId', v_row.id, 'status', v_row.status);
  END IF;

  v_authz_id := gen_random_uuid();
  PERFORM set_config('evo.ai_autosend_authorize', 'on', TRUE);
  INSERT INTO platform.manual_send_authorizations (id, organization_id, conversation_id, source_message_id, ai_draft_id,
    final_text, final_text_sha256, authorized_by_profile_id, authorized_by_membership_id, reason, request_id, kind,
    ai_autosend_decision_id)
  VALUES (v_authz_id, v_row.organization_id, v_row.conversation_id, v_row.client_message_id, NULL, v_row.text,
    v_row.text_sha256, v_member.profile_id, v_member.id, 'ai_autosend',
    platform_private.p3c_request_child_id(v_row.id, 'ai-autosend-authorize'), 'ai_autosend', v_row.id);
  PERFORM set_config('evo.ai_autosend_authorize', '', TRUE);
  v_key := encode(sha256(convert_to(array_to_json(ARRAY['evo-platform-work-v1', 'ai_autosend',
    v_row.organization_id::TEXT, v_row.conversation_id::TEXT, v_row.client_message_id::TEXT, v_row.id::TEXT])::TEXT,
    'UTF8')), 'hex');
  v_enqueue := platform_private.p3c_enqueue_authenticated_work(v_row.organization_id, 'manual_whatsapp_send', NULL,
    v_authz_id, v_key, 1, platform_private.p3c_request_child_id(v_row.id, 'ai-autosend-enqueue'),
    'enqueue_manual_whatsapp_send', v_member.profile_id, v_member.auth_user_id,
    'Enqueue one autoresponder WhatsApp send for the exact current inbound cycle');
  UPDATE platform_private.ai_autosend_log l SET status = 'authorized', manual_send_authorization_id = v_authz_id,
    work_item_id = (v_enqueue ->> 'work_item_id')::UUID, authorized_at = v_now, lease_owner = NULL,
    lease_expires_at = NULL, updated_at = v_now
  WHERE l.id = v_row.id;
  v_result := jsonb_build_object('organization_id', v_row.organization_id, 'manual_send_authorization_id', v_authz_id,
    'communication_conversation_id', v_row.conversation_id, 'source_message_id', v_row.client_message_id,
    'ai_draft_id', NULL, 'final_text', v_row.text, 'final_text_sha256', v_row.text_sha256,
    'authorized_by_membership_id', v_member.id, 'state', 'manual_send_authorized',
    'requested_by_membership_id', v_member.id, 'work_item_id', v_enqueue -> 'work_item_id',
    'work_state', v_enqueue -> 'state', 'queue_message_id', v_enqueue -> 'queue_message_id',
    'business_key_sha256', v_key, 'waha_readiness', 'ready', 'waha_readiness_evidence_kind', 'provider_observed',
    'waha_readiness_fresh', TRUE, 'waha_readiness_observed_at', v_now);
  INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal, action,
    resource_type, resource_id, before_state, after_state, reason, request_id)
  VALUES (v_row.organization_id, 'service', NULL, 'service_role', 'ai.agent.autosend.authorize',
    'manual_send_authorization', v_authz_id, jsonb_build_object('decisionStatus', 'scheduled'),
    jsonb_build_object('decisionId', v_row.id, 'conversationId', v_row.conversation_id,
      'sourceMessageId', v_row.client_message_id, 'workItemId', v_enqueue -> 'work_item_id',
      'authorizedByMembershipId', v_member.id, 'mode', v_row.mode, 'kind', v_row.kind,
      'textSha256', v_row.text_sha256, 'providerStatus', p_provider_status),
    'ИИ-агент: автоответ авторизован', p_request_id);
  RETURN v_result || jsonb_build_object('authorized', TRUE, 'replayed', FALSE, 'ai_autosend_decision_id', v_row.id);
END
$$;

-- Исход отправки (сервер CRM после finish): sent | failed | unknown, код.
-- sent требует привязку сообщения провайдера (finish succeeded) и обнуляет
-- счётчик ошибок; provider_restricted (463/475) — пауза; три ошибки подряд —
-- пауза send_errors. unknown → sent допускается (сверка нашла сообщение).
-- Повтор того же исхода отдаёт прежний результат.
CREATE OR REPLACE FUNCTION platform.ai_autosend_record_v1(p_organization_id UUID, p_decision_id UUID, p_outcome TEXT,
  p_code TEXT, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row platform_private.ai_autosend_log; v_settings platform_private.ai_autosend_settings;
  v_pause JSONB; v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  PERFORM platform_private.require_p2g_service();
  IF p_organization_id IS NULL OR p_decision_id IS NULL OR p_request_id IS NULL
    OR p_outcome IS NULL OR p_outcome NOT IN ('sent', 'failed', 'unknown')
    OR (p_outcome = 'sent' AND p_code IS NOT NULL)
    OR (p_outcome <> 'sent' AND (p_code IS NULL OR p_code !~ '^[a-z][a-z0-9_]{0,63}$')) THEN
    RAISE EXCEPTION 'ai_autosend_record_invalid' USING ERRCODE = '22023';
  END IF;
  -- Исход может поставить паузу (она снимает ждущие автоответы): замок claim —
  -- первым.
  PERFORM platform_private.ai_autosend_claim_lock(p_organization_id);
  SELECT * INTO v_row FROM platform_private.ai_autosend_log l
  WHERE l.organization_id = p_organization_id AND l.id = p_decision_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_autosend_decision_unknown' USING ERRCODE = 'P0002';
  END IF;
  IF v_row.status = p_outcome AND v_row.outcome_code IS NOT DISTINCT FROM p_code THEN
    RETURN jsonb_build_object('decisionId', v_row.id, 'status', v_row.status, 'outcomeCode', v_row.outcome_code,
      'replayed', TRUE);
  END IF;
  IF NOT (v_row.status = 'authorized' OR (v_row.status = 'unknown' AND p_outcome = 'sent')) THEN
    RAISE EXCEPTION 'ai_autosend_record_conflict' USING ERRCODE = 'PT409';
  END IF;
  IF p_outcome = 'sent' AND NOT EXISTS (SELECT 1 FROM platform_private.manual_send_provider_bindings b
    WHERE b.organization_id = v_row.organization_id AND b.durable_work_item_id = v_row.work_item_id) THEN
    RAISE EXCEPTION 'ai_autosend_not_sent' USING ERRCODE = '55000';
  END IF;
  UPDATE platform_private.ai_autosend_log l SET status = p_outcome, outcome_code = p_code, finished_at = v_now,
    updated_at = v_now
  WHERE l.id = v_row.id;
  PERFORM platform_private.ai_autosend_settings_row(v_row.organization_id);
  UPDATE platform_private.ai_autosend_settings s SET
    send_error_streak = CASE WHEN p_outcome = 'sent' THEN 0 ELSE s.send_error_streak + 1 END,
    updated_at = v_now
  WHERE s.organization_id = v_row.organization_id RETURNING * INTO v_settings;
  IF p_code = 'provider_restricted' THEN
    v_pause := platform_private.ai_autosend_pause(v_row.organization_id, 'provider_restricted', 'service', NULL, NULL,
      'service_role', NULL);
  ELSIF p_outcome <> 'sent' AND v_settings.send_error_streak >= 3 THEN
    v_pause := platform_private.ai_autosend_pause(v_row.organization_id, 'send_errors', 'service', NULL, NULL,
      'service_role', NULL);
  END IF;
  INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal, action,
    resource_type, resource_id, before_state, after_state, reason, request_id)
  VALUES (v_row.organization_id, 'service', NULL, 'service_role', 'ai.agent.autosend.record',
    'manual_send_authorization', v_row.manual_send_authorization_id, jsonb_build_object('status', v_row.status),
    jsonb_build_object('decisionId', v_row.id, 'status', p_outcome, 'outcomeCode', p_code,
      'workItemId', v_row.work_item_id, 'sendErrorStreak', v_settings.send_error_streak,
      'pauseCode', v_pause ->> 'pauseCode'),
    'ИИ-агент: исход автоответа записан', p_request_id);
  RETURN jsonb_build_object('decisionId', v_row.id, 'status', p_outcome, 'outcomeCode', p_code,
    'paused', v_pause IS NOT NULL, 'pauseCode', v_pause ->> 'pauseCode', 'replayed', FALSE);
END
$$;

REVOKE ALL ON FUNCTION platform.ai_autosend_authorize_v1(UUID, UUID, TEXT, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
REVOKE ALL ON FUNCTION platform.ai_autosend_record_v1(UUID, UUID, TEXT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
GRANT EXECUTE ON FUNCTION platform.ai_autosend_authorize_v1(UUID, UUID, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION platform.ai_autosend_record_v1(UUID, UUID, TEXT, TEXT, UUID) TO service_role;

-- ===========================================================================
-- Транскрипт и состояние чата (266): «Автоответчик» и вид попытки. Исходник
-- каждой функции закреплён md5 (266 или уже применённой 276), каждый
-- фрагмент встречается ровно один раз; иначе миграция останавливается.
-- Автоответ, снятый с очереди до claim (dead letter без попытки), в
-- попытках чата не показывается: у него нет ни попытки, ни отправки, а
-- «rejected» без попытки читатель приложения не принимает.
-- ===========================================================================
DO $ai276_transcript$
DECLARE
  patch RECORD;
  fragment RECORD;
  installed_md5 TEXT;
  definition TEXT;
  matches INTEGER;
BEGIN
  CREATE TEMP TABLE ai276_fragments (
    routine_signature TEXT NOT NULL,
    old_fragment TEXT NOT NULL,
    new_fragment TEXT NOT NULL
  ) ON COMMIT DROP;
  INSERT INTO ai276_fragments VALUES
  ('platform.staff_whatsapp_message_page(uuid,uuid,integer,timestamp with time zone,uuid)',
   $o$      WHEN message.message_identity_source = 'private_manual_send_binding' THEN 'crm'$o$,
   $n$      WHEN message.message_identity_source = 'private_manual_send_binding'
        AND authz.kind = 'ai_autosend' THEN 'autoreply'
      WHEN message.message_identity_source = 'private_manual_send_binding' THEN 'crm'$n$),
  ('platform.staff_whatsapp_chat_state(uuid,uuid,integer)',
   $o$          'readback_settled', state_row.readback_settled
        ) ORDER BY state_row.authorized_at, state_row.work_item_id)$o$,
   $n$          'readback_settled', state_row.readback_settled
        ) || CASE WHEN state_row.kind = 'ai_autosend'
          THEN pg_catalog.jsonb_build_object('kind', 'ai_autosend') ELSE '{}'::JSONB END
        ORDER BY state_row.authorized_at, state_row.work_item_id)$n$),
  ('platform.staff_whatsapp_chat_state(uuid,uuid,integer)',
   $o$        SELECT attempt_state.*
        FROM platform_private.manual_whatsapp_send_attempt_states(
          p_organization_id,
          p_conversation_id
        ) AS attempt_state
        WHERE attempt_state.status <> 'accepted'$o$,
   $n$        SELECT attempt_state.*, kind_row.kind
        FROM platform_private.manual_whatsapp_send_attempt_states(
          p_organization_id,
          p_conversation_id
        ) AS attempt_state
        JOIN platform.manual_send_authorizations AS kind_row
          ON kind_row.organization_id = p_organization_id
         AND kind_row.id = attempt_state.manual_send_authorization_id
        WHERE attempt_state.status <> 'accepted'
          AND NOT (kind_row.kind = 'ai_autosend' AND attempt_state.attempt_id IS NULL
            AND attempt_state.status <> 'queued')$n$);

  FOR patch IN SELECT * FROM (VALUES
    ('platform.staff_whatsapp_message_page(uuid,uuid,integer,timestamp with time zone,uuid)',
      '9dca9ddb9ceb381ca8b77d2a7e6cff5a', '132bc939930d5f35afbe3125cfb764c7'),
    ('platform.staff_whatsapp_chat_state(uuid,uuid,integer)',
      'b2d7d22557725f6741c556246154058b', '37a71e29479aa40bcc952221eb744326')
  ) AS pinned(routine_signature, md5_266, md5_276) LOOP
    SELECT md5(p.prosrc) INTO installed_md5 FROM pg_catalog.pg_proc p WHERE p.oid = patch.routine_signature::REGPROCEDURE;
    IF installed_md5 = patch.md5_276 THEN
      CONTINUE;
    END IF;
    IF installed_md5 IS DISTINCT FROM patch.md5_266 THEN
      RAISE EXCEPTION 'ai_autosend_transcript_drift: % is not the definition 276 was written against',
        patch.routine_signature USING ERRCODE = '55000';
    END IF;
    definition := pg_catalog.pg_get_functiondef(patch.routine_signature::REGPROCEDURE);
    FOR fragment IN SELECT * FROM ai276_fragments f WHERE f.routine_signature = patch.routine_signature
      ORDER BY f.old_fragment LOOP
      matches := (pg_catalog.length(definition)
        - pg_catalog.length(pg_catalog.replace(definition, fragment.old_fragment, '')))
        / pg_catalog.length(fragment.old_fragment);
      IF matches IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'ai_autosend_transcript_drift: expected 1 fragment in %, found %',
          patch.routine_signature, matches USING ERRCODE = '55000';
      END IF;
      definition := pg_catalog.replace(definition, fragment.old_fragment, fragment.new_fragment);
    END LOOP;
    EXECUTE definition;
    IF (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = patch.routine_signature::REGPROCEDURE)
      IS DISTINCT FROM patch.md5_276 THEN
      RAISE EXCEPTION 'ai_autosend_transcript_patch_mismatch: %', patch.routine_signature USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$ai276_transcript$;

-- Постусловия: канонический путь не тронут, читатели остались STABLE
-- definer'ами с прежними грантами, authorize/record — только service_role.
DO $ai276_post$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('platform.request_manual_whatsapp_send_with_authorization(uuid,uuid,uuid,uuid,text,text,text,uuid)', '5a2689b4b1e7e61a6a8b5c155c5fe6a9'),
    ('platform.claim_manual_whatsapp_send_item(uuid,uuid,integer,text,uuid)', '53f27c1f3f33cbc36b554f7f01986736'),
    ('platform_private.claim_next_manual_whatsapp_send_internal(uuid,integer,text,uuid,uuid)', '2c30f5bbc507db484643357921f2ca7d'),
    ('platform_private.claim_next_manual_whatsapp_send_internal(uuid,integer,text,uuid)', '95d095c0c2023a910ff09ea5de98420a'),
    ('platform.finish_manual_whatsapp_send(uuid,uuid,uuid,uuid,platform.durable_work_finish_outcome,text,text,timestamp with time zone,uuid)', '360648359239d08ee8f0cb6b8da9f690'),
    ('platform_private.p3c_enqueue_authenticated_work(uuid,platform.durable_work_kind,uuid,uuid,text,integer,uuid,platform.durable_work_operation,uuid,uuid,text)', 'abadeb64bdccc941f80de5b3c5c3856b'),
    ('platform_private.manual_whatsapp_send_attempt_states(uuid,uuid)', 'd7c460b4fc128f6e7d78de015e215721'),
    ('platform.request_manual_whatsapp_reconciliation(uuid,uuid,uuid,uuid,text)', '2e86f7f7109c40bfad1d25100248f697'),
    ('platform_private.capture_manual_send_authority()', 'debe84f79fb2e518e2067535c57fedd5'),
    ('platform_private.guard_p3c_current_inbound_cycle()', '9518087f0a8d8d6e2f3b1d59f5f702a5'),
    ('platform.staff_whatsapp_message_page(uuid,uuid,integer,timestamp with time zone,uuid)', '132bc939930d5f35afbe3125cfb764c7'),
    ('platform.staff_whatsapp_chat_state(uuid,uuid,integer)', '37a71e29479aa40bcc952221eb744326')
  ) AS pinned(signature, expected_md5) LOOP
    IF (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = r.signature::REGPROCEDURE)
      IS DISTINCT FROM r.expected_md5 THEN
      RAISE EXCEPTION 'ai_autosend_send_path_changed: %', r.signature USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid IN ('platform.staff_whatsapp_message_page(uuid,uuid,integer,timestamp with time zone,uuid)'::REGPROCEDURE,
      'platform.staff_whatsapp_chat_state(uuid,uuid,integer)'::REGPROCEDURE)
      AND (NOT p.prosecdef OR p.provolatile <> 's' OR NOT p.proconfig @> ARRAY['search_path=""']::TEXT[]
        OR NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
        OR has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('service_role', p.oid, 'EXECUTE')))
  THEN
    RAISE EXCEPTION 'ai_autosend_transcript_acl_changed' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform' AND p.proname IN ('ai_autosend_authorize_v1', 'ai_autosend_record_v1')
      AND (NOT p.prosecdef OR NOT p.proconfig @> ARRAY['search_path=""']::TEXT[]
        OR NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
        OR has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')))
  THEN
    RAISE EXCEPTION 'ai_autosend_service_acl_drift' USING ERRCODE = '55000';
  END IF;
END
$ai276_post$;

COMMENT ON FUNCTION platform.ai_autosend_authorize_v1(UUID, UUID, TEXT, UUID) IS
  'AI agent P4: the only night-send entry point (service_role only). Re-checks the authorize column of plan §11 on the stored text, authors it as the responsible member and enqueues one manual_whatsapp_send work item; a replay of an item nobody claimed yet re-checks everything (at most 60 s after the first authorize) or takes the item off the queue; refusals are journalled, not raised.';
COMMENT ON FUNCTION platform.ai_autosend_record_v1(UUID, UUID, TEXT, TEXT, UUID) IS
  'AI agent P4: the CRM records the send outcome (service_role only); sent needs the provider binding; 463/475 or three failures in a row pause the autoresponder.';

COMMIT;
