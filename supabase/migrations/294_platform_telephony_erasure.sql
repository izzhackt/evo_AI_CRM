-- 294_platform_telephony_erasure — «Телефония Beeline KG» срез T11a: стирание
-- телефонии по человеку и очистка доказательств по сроку.
-- Контракт: docs/EVO_TELEPHONY_PLAN_2026-10-16.md §13 («Приватность и
-- юридическое»), §16 (срез T11); ADR 0033; docs/PLAN_CHANGES.md (запись
-- «Телефония T11a», она исполняет пункты 9, 14 и 20 записи «Телефония T1a»);
-- docs/runbooks/account-deletion.md, раздел «Телефония». Приёма это не включает:
-- маршрут и выключатель — срез T3, и он остаётся за EVO_PLATFORM_TELEPHONY_ENABLED=0
-- до решения ведущего агента. Расписание очистки (таймер) — отдельный срез; здесь
-- только функции, которые его будут вызывать.
--
-- Зачем (review T1a, раунд 3, P3-3). Номер клиента лежит в
-- telephony_pbx_events.fields (поле phone) в таблице «только добавление», без
-- связи с клиентом и без ключа стирания: строку нельзя ни найти по человеку, ни
-- удалить. Пункт 20 записи T1a запретил включать приём, пока в main нет ЛИБО
-- контролируемой очистки с заменой замка append-only, ЛИБО ключевой колонки
-- телефона в доказательстве. Эта миграция даёт оба.
--
-- Что делает:
--  * telephony_pbx_events.phone_match_keys — СГЕНЕРИРОВАННЫЙ столбец (STORED):
--    ключи сопоставления номера из fields ->> 'phone', построенные теми же
--    правилами, что сопоставление клиента (281, person_phone_match_keys и
--    admissions_direct_phone, плюс E.164 по правилу T1b). Номер, не читаемый как
--    телефон, и внутренний звонок (номер в доказательстве уже убран) дают пустой
--    массив. Столбец вычисляет база: ни приём T1b, ни маршрут T3 не меняются, а
--    строки, которые успели лечь раньше, получают ключи при добавлении столбца
--    (перезапись таблицы не вызывает триггеры). Только phone: diversion — номер
--    ВАТС (план §5.1), telnum — номер компании, это не данные человека.
--    Функция ключей никогда не падает (при любой неожиданности возвращает пустой
--    массив), иначе вставка доказательства могла бы потерять запрос ВАТС.
--    Ключи — те же написания номера, что уже лежат в fields (это не хэш и не
--    маска): строку по ним находят, но защитой они не служат; защита — стирание.
--  * GIN-индекс по ключам и индекс по номеру наборов (под поиск и стирание).
--  * telephony_erasure_requests — квитанция каждого стирания и метка его
--    транзакции (шаблон 280: erasure_transaction_id = pg_current_xact_id(),
--    метка снимается в конце). Номера в квитанции нет: вид стирания, кто
--    запросил, чем искали (телефон/клиент/лид), последние четыре цифры номера
--    (план §13: в журналах — последние 4 цифры), срез по сроку и число удалённых
--    строк по таблицам.
--  * platform_private.telephony_block_mutation() — свой замок «только добавление»
--    для двух таблиц (telephony_pbx_events, telephony_call_events) вместо общего
--    block_append_only_mutation. Он делает то же (UPDATE и DELETE отказаны даже
--    владельцу, тот же текст и SQLSTATE 55000), и в одном случае пропускает
--    УДАЛЕНИЕ СТРОКИ: (а) внутри транзакции удаления аккаунта по запросу (обход
--    миграции 280, как раньше) или (б) внутри стирания телефонии этой миграции:
--    GUC platform.telephony_erasure_request_id называет квитанцию, чей
--    erasure_transaction_id равен текущей транзакции, строка принадлежит
--    организации квитанции, а при очистке по сроку — только доказательство. UPDATE
--    и TRUNCATE не проходят никогда. Общий block_append_only_mutation и замки
--    остальных таблиц не меняются; триггеры TRUNCATE этих двух таблиц остаются
--    на общем замке.
--  * platform.telephony_erase_person_v1 (только service_role) — стирание по
--    человеку: звонки, ноги, хронология, выдачи на прослушивание, связи задач,
--    наборы и доказательства приёма. Ищет по телефону (ключи), клиенту и/или
--    лиду, одним вызовом, в одной транзакции; нужен названный действующий
--    системный Admin (отвечает за запрос); режим dry_run только считает. Ответ
--    несёт числа строк по таблицам и task_ids — идентификаторы задач платформы,
--    созданных по этим звонкам (после стирания связей иначе их не найти).
--  * platform.telephony_purge_evidence_v1 (только service_role) — очистка
--    доказательств приёма старше 12 месяцев (план §13), порциями; не трогает
--    доказательство, чья работа ещё не завершена (queued, leased, retry_wait).
--    Окно 12 месяцев зашито в функцию и параметром не меняется.
--
-- Что НЕ делает: метаданные звонка (звонки, ноги, хронология) по сроку не
-- удаляются — их срок хранения это DEC-012, он открыт, решения по нему здесь нет;
-- платформенные данные (клиенты, лиды, задачи, переписка, журнал действий)
-- функциями не трогаются — их стирает порядок runbook; запись в журнал действий
-- (audit_events) не пишется: добавление действия в allowlist журнала — область T2;
-- след стирания остаётся в квитанции этой миграции. Звонки, которые успели прийти ПОСЛЕ
-- стирания с того же номера, — новые данные и не стираются задним числом.
--
-- Замки: SECURITY DEFINER с search_path = ''; публичные функции — в схеме platform
-- с проверкой роли service_role внутри и EXECUTE только у service_role; все
-- platform_private.telephony_* без грантов; таблица квитанций — FORCE RLS без
-- политик и без прав клиентских ролей.
--
-- Безопасно для production: новая таблица и функции; добавлен один столбец
-- (перезапись таблицы доказательств; пока приём выключен, она пуста) и два
-- индекса; два триггера пересозданы (тот же состав событий, другая функция);
-- существующие функции и права не меняются. Номер миграции берётся первым
-- свободным при слиянии: при гонке меняются имя файла, заголовок записи
-- PLAN_CHANGES и упоминания в runbook (запись T1a, пункт 21); метки внутри файла и
-- набора (t11a) от номера не зависят.
BEGIN;

DO $t11a_preconditions$
BEGIN
  IF to_regclass('platform_private.telephony_pbx_events') IS NULL
    OR to_regclass('platform_private.telephony_event_work') IS NULL
    OR to_regclass('platform_private.telephony_calls') IS NULL
    OR to_regclass('platform_private.telephony_call_legs') IS NULL
    OR to_regclass('platform_private.telephony_call_events') IS NULL
    OR to_regclass('platform_private.telephony_recording_grants') IS NULL
    OR to_regclass('platform_private.telephony_task_links') IS NULL
    OR to_regclass('platform_private.telephony_dial_requests') IS NULL
    OR to_regprocedure('platform_private.telephony_phone_e164(text)') IS NULL
    OR to_regprocedure('platform_private.person_phone_match_keys(text)') IS NULL
    OR to_regprocedure('platform_private.account_erasure_bypass()') IS NULL
    OR to_regprocedure('platform_private.block_append_only_mutation()') IS NULL
    OR to_regprocedure('platform_private.staff_membership_identity(uuid,uuid)') IS NULL
    OR to_regclass('platform.organization_memberships') IS NULL THEN
    RAISE EXCEPTION 'telephony_t11a_requires_current_chain' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('platform_private.telephony_erasure_requests') IS NOT NULL
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = 'platform_private.telephony_pbx_events'::REGCLASS
        AND a.attname = 'phone_match_keys' AND NOT a.attisdropped)
    OR to_regprocedure('platform_private.telephony_phone_keys(text)') IS NOT NULL
    OR to_regprocedure('platform_private.telephony_block_mutation()') IS NOT NULL THEN
    RAISE EXCEPTION 'telephony_t11a_already_applied' USING ERRCODE = '55000';
  END IF;
  -- Замок доказательства и хронологии обязан быть тем, что поставила 288: ровно
  -- один строковый триггер общего замка и один триггер TRUNCATE на каждой таблице.
  IF (SELECT count(*) FROM pg_catalog.pg_trigger t
      WHERE t.tgrelid IN ('platform_private.telephony_pbx_events'::REGCLASS,
          'platform_private.telephony_call_events'::REGCLASS)
        AND NOT t.tgisinternal
        AND t.tgfoid = 'platform_private.block_append_only_mutation()'::REGPROCEDURE) <> 4 THEN
    RAISE EXCEPTION 'telephony_t11a_append_only_drift' USING ERRCODE = '55000';
  END IF;
END
$t11a_preconditions$;

-- ---------------------------------------------------------------------------
-- Ключи номера. IMMUTABLE (нужна для сгенерированного столбца) и никогда не
-- падает: любая неожиданность даёт пустой массив, потому что вычисляется внутри
-- INSERT доказательства, а доказательство хранится сначала (план §5.1).
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.telephony_phone_keys(p_value TEXT)
RETURNS TEXT[] LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE v_e164 TEXT;
BEGIN
  IF p_value IS NULL THEN
    RETURN ARRAY[]::TEXT[];
  END IF;
  v_e164 := platform_private.telephony_phone_e164(p_value);
  IF v_e164 IS NULL THEN
    RETURN ARRAY[]::TEXT[];
  END IF;
  RETURN ARRAY(
    SELECT DISTINCT k
    FROM unnest(platform_private.person_phone_match_keys(p_value)
      || platform_private.person_phone_match_keys(v_e164)) AS k
    WHERE k IS NOT NULL AND k <> ''
    ORDER BY k);
EXCEPTION WHEN OTHERS THEN
  RETURN ARRAY[]::TEXT[];
END
$$;

ALTER TABLE platform_private.telephony_pbx_events
  ADD COLUMN phone_match_keys TEXT[]
  GENERATED ALWAYS AS (platform_private.telephony_phone_keys(fields ->> 'phone')) STORED;
COMMENT ON COLUMN platform_private.telephony_pbx_events.phone_match_keys IS
  'Telephony T11a: generated match keys (spellings) of fields.phone, the same keys the client match uses. Finds evidence of one person for erasure; empty for an unreadable or internal number. Not a hash or a mask.';

CREATE INDEX telephony_pbx_events_phone_keys_idx
  ON platform_private.telephony_pbx_events USING gin (phone_match_keys);
CREATE INDEX telephony_dial_requests_phone_idx
  ON platform_private.telephony_dial_requests (organization_id, client_phone)
  WHERE client_phone IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Квитанции стирания и метка транзакции (шаблон 280).
-- ---------------------------------------------------------------------------
CREATE TABLE platform_private.telephony_erasure_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  -- Ключ идемпотентности вызывающего: повтор того же запроса отвечает прежним
  -- итогом и ничего не удаляет второй раз.
  request_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('person', 'retention')),
  -- Системный Admin, ответственный за стирание по человеку; у очистки по сроку
  -- (задание сервера) пусто.
  actor_membership_id UUID,
  by_phone BOOLEAN NOT NULL DEFAULT FALSE,
  by_client BOOLEAN NOT NULL DEFAULT FALSE,
  by_lead BOOLEAN NOT NULL DEFAULT FALSE,
  -- Последние четыре цифры номера (план §13: в журналах — последние 4 цифры).
  phone_last4 TEXT CHECK (phone_last4 ~ '^[0-9]{4}$'),
  -- Граница срока очистки: доказательство старше неё удалено.
  retention_cutoff TIMESTAMPTZ,
  -- Метка: непусто только внутри транзакции стирания (шаблон 280).
  erasure_transaction_id XID8,
  summary JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(summary) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT telephony_erasure_requests_request_key UNIQUE (organization_id, request_id),
  CONSTRAINT telephony_erasure_requests_actor_fkey FOREIGN KEY (organization_id, actor_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT telephony_erasure_requests_shape_check CHECK (
    CASE kind
      WHEN 'person' THEN actor_membership_id IS NOT NULL AND retention_cutoff IS NULL
        AND (by_phone OR by_client OR by_lead) AND (by_phone = (phone_last4 IS NOT NULL))
      ELSE actor_membership_id IS NULL AND retention_cutoff IS NOT NULL
        AND NOT by_phone AND NOT by_client AND NOT by_lead AND phone_last4 IS NULL
    END
  ),
  -- Либо стирание идёт в этой транзакции (метка есть, итога нет), либо закончено.
  CONSTRAINT telephony_erasure_requests_marker_check CHECK (
    (completed_at IS NULL) = (erasure_transaction_id IS NOT NULL)
  )
);
COMMENT ON TABLE platform_private.telephony_erasure_requests IS
  'Telephony T11a: receipt and transaction marker of every telephony erasure (by person or by evidence age). Holds no phone number, only the last four digits and row counts.';

-- ---------------------------------------------------------------------------
-- Обход замка: только удаление строки, только внутри стирания этой миграции.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.telephony_erasure_bypass(p_table TEXT, p_organization_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE marker TEXT := NULLIF(pg_catalog.current_setting('platform.telephony_erasure_request_id', TRUE), '');
BEGIN
  IF marker IS NULL OR marker !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN FALSE;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM platform_private.telephony_erasure_requests r
    WHERE r.id = marker::UUID
      AND r.erasure_transaction_id = pg_catalog.pg_current_xact_id()
      AND r.organization_id = p_organization_id
      -- Очистка по сроку удаляет только доказательство приёма, стирание по
      -- человеку — и доказательство, и хронологию.
      AND (r.kind = 'person' OR p_table = 'telephony_pbx_events')
  );
END
$$;

CREATE FUNCTION platform_private.telephony_block_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_LEVEL = 'ROW' AND TG_OP = 'DELETE' THEN
    -- 280: удаление аккаунта по запросу (одна транзакция, только удаление строки).
    IF NULLIF(pg_catalog.current_setting('platform.account_erasure_request_id', TRUE), '') IS NOT NULL
      AND platform_private.account_erasure_bypass() THEN
      RETURN OLD;
    END IF;
    -- T11a: стирание телефонии (одна транзакция, только удаление строки, только
    -- две таблицы, только организация квитанции).
    IF NULLIF(pg_catalog.current_setting('platform.telephony_erasure_request_id', TRUE), '') IS NOT NULL
      AND TG_TABLE_SCHEMA = 'platform_private'
      AND TG_TABLE_NAME IN ('telephony_pbx_events', 'telephony_call_events')
      AND platform_private.telephony_erasure_bypass(TG_TABLE_NAME, OLD.organization_id) THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'platform.% is append-only; % is forbidden', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000';
END
$$;

DROP TRIGGER telephony_pbx_events_append_only ON platform_private.telephony_pbx_events;
CREATE TRIGGER telephony_pbx_events_append_only
  BEFORE UPDATE OR DELETE ON platform_private.telephony_pbx_events
  FOR EACH ROW EXECUTE FUNCTION platform_private.telephony_block_mutation();
DROP TRIGGER telephony_call_events_append_only ON platform_private.telephony_call_events;
CREATE TRIGGER telephony_call_events_append_only
  BEFORE UPDATE OR DELETE ON platform_private.telephony_call_events
  FOR EACH ROW EXECUTE FUNCTION platform_private.telephony_block_mutation();

-- Замки таблицы квитанций: FORCE RLS без политик, права отозваны.
ALTER TABLE platform_private.telephony_erasure_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.telephony_erasure_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE platform_private.telephony_erasure_requests
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;

-- ---------------------------------------------------------------------------
-- Охват стирания по человеку: идентификаторы звонков, наборов и доказательств.
-- Ничего не меняет. Одни и те же правила для dry_run и для настоящего прогона.
--  * звонки: номер звонка среди ключей, ИЛИ клиент, ИЛИ лид, ИЛИ набор из
--    выбранных наборов;
--  * наборы: номер набора среди ключей, ИЛИ клиент, ИЛИ лид, ИЛИ набор, из
--    которого пришёл выбранный звонок;
--  * доказательства: ключи номера пересекаются с ключами человека, ИЛИ идентификатор
--    звонка доказательства совпадает с идентификатором выбранного звонка или
--    набора. Идентификатор второго звонка (second_callid) НЕ ищется: он принадлежит
--    чужому звонку, а номера в нём нет.
-- Ключи звонков и наборов в охват доказательств не добавляются: выбор по лиду
-- не должен забирать доказательства других лидов того же клиента.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.telephony_erasure_scope(
  p_organization_id UUID, p_keys TEXT[], p_client_id UUID, p_lead_id UUID
) RETURNS TABLE (s_calls UUID[], s_dials UUID[], s_events UUID[])
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  v_keys TEXT[] := COALESCE(p_keys, ARRAY[]::TEXT[]);
  v_dials0 UUID[]; v_calls UUID[]; v_dials UUID[]; v_callids TEXT[]; v_events UUID[];
BEGIN
  SELECT COALESCE(array_agg(d.id ORDER BY d.id), ARRAY[]::UUID[]) INTO v_dials0
  FROM platform_private.telephony_dial_requests d
  WHERE d.organization_id = p_organization_id
    AND ((cardinality(v_keys) > 0 AND d.client_phone = ANY (v_keys))
      OR (p_client_id IS NOT NULL AND d.client_id = p_client_id)
      OR (p_lead_id IS NOT NULL AND d.lead_id = p_lead_id));
  SELECT COALESCE(array_agg(c.id ORDER BY c.id), ARRAY[]::UUID[]) INTO v_calls
  FROM platform_private.telephony_calls c
  WHERE c.organization_id = p_organization_id
    AND ((cardinality(v_keys) > 0 AND c.client_phone = ANY (v_keys))
      OR (p_client_id IS NOT NULL AND c.client_id = p_client_id)
      OR (p_lead_id IS NOT NULL AND c.lead_id = p_lead_id)
      OR c.dial_request_id = ANY (v_dials0));
  SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), ARRAY[]::UUID[]) INTO v_dials
  FROM unnest(v_dials0 || ARRAY(
    SELECT c.dial_request_id FROM platform_private.telephony_calls c
    WHERE c.organization_id = p_organization_id AND c.id = ANY (v_calls) AND c.dial_request_id IS NOT NULL)) AS x;
  SELECT COALESCE(array_agg(DISTINCT x), ARRAY[]::TEXT[]) INTO v_callids
  FROM (
    SELECT c.pbx_callid AS x FROM platform_private.telephony_calls c
    WHERE c.organization_id = p_organization_id AND c.id = ANY (v_calls)
    UNION
    SELECT d.pbx_callid FROM platform_private.telephony_dial_requests d
    WHERE d.organization_id = p_organization_id AND d.id = ANY (v_dials) AND d.pbx_callid IS NOT NULL
  ) s;
  SELECT COALESCE(array_agg(e.id ORDER BY e.id), ARRAY[]::UUID[]) INTO v_events
  FROM platform_private.telephony_pbx_events e
  WHERE e.organization_id = p_organization_id
    AND ((cardinality(v_keys) > 0 AND e.phone_match_keys && v_keys)
      OR e.pbx_callid = ANY (v_callids));
  RETURN QUERY SELECT v_calls, v_dials, v_events;
END
$$;

-- Задачи, связанные со стираемыми звонками, клиентом или лидом: их идентификаторы
-- отдаются в ответе, потому что после стирания связей найти задачи платформы
-- (staff_tasks, в заголовке может быть имя) больше нечем. Одно правило и для
-- dry_run, и для стирания, и для счётчика.
CREATE FUNCTION platform_private.telephony_erasure_task_ids(
  p_organization_id UUID, p_calls UUID[], p_client_id UUID, p_lead_id UUID
) RETURNS UUID[] LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT COALESCE(array_agg(t.task_id ORDER BY t.task_id), ARRAY[]::UUID[])
  FROM platform_private.telephony_task_links t
  WHERE t.organization_id = p_organization_id
    AND (t.call_id = ANY (p_calls) OR t.closed_call_id = ANY (p_calls)
      OR (p_client_id IS NOT NULL AND t.client_id = p_client_id)
      OR (p_lead_id IS NOT NULL AND t.lead_id = p_lead_id))
$$;

-- Число строк по таблицам для dry_run (в настоящем прогоне считает DELETE).
CREATE FUNCTION platform_private.telephony_erasure_counts(
  p_organization_id UUID, p_calls UUID[], p_dials UUID[], p_events UUID[], p_client_id UUID, p_lead_id UUID
) RETURNS JSONB LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'task_links', cardinality(platform_private.telephony_erasure_task_ids(p_organization_id, p_calls, p_client_id, p_lead_id)),
    'recording_grants', (SELECT count(*) FROM platform_private.telephony_recording_grants g
      WHERE g.organization_id = p_organization_id
        AND g.leg_id IN (SELECT l.id FROM platform_private.telephony_call_legs l
          WHERE l.organization_id = p_organization_id AND l.call_id = ANY (p_calls))),
    'call_events', (SELECT count(*) FROM platform_private.telephony_call_events e
      WHERE e.organization_id = p_organization_id AND e.call_id = ANY (p_calls)),
    'call_legs', (SELECT count(*) FROM platform_private.telephony_call_legs l
      WHERE l.organization_id = p_organization_id AND l.call_id = ANY (p_calls)),
    'calls', (SELECT count(*) FROM platform_private.telephony_calls c
      WHERE c.organization_id = p_organization_id AND c.id = ANY (p_calls)),
    'dial_requests', (SELECT count(*) FROM platform_private.telephony_dial_requests d
      WHERE d.organization_id = p_organization_id AND d.id = ANY (p_dials)),
    'event_work', (SELECT count(*) FROM platform_private.telephony_event_work w
      WHERE w.organization_id = p_organization_id AND w.event_id = ANY (p_events)),
    'pbx_events', (SELECT count(*) FROM platform_private.telephony_pbx_events e
      WHERE e.organization_id = p_organization_id AND e.id = ANY (p_events)),
    'unlinked_calls', (SELECT count(*) FROM platform_private.telephony_calls c
      WHERE c.organization_id = p_organization_id AND c.linked_call_id = ANY (p_calls)
        AND NOT (c.id = ANY (p_calls)))
  )
$$;

-- ---------------------------------------------------------------------------
-- Стирание по человеку.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.telephony_erase_person_v1(
  p_organization_id UUID,
  p_request_id UUID,
  p_actor_membership_id UUID,
  p_phone TEXT DEFAULT NULL,
  p_client_id UUID DEFAULT NULL,
  p_lead_id UUID DEFAULT NULL,
  p_dry_run BOOLEAN DEFAULT FALSE
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_phone_given BOOLEAN := p_phone IS NOT NULL;
  v_keys TEXT[] := ARRAY[]::TEXT[];
  v_last4 TEXT;
  v_scope RECORD;
  v_receipt platform_private.telephony_erasure_requests%ROWTYPE;
  v_receipt_id UUID;
  v_counts JSONB;
  v_n BIGINT;
  v_task_links BIGINT; v_grants BIGINT; v_call_events BIGINT; v_legs BIGINT; v_calls BIGINT;
  v_dials BIGINT; v_work BIGINT; v_events BIGINT; v_unlinked BIGINT;
  v_task_ids UUID[];
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role is required' USING ERRCODE = '42501';
  END IF;
  IF p_organization_id IS NULL OR p_request_id IS NULL OR p_actor_membership_id IS NULL
    OR p_dry_run IS NULL OR NOT (v_phone_given OR p_client_id IS NOT NULL OR p_lead_id IS NOT NULL) THEN
    RAISE EXCEPTION 'telephony_erasure_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_phone_given THEN
    v_keys := platform_private.telephony_phone_keys(p_phone);
    IF cardinality(v_keys) = 0 THEN
      RAISE EXCEPTION 'telephony_erasure_phone_invalid' USING ERRCODE = '22023';
    END IF;
    v_last4 := right(platform_private.telephony_phone_e164(p_phone), 4);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform.organizations o WHERE o.id = p_organization_id) THEN
    RAISE EXCEPTION 'telephony_unknown_organization' USING ERRCODE = '22023';
  END IF;
  -- Отвечает названный действующий системный Admin этой организации.
  IF NOT EXISTS (SELECT 1 FROM platform_private.staff_membership_identity(p_organization_id, p_actor_membership_id) i
    WHERE i.system_role = 'admin') THEN
    RAISE EXCEPTION 'telephony_erasure_forbidden' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    hashtextextended('evo:telephony:erase:' || p_organization_id::TEXT, 0));

  IF NOT p_dry_run THEN
    SELECT * INTO v_receipt FROM platform_private.telephony_erasure_requests r
    WHERE r.organization_id = p_organization_id AND r.request_id = p_request_id;
    IF FOUND THEN
      IF v_receipt.kind <> 'person' OR v_receipt.actor_membership_id IS DISTINCT FROM p_actor_membership_id
        OR v_receipt.by_phone <> v_phone_given OR v_receipt.by_client <> (p_client_id IS NOT NULL)
        OR v_receipt.by_lead <> (p_lead_id IS NOT NULL) OR v_receipt.phone_last4 IS DISTINCT FROM v_last4 THEN
        RAISE EXCEPTION 'telephony_erasure_request_conflict' USING ERRCODE = '22023';
      END IF;
      RETURN jsonb_build_object('status', 'replayed', 'request_id', p_request_id, 'receipt_id', v_receipt.id,
        'counts', v_receipt.summary);
    END IF;
  END IF;

  SELECT * INTO v_scope
  FROM platform_private.telephony_erasure_scope(p_organization_id, v_keys, p_client_id, p_lead_id);

  IF p_dry_run THEN
    RETURN jsonb_build_object('status', 'dry_run', 'request_id', p_request_id,
      'counts', platform_private.telephony_erasure_counts(p_organization_id, v_scope.s_calls, v_scope.s_dials,
        v_scope.s_events, p_client_id, p_lead_id),
      'task_ids', to_jsonb(platform_private.telephony_erasure_task_ids(p_organization_id, v_scope.s_calls, p_client_id, p_lead_id)));
  END IF;

  -- Квитанция и метка транзакции; затем GUC, который читает замок.
  INSERT INTO platform_private.telephony_erasure_requests (organization_id, request_id, kind, actor_membership_id,
    by_phone, by_client, by_lead, phone_last4, erasure_transaction_id)
  VALUES (p_organization_id, p_request_id, 'person', p_actor_membership_id, v_phone_given,
    p_client_id IS NOT NULL, p_lead_id IS NOT NULL, v_last4, pg_catalog.pg_current_xact_id())
  RETURNING id INTO v_receipt_id;
  PERFORM pg_catalog.set_config('platform.telephony_erasure_request_id', v_receipt_id::TEXT, TRUE);

  -- Выбранные звонки блокируются: приём, который прямо сейчас добавляет ногу к
  -- такому звонку, дождётся конца стирания и начнёт звонок заново.
  PERFORM 1 FROM platform_private.telephony_calls c
  WHERE c.organization_id = p_organization_id AND c.id = ANY (v_scope.s_calls)
  ORDER BY c.id FOR UPDATE;

  -- Связь «переведённый звонок» (RESTRICT): у чужих звонков она обнуляется, у
  -- выбранных — тоже, чтобы порядок удаления внутри набора не имел значения.
  UPDATE platform_private.telephony_calls c SET linked_call_id = NULL
  WHERE c.organization_id = p_organization_id AND c.linked_call_id = ANY (v_scope.s_calls)
    AND NOT (c.id = ANY (v_scope.s_calls));
  GET DIAGNOSTICS v_unlinked = ROW_COUNT;
  UPDATE platform_private.telephony_calls c SET linked_call_id = NULL
  WHERE c.organization_id = p_organization_id AND c.id = ANY (v_scope.s_calls) AND c.linked_call_id IS NOT NULL;

  -- Задачи считаются после блокировки звонков: связь, которую добавляет другая
  -- транзакция к выбранному звонку, ждёт конца стирания и не успевает попасть
  -- между списком и удалением.
  v_task_ids := platform_private.telephony_erasure_task_ids(p_organization_id, v_scope.s_calls, p_client_id, p_lead_id);

  DELETE FROM platform_private.telephony_task_links t
  WHERE t.organization_id = p_organization_id AND t.task_id = ANY (v_task_ids);
  GET DIAGNOSTICS v_task_links = ROW_COUNT;
  DELETE FROM platform_private.telephony_recording_grants g
  WHERE g.organization_id = p_organization_id
    AND g.leg_id IN (SELECT l.id FROM platform_private.telephony_call_legs l
      WHERE l.organization_id = p_organization_id AND l.call_id = ANY (v_scope.s_calls));
  GET DIAGNOSTICS v_grants = ROW_COUNT;
  DELETE FROM platform_private.telephony_call_events e
  WHERE e.organization_id = p_organization_id AND e.call_id = ANY (v_scope.s_calls);
  GET DIAGNOSTICS v_call_events = ROW_COUNT;
  DELETE FROM platform_private.telephony_call_legs l
  WHERE l.organization_id = p_organization_id AND l.call_id = ANY (v_scope.s_calls);
  GET DIAGNOSTICS v_legs = ROW_COUNT;
  DELETE FROM platform_private.telephony_calls c
  WHERE c.organization_id = p_organization_id AND c.id = ANY (v_scope.s_calls);
  GET DIAGNOSTICS v_calls = ROW_COUNT;
  DELETE FROM platform_private.telephony_dial_requests d
  WHERE d.organization_id = p_organization_id AND d.id = ANY (v_scope.s_dials);
  GET DIAGNOSTICS v_dials = ROW_COUNT;
  DELETE FROM platform_private.telephony_event_work w
  WHERE w.organization_id = p_organization_id AND w.event_id = ANY (v_scope.s_events);
  GET DIAGNOSTICS v_work = ROW_COUNT;
  DELETE FROM platform_private.telephony_pbx_events e
  WHERE e.organization_id = p_organization_id AND e.id = ANY (v_scope.s_events);
  GET DIAGNOSTICS v_events = ROW_COUNT;

  PERFORM pg_catalog.set_config('platform.telephony_erasure_request_id', '', TRUE);
  v_counts := jsonb_build_object('task_links', v_task_links, 'recording_grants', v_grants,
    'call_events', v_call_events, 'call_legs', v_legs, 'calls', v_calls, 'dial_requests', v_dials,
    'event_work', v_work, 'pbx_events', v_events, 'unlinked_calls', v_unlinked);
  UPDATE platform_private.telephony_erasure_requests r SET summary = v_counts,
    completed_at = clock_timestamp(), erasure_transaction_id = NULL
  WHERE r.id = v_receipt_id;
  RETURN jsonb_build_object('status', 'erased', 'request_id', p_request_id, 'receipt_id', v_receipt_id,
    'counts', v_counts, 'task_ids', to_jsonb(v_task_ids));
END
$$;

-- ---------------------------------------------------------------------------
-- Очистка доказательств приёма старше 12 месяцев (план §13), порциями.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.telephony_purge_evidence_v1(
  p_organization_id UUID,
  p_request_id UUID,
  p_limit INTEGER DEFAULT 5000,
  p_dry_run BOOLEAN DEFAULT FALSE
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_cutoff TIMESTAMPTZ;
  v_ids UUID[]; v_has_more BOOLEAN; v_blocked BIGINT;
  v_receipt platform_private.telephony_erasure_requests%ROWTYPE;
  v_receipt_id UUID; v_work BIGINT; v_events BIGINT; v_counts JSONB;
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role is required' USING ERRCODE = '42501';
  END IF;
  IF p_organization_id IS NULL OR p_request_id IS NULL OR p_dry_run IS NULL
    OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50000 THEN
    RAISE EXCEPTION 'telephony_purge_invalid' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform.organizations o WHERE o.id = p_organization_id) THEN
    RAISE EXCEPTION 'telephony_unknown_organization' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    hashtextextended('evo:telephony:erase:' || p_organization_id::TEXT, 0));

  IF NOT p_dry_run THEN
    SELECT * INTO v_receipt FROM platform_private.telephony_erasure_requests r
    WHERE r.organization_id = p_organization_id AND r.request_id = p_request_id;
    IF FOUND THEN
      IF v_receipt.kind <> 'retention' THEN
        RAISE EXCEPTION 'telephony_purge_request_conflict' USING ERRCODE = '22023';
      END IF;
      RETURN jsonb_build_object('status', 'replayed', 'request_id', p_request_id, 'receipt_id', v_receipt.id,
        'cutoff', v_receipt.retention_cutoff, 'counts', v_receipt.summary);
    END IF;
  END IF;

  v_cutoff := pg_catalog.clock_timestamp() - INTERVAL '12 months';
  -- Доказательство, чья работа не завершена (queued, leased, retry_wait), не
  -- трогается: проекция ещё читает его. Завершённая (succeeded, dead_lettered) и
  -- отсутствующая работа не мешают.
  SELECT COALESCE(array_agg(s.id ORDER BY s.received_at, s.id), ARRAY[]::UUID[]) INTO v_ids
  FROM (
    SELECT e.id, e.received_at FROM platform_private.telephony_pbx_events e
    WHERE e.organization_id = p_organization_id AND e.received_at < v_cutoff
      AND NOT EXISTS (SELECT 1 FROM platform_private.telephony_event_work w
        WHERE w.organization_id = e.organization_id AND w.event_id = e.id
          AND w.state NOT IN ('succeeded', 'dead_lettered'))
    ORDER BY e.received_at, e.id
    LIMIT p_limit + 1
  ) s;
  v_has_more := cardinality(v_ids) > p_limit;
  IF v_has_more THEN
    v_ids := v_ids[1:p_limit];
  END IF;
  SELECT count(*) INTO v_blocked FROM platform_private.telephony_pbx_events e
  WHERE e.organization_id = p_organization_id AND e.received_at < v_cutoff
    AND EXISTS (SELECT 1 FROM platform_private.telephony_event_work w
      WHERE w.organization_id = e.organization_id AND w.event_id = e.id
        AND w.state NOT IN ('succeeded', 'dead_lettered'));

  IF p_dry_run OR cardinality(v_ids) = 0 THEN
    RETURN jsonb_build_object(
      'status', CASE WHEN p_dry_run THEN 'dry_run' ELSE 'nothing' END,
      'request_id', p_request_id, 'cutoff', v_cutoff, 'has_more', v_has_more, 'blocked_by_work', v_blocked,
      'counts', jsonb_build_object('event_work', (SELECT count(*) FROM platform_private.telephony_event_work w
          WHERE w.organization_id = p_organization_id AND w.event_id = ANY (v_ids)),
        'pbx_events', cardinality(v_ids)));
  END IF;

  INSERT INTO platform_private.telephony_erasure_requests (organization_id, request_id, kind, retention_cutoff,
    erasure_transaction_id)
  VALUES (p_organization_id, p_request_id, 'retention', v_cutoff, pg_catalog.pg_current_xact_id())
  RETURNING id INTO v_receipt_id;
  PERFORM pg_catalog.set_config('platform.telephony_erasure_request_id', v_receipt_id::TEXT, TRUE);

  DELETE FROM platform_private.telephony_event_work w
  WHERE w.organization_id = p_organization_id AND w.event_id = ANY (v_ids);
  GET DIAGNOSTICS v_work = ROW_COUNT;
  DELETE FROM platform_private.telephony_pbx_events e
  WHERE e.organization_id = p_organization_id AND e.id = ANY (v_ids);
  GET DIAGNOSTICS v_events = ROW_COUNT;

  PERFORM pg_catalog.set_config('platform.telephony_erasure_request_id', '', TRUE);
  v_counts := jsonb_build_object('event_work', v_work, 'pbx_events', v_events);
  UPDATE platform_private.telephony_erasure_requests r SET summary = v_counts,
    completed_at = clock_timestamp(), erasure_transaction_id = NULL
  WHERE r.id = v_receipt_id;
  RETURN jsonb_build_object('status', 'purged', 'request_id', p_request_id, 'receipt_id', v_receipt_id,
    'cutoff', v_cutoff, 'has_more', v_has_more, 'blocked_by_work', v_blocked, 'counts', v_counts);
END
$$;

-- ---------------------------------------------------------------------------
-- Права: частные помощники без грантов; публичные функции — только service_role.
-- ---------------------------------------------------------------------------
DO $t11a_private_acl$
DECLARE f REGPROCEDURE;
BEGIN
  FOR f IN SELECT p.oid::REGPROCEDURE FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform_private' AND p.proname LIKE 'telephony\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent', f);
  END LOOP;
END
$t11a_private_acl$;

REVOKE ALL ON FUNCTION
  platform.telephony_erase_person_v1(UUID, UUID, UUID, TEXT, UUID, UUID, BOOLEAN),
  platform.telephony_purge_evidence_v1(UUID, UUID, INTEGER, BOOLEAN)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
GRANT EXECUTE ON FUNCTION
  platform.telephony_erase_person_v1(UUID, UUID, UUID, TEXT, UUID, UUID, BOOLEAN),
  platform.telephony_purge_evidence_v1(UUID, UUID, INTEGER, BOOLEAN)
  TO service_role;

COMMENT ON FUNCTION platform.telephony_erase_person_v1(UUID, UUID, UUID, TEXT, UUID, UUID, BOOLEAN) IS
  'Telephony T11a: service-only erasure of one person''s telephony rows (calls, legs, chronology, grants, task links, dial requests, intake evidence) by phone keys, client and/or lead, in one transaction, named system Admin required. dry_run only counts. Replays by request_id.';
COMMENT ON FUNCTION platform.telephony_purge_evidence_v1(UUID, UUID, INTEGER, BOOLEAN) IS
  'Telephony T11a: service-only purge of intake evidence older than 12 months in batches; evidence whose work is still open is kept. Replays by request_id.';
COMMENT ON FUNCTION platform_private.telephony_block_mutation() IS
  'Telephony T11a: append-only guard of telephony_pbx_events and telephony_call_events. Refuses UPDATE and DELETE even for the owner; lets a row DELETE through only inside an account erasure (280) or a telephony erasure of this migration.';

-- Самопроверка: публичные функции — definer, пустой search_path, EXECUTE только у
-- service_role; помощники — без прав клиентских ролей; два строковых триггера на
-- замке телефонии, два триггера TRUNCATE на общем; квитанции закрыты.
DO $t11a_verify$
DECLARE f REGPROCEDURE; p pg_catalog.pg_proc%ROWTYPE;
BEGIN
  FOR f IN SELECT x.oid::REGPROCEDURE FROM pg_catalog.pg_proc x
    JOIN pg_catalog.pg_namespace n ON n.oid = x.pronamespace
    WHERE n.nspname = 'platform' AND x.proname LIKE 'telephony\_%' LOOP
    SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid = f;
    IF NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
      OR NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
      OR has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
      OR has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
      OR has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')
      OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) THEN
      RAISE EXCEPTION 'telephony_t11a_public_function_posture: %', f USING ERRCODE = '55000';
    END IF;
  END LOOP;
  FOR f IN SELECT x.oid::REGPROCEDURE FROM pg_catalog.pg_proc x
    JOIN pg_catalog.pg_namespace n ON n.oid = x.pronamespace
    WHERE n.nspname = 'platform_private' AND x.proname LIKE 'telephony\_%' LOOP
    SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid = f;
    IF has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
      OR has_function_privilege('service_role', p.oid, 'EXECUTE')
      OR has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
      OR has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')
      OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[] THEN
      RAISE EXCEPTION 'telephony_t11a_private_function_posture: %', f USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_catalog.pg_trigger t
      WHERE t.tgrelid IN ('platform_private.telephony_pbx_events'::REGCLASS,
          'platform_private.telephony_call_events'::REGCLASS)
        AND NOT t.tgisinternal
        AND t.tgfoid = 'platform_private.telephony_block_mutation()'::REGPROCEDURE
        AND (t.tgtype & 1) = 1) <> 2
    OR (SELECT count(*) FROM pg_catalog.pg_trigger t
      WHERE t.tgrelid IN ('platform_private.telephony_pbx_events'::REGCLASS,
          'platform_private.telephony_call_events'::REGCLASS)
        AND NOT t.tgisinternal
        AND t.tgfoid = 'platform_private.block_append_only_mutation()'::REGPROCEDURE
        AND (t.tgtype & 1) = 0) <> 2 THEN
    RAISE EXCEPTION 'telephony_t11a_trigger_posture' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c
      WHERE c.oid = 'platform_private.telephony_erasure_requests'::REGCLASS
        AND c.relrowsecurity AND c.relforcerowsecurity)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_policies
      WHERE schemaname = 'platform_private' AND tablename = 'telephony_erasure_requests')
    OR has_table_privilege('service_role', 'platform_private.telephony_erasure_requests', 'SELECT, INSERT, UPDATE, DELETE')
    OR has_table_privilege('authenticated', 'platform_private.telephony_erasure_requests', 'SELECT, INSERT, UPDATE, DELETE') THEN
    RAISE EXCEPTION 'telephony_t11a_receipts_posture' USING ERRCODE = '55000';
  END IF;
END
$t11a_verify$;

COMMIT;
