-- 316: хвосты переноса отчёта продаж и склейки клиентов 17-18.10.2026 (агентская часть).
-- docs/PLAN_CHANGES.md «2026-10-21 · Хвосты переноса отчёта продаж: стирание квитанций,
-- приём WhatsApp, журнал склейки, звонки склеенных клиентов (миграция 316)». Номер 316:
-- на origin/main 273ea8a83 последняя 312, 313-315 заняты стеком (CSCA, восстановление пароля,
-- удаление аккаунта); сверяется ещё раз перед слиянием (хуки набора привязаны к имени файла,
-- не к номеру).
--
-- Forward-only. Четыре независимые правки одной миграцией, у каждой свои якоря; новых
-- клиентских функций нет, новая служебная функция одна (только service_role). SECURITY DEFINER
-- с пустым search_path у всего нового; заменяемые тела закреплены md5 их текущего вида
-- (шаблон 303/304/312): расхождение останавливает миграцию, ничего не меняя.
--
--  a) Стирание квитанций переноса отчёта продаж. platform_private.sales_report_import_receipts
--     (304) хранит в before_state предыдущие значения строки отчёта, которую перезаписал
--     `refresh` (имя и телефон покупателя, снимок источника), и в lead_note заметку о
--     человеке; таблица «только добавление», пути стирания у неё не было (#1253 обещал его
--     «до первого переноса», перенос прошёл 18.10 без него). Путь строится по образцу T11a
--     (294) и 280, второго механизма нет:
--      * platform_private.sales_report_erasure_requests - квитанция каждого стирания и метка
--        его транзакции (erasure_transaction_id = pg_current_xact_id(), снимается в конце);
--        в ней нет имён и телефонов: Admin, чем искали (клиент, лид, строка отчёта), md5 ключей
--        поиска, числа строк;
--      * platform_private.sales_report_receipts_block_mutation() - замок «только добавление»
--        этой таблицы вместо общего block_append_only_mutation. Он делает то же (UPDATE и
--        DELETE отказаны даже владельцу, тот же текст и SQLSTATE 55000) и пропускает УДАЛЕНИЕ
--        СТРОКИ в двух случаях: внутри удаления аккаунта по запросу (обход 280, как у общего
--        замка) или внутри стирания этой миграции (GUC platform.sales_report_erasure_request_id
--        называет квитанцию, чья метка равна текущей транзакции, организация та же). UPDATE и
--        TRUNCATE не проходят никогда; триггер TRUNCATE остаётся на общем замке;
--      * platform.sales_report_erase_person_v1 (только service_role, названный системный
--        Admin отвечает за запрос, повтор по request_id, режим dry_run) - удаляет квитанции
--        человека, найденные по клиенту (с клиентами, склеенными в него), лиду и/или строке
--        отчёта, и в той же транзакции кладёт на место каждой «пустую» квитанцию того же
--        ключа (организация, источник, ссылка) без имён, заметки и before_state. Зачем: без
--        квитанции повтор того же вызова переноса прошёл бы заново и создал стёртого человека
--        из тела запроса; с пустой квитанцией тот же ключ отвечает PT409
--        `sales_report_import_request_conflict`, как при любом другом теле под этим ключом.
--        Ключ (источник, ссылка) - внешний идентификатор записи, не данные человека.
--     Что функция НЕ делает: строки самого отчёта (`sales_register`: имя заявителя, телефон,
--     суммы) не меняет и не удаляет - это учётные данные продажи, их обезличивание идёт
--     пунктом 6 runbook удаления аккаунта (отдельный проверенный шаг с разрешением владельца);
--     клиента, лид, дело, переписку, журнал действий и резервные копии не трогает. Ответ несёт
--     register_ids - идентификаторы затронутых строк отчёта, чтобы этот шаг не искать по имени.
--  b) Приём WhatsApp для человека, который уже студент. acquire_waha_canonical_identity (260)
--     получает клиента только по внешнему идентификатору чата WAHA, поэтому первый чат
--     номера, уже записанного у студента дела прямого добавления/импорта, давал НОВОГО клиента
--     (кандидат в дубли «phone») и НОВЫЙ открытый лид; передача такого лида в поступление
--     создаёт второе дело (handoff ищет дело по лиду, не по клиенту) - тот же класс, что #1198
--     (303 закрыла его для сайта). Теперь, если у номера чата ровно один клиент с делом
--     прямого добавления в работе (`pending`/`active`, source_key `admissions-direct:…`), чат
--     присоединяется к клиенту и лиду этого дела: нового клиента и лида нет, на клиенте и
--     лиде остаётся запись происхождения (`waha`, `webhook_verified`, ссылка на событие).
--     Условия узкие: у чата ещё нет клиента и лида, внешнего идентификатора этого чата ещё
--     нет, номер известен, совпал клиент одного человека. Всё остальное (незнакомый номер,
--     закрытое дело, дело из продаж, номер у двух разных людей, чат без номера) идёт прежним
--     путём. Вызов WAHA и сессии не затронуты: меняется только разбор уже принятого события.
--  c) Журнал действий. 308 пишет `client.duplicate.merge` для объекта `client`, но ни действия,
--     ни типа объекта не было в p7a_safe_audit_actions()/p7a_safe_audit_resource_types():
--     строка лежала в базе, в «Журнале действий» её не видели. Оба списка расширены приёмом
--     rename-and-union (255, 291, 302, 311); остальные функции проекции не меняются, действие
--     берёт ветку по умолчанию `['record_status']`. Приложение показывает строку словами
--     («Карточки клиента объединены», объект «Клиент»); в строке нет имён, телефонов и почт (308 пишет
--     только идентификаторы, статусы и числа).
--  d) Звонки склеенных клиентов в «Ленте» лида. Склейка (308) переносит лиды, дела и переписки
--     на выжившего клиента; звонок без лида остаётся строкой склеенного (у звонка с лидом
--     клиент следует за лидом, ON UPDATE CASCADE 288). Лента 295 берёт звонки лида и звонки
--     «клиента без лида» только по клиенту лида, поэтому звонки склеенного без лида не видел
--     никто. platform_private.client_merged_ids(организация, клиент) отдаёт клиента и всех,
--     кто склеен в него (цепочка, рекурсивно по client_aliases), и три функции, которые
--     вместе показывают звонки ленты, читают его: платформенная лента
--     telephony_lead_calls_v1 и список записей telephony_lead_recordings_v1 (295, 297) берут
--     звонки без лида всех этих клиентов; telephony_set_result_v1 (295) проверяет видимость
--     звонка склеенного клиента по лидам выжившего (resolve_canonical_client_id), иначе
--     строка из ленты не давала бы поставить результат. Права, флаги, окно результата и
--     остальные условия функций прежние; границы организации и lead.read не менялись.
--
-- Порядок выката. Приложение и миграция независимы по данным: приложение до этой правки
-- показывает строку журнала `client.duplicate.merge` как нераспознанную (`recognized:
-- false`), а не роняет страницу; приложение с новым словарём без миграции просто не получает
-- этих строк. Миграция может идти до приложения.
BEGIN;

-- ---------------------------------------------------------------------------
-- Якоря: что читается, что заменяется (md5 тел 001-312 (313-315 этих функций не меняют)), свободные имена.
-- ---------------------------------------------------------------------------
DO $a316_anchor$
BEGIN
  IF to_regclass('platform_private.sales_report_import_receipts') IS NULL
    OR to_regclass('platform_private.sales_register') IS NULL
    OR to_regclass('platform_private.client_aliases') IS NULL
    OR to_regclass('platform_private.telephony_calls') IS NULL
    OR to_regclass('platform.student_cases') IS NULL
    OR to_regclass('platform.subject_provenance') IS NULL
    OR to_regclass('platform.external_identifiers') IS NULL
    OR to_regclass('platform.organization_memberships') IS NULL
    OR to_regprocedure('platform_private.block_append_only_mutation()') IS NULL
    OR to_regprocedure('platform_private.account_erasure_bypass()') IS NULL
    OR to_regprocedure('platform_private.staff_membership_identity(uuid,uuid)') IS NULL
    OR to_regprocedure('platform_private.resolve_canonical_client_id(uuid,uuid)') IS NULL
    OR to_regprocedure('platform_private.person_phone_match_keys(text)') IS NULL
    OR to_regprocedure('platform_private.p7a_safe_audit_actions()') IS NULL
    OR to_regprocedure('platform_private.p7a_safe_audit_resource_types()') IS NULL
    OR to_regprocedure('platform.import_sales_report_row_v1(uuid,uuid,text,text,jsonb,text)') IS NULL
  THEN
    RAISE EXCEPTION 'a316_anchor_drift: the 304 / 308 / 295 objects this migration builds on are missing' USING ERRCODE = '55000';
  END IF;
  -- 304: the receipts table carries the general lock (one row trigger, one TRUNCATE trigger).
  IF (SELECT count(*) FROM pg_catalog.pg_trigger t
      WHERE t.tgrelid = 'platform_private.sales_report_import_receipts'::regclass AND NOT t.tgisinternal
        AND t.tgfoid = 'platform_private.block_append_only_mutation()'::regprocedure) <> 2 THEN
    RAISE EXCEPTION 'a316_anchor_drift: sales_report_import_receipts lost its append-only triggers' USING ERRCODE = '55000';
  END IF;
  -- The bodies this migration edits by fragment are exactly the ones it was written against.
  IF (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p
      WHERE p.oid = to_regprocedure('platform_private.acquire_waha_canonical_identity(uuid,uuid,uuid,uuid)'))
        IS DISTINCT FROM '35b7c27c3928a6d8e1c2292c8fa729ad' THEN
    RAISE EXCEPTION 'a316_anchor_drift: platform_private.acquire_waha_canonical_identity is not the 260 definition' USING ERRCODE = '55000';
  END IF;
  IF (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p
      WHERE p.oid = to_regprocedure('platform.telephony_lead_calls_v1(uuid,uuid,integer,timestamptz,timestamptz)'))
        IS DISTINCT FROM '9712f599f0f7352ff04cbdb330e20ed2' THEN
    RAISE EXCEPTION 'a316_anchor_drift: platform.telephony_lead_calls_v1 is not the 295 definition' USING ERRCODE = '55000';
  END IF;
  IF (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p
      WHERE p.oid = to_regprocedure('platform.telephony_set_result_v1(uuid,uuid,text,date)'))
        IS DISTINCT FROM '407209bd70b8f1cf55082a32cc62c067' THEN
    RAISE EXCEPTION 'a316_anchor_drift: platform.telephony_set_result_v1 is not the 295 definition' USING ERRCODE = '55000';
  END IF;
  IF (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p
      WHERE p.oid = to_regprocedure('platform.telephony_lead_recordings_v1(uuid,uuid,uuid[])'))
        IS DISTINCT FROM 'ee2782776dd9cf8ab1b21ae22238141f' THEN
    RAISE EXCEPTION 'a316_anchor_drift: platform.telephony_lead_recordings_v1 is not the 297 definition' USING ERRCODE = '55000';
  END IF;
  -- Nothing of this migration exists yet.
  IF to_regclass('platform_private.sales_report_erasure_requests') IS NOT NULL
    OR to_regprocedure('platform.sales_report_erase_person_v1(uuid,uuid,uuid,uuid,uuid,uuid,boolean)') IS NOT NULL
    OR to_regprocedure('platform_private.sales_report_receipts_block_mutation()') IS NOT NULL
    OR to_regprocedure('platform_private.client_merged_ids(uuid,uuid)') IS NOT NULL
    OR to_regprocedure('platform_private.p7a_safe_audit_actions_pre_sales_import_tails()') IS NOT NULL
    OR 'client.duplicate.merge' = ANY (platform_private.p7a_safe_audit_actions())
    OR 'client' = ANY (platform_private.p7a_safe_audit_resource_types())
  THEN
    RAISE EXCEPTION 'a316_already_applied' USING ERRCODE = '55000';
  END IF;
END
$a316_anchor$;

-- Замена проверяемых фрагментов внутри тела (шаблон 173/244/281/303/304): каждый фрагмент
-- обязан встретиться ровно один раз, иначе миграция откатывается целиком; новое тело
-- выполняется один раз, после всех замен (промежуточное тело может быть невалидным).
CREATE FUNCTION pg_temp.a316_replace(p_signature TEXT, p_olds TEXT[], p_news TEXT[])
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE body TEXT; matches INTEGER; i INTEGER;
BEGIN
  body := pg_get_functiondef(to_regprocedure(p_signature));
  IF body IS NULL OR cardinality(p_olds) IS DISTINCT FROM cardinality(p_news) THEN
    RAISE EXCEPTION 'a316_replace_drift: % has no definition or a malformed patch', p_signature;
  END IF;
  FOR i IN 1 .. cardinality(p_olds) LOOP
    matches := (length(body) - length(replace(body, p_olds[i], ''))) / length(p_olds[i]);
    IF matches IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'a316_replace_drift: % fragment % expected 1, found %', p_signature, i, matches;
    END IF;
    body := replace(body, p_olds[i], p_news[i]);
  END LOOP;
  EXECUTE body;
END $$;

-- ---------------------------------------------------------------------------
-- d0) Клиент и все, кто склеен в него (цепочка склеек), одним массивом.
-- ---------------------------------------------------------------------------
-- Рекурсия идёт от выжившего вниз по client_aliases (индекс client_aliases_canonical_idx).
-- Клиента, которого нет в организации, функция не придумывает: пустой массив.
CREATE FUNCTION platform_private.client_merged_ids(p_organization_id UUID, p_client_id UUID)
RETURNS UUID[] LANGUAGE sql STABLE SET search_path = '' AS $$
  WITH RECURSIVE merged(client_id) AS (
    SELECT c.id FROM platform.clients c WHERE c.organization_id = p_organization_id AND c.id = p_client_id
    UNION
    SELECT a.superseded_client_id
    FROM merged m
    JOIN platform_private.client_aliases a
      ON a.organization_id = p_organization_id AND a.canonical_client_id = m.client_id
  )
  SELECT COALESCE(array_agg(m.client_id ORDER BY m.client_id), ARRAY[]::UUID[]) FROM merged m
$$;
REVOKE ALL ON FUNCTION platform_private.client_merged_ids(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
COMMENT ON FUNCTION platform_private.client_merged_ids(UUID, UUID) IS
  'Migration 316: the client and every client merged into it (recursive over client_aliases) as one array; empty when the client is not in the organization. Private; read by the lead call feed and the receipt erasure.';

-- ---------------------------------------------------------------------------
-- a) Стирание квитанций переноса отчёта продаж
-- ---------------------------------------------------------------------------
CREATE TABLE platform_private.sales_report_erasure_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  -- Ключ идемпотентности вызывающего: повтор того же запроса отвечает прежним итогом и
  -- ничего не удаляет второй раз.
  request_id UUID NOT NULL,
  -- Системный Admin, ответственный за стирание.
  actor_membership_id UUID NOT NULL,
  by_client BOOLEAN NOT NULL DEFAULT FALSE,
  by_lead BOOLEAN NOT NULL DEFAULT FALSE,
  by_register BOOLEAN NOT NULL DEFAULT FALSE,
  -- md5 от ключей поиска (идентификаторы, не данные человека): тот же request_id с другим
  -- клиентом, лидом или строкой отказывается, а не отвечает чужим итогом.
  params_md5 TEXT NOT NULL CHECK (params_md5 ~ '^[0-9a-f]{32}$'),
  -- Метка: непусто только внутри транзакции стирания (шаблон 280 / 294).
  erasure_transaction_id XID8,
  summary JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(summary) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT sales_report_erasure_requests_request_key UNIQUE (organization_id, request_id),
  CONSTRAINT sales_report_erasure_requests_actor_fkey FOREIGN KEY (organization_id, actor_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT sales_report_erasure_requests_shape_check CHECK (by_client OR by_lead OR by_register),
  -- Либо стирание идёт в этой транзакции (метка есть, итога нет), либо закончено.
  CONSTRAINT sales_report_erasure_requests_marker_check CHECK ((completed_at IS NULL) = (erasure_transaction_id IS NOT NULL))
);
ALTER TABLE platform_private.sales_report_erasure_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.sales_report_erasure_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE platform_private.sales_report_erasure_requests
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
COMMENT ON TABLE platform_private.sales_report_erasure_requests IS
  'Migration 316: receipt and transaction marker of every erasure of sales-report import receipts by person. Holds no name, phone or note: the Admin, what was searched by (client, lead, report row), an md5 of the search keys and row counts. Backend only.';

-- Обход замка: только удаление строки, только внутри стирания этой миграции, только
-- организация квитанции стирания.
CREATE FUNCTION platform_private.sales_report_erasure_bypass(p_organization_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE marker TEXT := NULLIF(pg_catalog.current_setting('platform.sales_report_erasure_request_id', TRUE), '');
BEGIN
  IF marker IS NULL OR marker !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN FALSE;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM platform_private.sales_report_erasure_requests r
    WHERE r.id = marker::UUID
      AND r.erasure_transaction_id = pg_catalog.pg_current_xact_id()
      AND r.organization_id = p_organization_id
  );
END
$$;
REVOKE ALL ON FUNCTION platform_private.sales_report_erasure_bypass(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;

-- Свой замок «только добавление» для таблицы квитанций вместо общего (шаблон 294): то же
-- сообщение и тот же SQLSTATE; единственное отличие - стирание этой миграции.
CREATE FUNCTION platform_private.sales_report_receipts_block_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_LEVEL = 'ROW' AND TG_OP = 'DELETE' THEN
    -- 280: удаление аккаунта по запросу (одна транзакция, только удаление строки).
    IF NULLIF(pg_catalog.current_setting('platform.account_erasure_request_id', TRUE), '') IS NOT NULL
      AND platform_private.account_erasure_bypass() THEN
      RETURN OLD;
    END IF;
    -- 316: стирание квитанций переноса отчёта продаж (одна транзакция, только удаление
    -- строки, только эта таблица, только организация квитанции стирания).
    IF NULLIF(pg_catalog.current_setting('platform.sales_report_erasure_request_id', TRUE), '') IS NOT NULL
      AND TG_TABLE_SCHEMA = 'platform_private'
      AND TG_TABLE_NAME = 'sales_report_import_receipts'
      AND platform_private.sales_report_erasure_bypass(OLD.organization_id) THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'platform.% is append-only; % is forbidden', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000';
END
$$;
REVOKE ALL ON FUNCTION platform_private.sales_report_receipts_block_mutation()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;

DROP TRIGGER sales_report_import_receipts_append_only ON platform_private.sales_report_import_receipts;
CREATE TRIGGER sales_report_import_receipts_append_only
  BEFORE UPDATE OR DELETE ON platform_private.sales_report_import_receipts
  FOR EACH ROW EXECUTE FUNCTION platform_private.sales_report_receipts_block_mutation();

-- Охват стирания по человеку: строки отчёта и квитанции. Ничего не меняет. Одно правило и
-- для dry_run, и для настоящего прогона.
--  * клиенты: клиент, в которого превратился названный (если названного склеили в другого),
--    и все, кто склеен в него;
--  * лиды: лиды этих клиентов и названный лид;
--  * строки отчёта: названная, а также связанные с этими лидами (`linked_lead_id`), заведённые
--    на них (`lead_id`) или на этих клиентов (`client_id`);
--  * квитанции: у которых запись отчёта среди выбранных, ИЛИ в итоге вызова стоят выбранный
--    лид (`lead_id`, `linked_lead_id`) или клиент (`client_id`). Квитанция идентифицируется
--    порядковым номером receipt_seq (identity), составной ключ у неё общий с повтором.
CREATE FUNCTION platform_private.sales_report_erasure_scope(
  p_organization_id UUID, p_client_id UUID, p_lead_id UUID, p_register_id UUID
) RETURNS TABLE (s_registers UUID[], s_receipts BIGINT[])
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  -- The named client may itself be one merged away: the search starts from the client it became.
  v_canonical UUID := CASE WHEN p_client_id IS NULL THEN NULL
    ELSE COALESCE(platform_private.resolve_canonical_client_id(p_organization_id, p_client_id), p_client_id) END;
  v_clients UUID[] := CASE WHEN v_canonical IS NULL THEN ARRAY[]::UUID[]
    ELSE platform_private.client_merged_ids(p_organization_id, v_canonical) END;
  v_leads UUID[]; v_registers UUID[]; v_receipts BIGINT[];
BEGIN
  SELECT COALESCE(array_agg(DISTINCT s.x ORDER BY s.x), ARRAY[]::UUID[]) INTO v_leads
  FROM (
    SELECT l.id AS x FROM platform.leads l
    WHERE l.organization_id = p_organization_id AND l.client_id = ANY (v_clients)
    UNION
    SELECT p_lead_id WHERE p_lead_id IS NOT NULL
  ) s;
  SELECT COALESCE(array_agg(DISTINCT r.id ORDER BY r.id), ARRAY[]::UUID[]) INTO v_registers
  FROM platform_private.sales_register r
  WHERE r.organization_id = p_organization_id
    AND (r.id = p_register_id
      OR r.linked_lead_id = ANY (v_leads)
      OR r.lead_id = ANY (v_leads)
      OR r.client_id = ANY (v_clients));
  SELECT COALESCE(array_agg(x.receipt_seq ORDER BY x.receipt_seq), ARRAY[]::BIGINT[]) INTO v_receipts
  FROM platform_private.sales_report_import_receipts x
  WHERE x.organization_id = p_organization_id
    AND (x.register_id = ANY (v_registers)
      OR (x.result ->> 'lead_id') = ANY (v_leads::TEXT[])
      OR (x.result ->> 'linked_lead_id') = ANY (v_leads::TEXT[])
      OR (x.result ->> 'client_id') = ANY (v_clients::TEXT[]));
  RETURN QUERY SELECT v_registers, v_receipts;
END
$$;
REVOKE ALL ON FUNCTION platform_private.sales_report_erasure_scope(UUID, UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;

-- Что лежит в выбранных квитанциях: число строк и сколько из них несут то, ради чего
-- стирание нужно (прежние значения строки отчёта и заметку о человеке).
CREATE FUNCTION platform_private.sales_report_erasure_counts(p_organization_id UUID, p_receipts BIGINT[])
RETURNS JSONB LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'receipts', count(*),
    'with_before_state', count(*) FILTER (WHERE x.before_state <> '{}'::JSONB),
    'with_lead_note', count(*) FILTER (WHERE x.lead_note IS NOT NULL))
  FROM platform_private.sales_report_import_receipts x
  WHERE x.organization_id = p_organization_id AND x.receipt_seq = ANY (p_receipts)
$$;
REVOKE ALL ON FUNCTION platform_private.sales_report_erasure_counts(UUID, BIGINT[])
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;

CREATE FUNCTION platform.sales_report_erase_person_v1(
  p_organization_id UUID,
  p_request_id UUID,
  p_actor_membership_id UUID,
  p_client_id UUID DEFAULT NULL,
  p_lead_id UUID DEFAULT NULL,
  p_register_id UUID DEFAULT NULL,
  p_dry_run BOOLEAN DEFAULT FALSE
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_claims JSONB := NULLIF(current_setting('request.jwt.claims', TRUE), '')::JSONB;
  v_params TEXT;
  v_scope RECORD;
  v_receipt platform_private.sales_report_erasure_requests%ROWTYPE;
  v_receipt_id UUID;
  v_counts JSONB;
  v_keys JSONB;
  v_deleted BIGINT;
  v_tombs BIGINT;
BEGIN
  -- Служебный путь: ключ service role без пользователя (как 294 и 304).
  IF (v_claims ->> 'role') IS DISTINCT FROM 'service_role' OR (v_claims ->> 'sub') IS NOT NULL THEN
    RAISE EXCEPTION 'Service role is required' USING ERRCODE = '42501';
  END IF;
  IF p_organization_id IS NULL OR p_request_id IS NULL OR p_actor_membership_id IS NULL OR p_dry_run IS NULL
    OR (p_client_id IS NULL AND p_lead_id IS NULL AND p_register_id IS NULL) THEN
    RAISE EXCEPTION 'sales_report_erasure_invalid' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform.organizations o WHERE o.id = p_organization_id) THEN
    RAISE EXCEPTION 'sales_report_erasure_unknown_organization' USING ERRCODE = '22023';
  END IF;
  -- Отвечает названный действующий системный Admin этой организации.
  IF NOT EXISTS (SELECT 1 FROM platform_private.staff_membership_identity(p_organization_id, p_actor_membership_id) i
    WHERE i.system_role = 'admin') THEN
    RAISE EXCEPTION 'sales_report_erasure_forbidden' USING ERRCODE = '42501';
  END IF;

  v_params := md5(COALESCE(p_client_id::TEXT, '-') || ':' || COALESCE(p_lead_id::TEXT, '-') || ':'
    || COALESCE(p_register_id::TEXT, '-'));
  -- Одна очередь со вводом переноса: его замок реестра отчёта (134, 253, 254, 304) держит
  -- вызов от первой записи до конца, поэтому перенос и стирание не идут вперемешку.
  PERFORM pg_advisory_xact_lock(hashtextextended('sales-register:' || p_organization_id::TEXT, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('evo:sales-report:erase:' || p_organization_id::TEXT, 0));

  IF NOT p_dry_run THEN
    SELECT * INTO v_receipt FROM platform_private.sales_report_erasure_requests r
    WHERE r.organization_id = p_organization_id AND r.request_id = p_request_id;
    IF FOUND THEN
      IF v_receipt.actor_membership_id IS DISTINCT FROM p_actor_membership_id
        OR v_receipt.by_client <> (p_client_id IS NOT NULL) OR v_receipt.by_lead <> (p_lead_id IS NOT NULL)
        OR v_receipt.by_register <> (p_register_id IS NOT NULL) OR v_receipt.params_md5 <> v_params THEN
        RAISE EXCEPTION 'sales_report_erasure_request_conflict' USING ERRCODE = '22023';
      END IF;
      RETURN jsonb_build_object('status', 'replayed', 'request_id', p_request_id, 'receipt_id', v_receipt.id,
        'counts', v_receipt.summary -> 'counts', 'register_ids', v_receipt.summary -> 'register_ids');
    END IF;
  END IF;

  SELECT * INTO v_scope
  FROM platform_private.sales_report_erasure_scope(p_organization_id, p_client_id, p_lead_id, p_register_id);
  v_counts := platform_private.sales_report_erasure_counts(p_organization_id, v_scope.s_receipts);

  IF p_dry_run THEN
    RETURN jsonb_build_object('status', 'dry_run', 'request_id', p_request_id, 'counts', v_counts,
      'register_ids', to_jsonb(v_scope.s_registers));
  END IF;

  -- Квитанция и метка транзакции; затем GUC, который читает замок.
  INSERT INTO platform_private.sales_report_erasure_requests (organization_id, request_id, actor_membership_id,
    by_client, by_lead, by_register, params_md5, erasure_transaction_id)
  VALUES (p_organization_id, p_request_id, p_actor_membership_id, p_client_id IS NOT NULL, p_lead_id IS NOT NULL,
    p_register_id IS NOT NULL, v_params, pg_catalog.pg_current_xact_id())
  RETURNING id INTO v_receipt_id;
  PERFORM pg_catalog.set_config('platform.sales_report_erasure_request_id', v_receipt_id::TEXT, TRUE);

  -- Ключи стираемых квитанций (они нужны, чтобы оставить на их месте пустые).
  SELECT COALESCE(jsonb_agg(jsonb_build_object('s', x.import_source, 'r', x.external_ref) ORDER BY x.receipt_seq), '[]'::JSONB)
  INTO v_keys
  FROM platform_private.sales_report_import_receipts x
  WHERE x.organization_id = p_organization_id AND x.receipt_seq = ANY (v_scope.s_receipts);

  DELETE FROM platform_private.sales_report_import_receipts x
  WHERE x.organization_id = p_organization_id AND x.receipt_seq = ANY (v_scope.s_receipts);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  PERFORM pg_catalog.set_config('platform.sales_report_erasure_request_id', '', TRUE);
  IF v_deleted <> jsonb_array_length(v_keys) THEN
    RAISE EXCEPTION 'sales_report_erasure_scope_changed' USING ERRCODE = '55000';
  END IF;

  -- Пустая квитанция на месте каждой: тот же ключ (организация, источник, ссылка), актёр
  -- стирания, md5 которого не совпадёт ни с каким телом запроса, и ни имени, ни заметки,
  -- ни прежних значений. Повтор переноса под этим ключом отвечает PT409, а не создаёт
  -- стёртого человека заново.
  INSERT INTO platform_private.sales_report_import_receipts (organization_id, import_source, external_ref,
    actor_membership_id, payload_md5, register_id, register_version, lead_note, result, before_state)
  SELECT p_organization_id, k.s, k.r, p_actor_membership_id, md5('sales-report-erased:' || k.s || ':' || k.r),
    NULL, NULL, NULL,
    jsonb_build_object('status', 'erased', 'import_source', k.s, 'external_ref', k.r), '{}'::JSONB
  FROM jsonb_to_recordset(v_keys) AS k(s TEXT, r TEXT);
  GET DIAGNOSTICS v_tombs = ROW_COUNT;

  v_counts := v_counts || jsonb_build_object('erased_empty_receipts', v_tombs);
  UPDATE platform_private.sales_report_erasure_requests r
  SET summary = jsonb_build_object('counts', v_counts, 'register_ids', to_jsonb(v_scope.s_registers)),
    completed_at = clock_timestamp(), erasure_transaction_id = NULL
  WHERE r.id = v_receipt_id;
  RETURN jsonb_build_object('status', 'erased', 'request_id', p_request_id, 'receipt_id', v_receipt_id,
    'counts', v_counts, 'register_ids', to_jsonb(v_scope.s_registers));
END
$$;
REVOKE ALL ON FUNCTION platform.sales_report_erase_person_v1(UUID, UUID, UUID, UUID, UUID, UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
GRANT EXECUTE ON FUNCTION platform.sales_report_erase_person_v1(UUID, UUID, UUID, UUID, UUID, UUID, BOOLEAN) TO service_role;
COMMENT ON FUNCTION platform.sales_report_erase_person_v1(UUID, UUID, UUID, UUID, UUID, UUID, BOOLEAN) IS
  'Migration 316: service-only erasure of the sales-report import receipts of one person (by client with the clients merged into it, lead and/or report row), one transaction, a named system Admin answers for it, replay by request_id, dry_run counts only. Deletes the receipts and leaves an empty receipt of the same key (no name, note or previous values) so a repeated import call is refused (PT409) instead of recreating the person. The report rows themselves (sales_register) and every other table are not touched.';

-- ---------------------------------------------------------------------------
-- b) Приём WhatsApp: номер студента прямого дела присоединяется к его клиенту и лиду
-- ---------------------------------------------------------------------------
SELECT pg_temp.a316_replace(
  'platform_private.acquire_waha_canonical_identity(uuid,uuid,uuid,uuid)',
  ARRAY[
    $old$  lead_owner_membership_id UUID;
BEGIN$old$,
    $old$  source_ref := 'waha-event:' || source_event.id::TEXT;

  resolved_client_id := platform_private.create_or_link_client($old$,
    $old$    source_ref
  );

  IF (
    conversation.canonical_client_id IS NOT NULL$old$
  ],
  ARRAY[
    $new$  lead_owner_membership_id UUID;
  direct_case_persons INTEGER;
  direct_client_id UUID;
  direct_lead_id UUID;
BEGIN$new$,
    $new$  source_ref := 'waha-event:' || source_event.id::TEXT;

  -- 316: the number of a person who is already an admissions student. create_or_link_client
  -- finds a client only by this chat's own external identity, so the first chat of such a
  -- number made a new client (a «phone» duplicate candidate) and a new open sales lead, and
  -- handing that lead off would open a second case (handoff_lead_to_admissions finds a case
  -- by the lead, not by the client: the same class as #1198, closed for the website by 303).
  -- When the chat has no identity yet and the number belongs to exactly one person with a
  -- direct-admissions case (the add-a-student button or the import) in work, the chat joins
  -- that person's client and the lead of that case; nothing new is opened. Everything else
  -- (an unknown number, a closed case, a case that came through sales, a number shared by two
  -- people, a chat without a number) takes the old path unchanged.
  IF phone_digits IS NOT NULL
    AND conversation.canonical_client_id IS NULL
    AND conversation.canonical_lead_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM platform.external_identifiers AS known
      WHERE known.organization_id = binding.organization_id
        AND known.source_system = 'waha'
        AND known.external_object_type = 'direct_chat'
        AND known.external_identifier = external_identity
    )
  THEN
    SELECT count(DISTINCT case_lead.client_id)::INTEGER,
      (array_agg(case_lead.client_id ORDER BY direct_case.created_at DESC, direct_case.id))[1],
      (array_agg(direct_case.canonical_lead_id ORDER BY direct_case.created_at DESC, direct_case.id))[1]
    INTO direct_case_persons, direct_client_id, direct_lead_id
    FROM platform.student_cases AS direct_case
    JOIN platform.leads AS case_lead
      ON case_lead.organization_id = direct_case.organization_id
      AND case_lead.id = direct_case.canonical_lead_id
    JOIN platform.clients AS case_person
      ON case_person.organization_id = case_lead.organization_id
      AND case_person.id = case_lead.client_id
    WHERE direct_case.organization_id = binding.organization_id
      AND direct_case.state IN ('pending', 'active')
      AND direct_case.source_key LIKE 'admissions-direct:%'
      AND case_person.lifecycle_state = 'active'
      AND case_person.normalized_phone = ANY (platform_private.person_phone_match_keys('+' || phone_digits));
    IF direct_case_persons IS DISTINCT FROM 1 THEN
      direct_client_id := NULL;
      direct_lead_id := NULL;
    END IF;
  END IF;

  IF direct_lead_id IS NULL THEN
  resolved_client_id := platform_private.create_or_link_client($new$,
    $new$    source_ref
  );
  ELSE
    resolved_client_id := direct_client_id;
    resolved_lead_id := direct_lead_id;
    -- The same trace the canonical path leaves on every repeat: a WhatsApp message was seen
    -- for this person (the event is named in the reference).
    INSERT INTO platform.subject_provenance (
      organization_id, client_id, source_system, evidence_type, observed_at, imported_at, source_ref
    ) VALUES (
      binding.organization_id, resolved_client_id, 'waha', 'webhook_verified',
      source_event.provider_occurred_at, NULL, source_ref
    );
    INSERT INTO platform.subject_provenance (
      organization_id, lead_id, source_system, evidence_type, observed_at, imported_at, source_ref
    ) VALUES (
      binding.organization_id, resolved_lead_id, 'waha', 'webhook_verified',
      source_event.provider_occurred_at, NULL, source_ref
    );
  END IF;

  IF (
    conversation.canonical_client_id IS NOT NULL$new$
  ]);

-- ---------------------------------------------------------------------------
-- c) «Журнал действий»: склейка клиентов видна (rename-and-union)
-- ---------------------------------------------------------------------------
ALTER FUNCTION platform_private.p7a_safe_audit_actions()
  RENAME TO p7a_safe_audit_actions_pre_sales_import_tails;
CREATE FUNCTION platform_private.p7a_safe_audit_actions()
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.array_agg(DISTINCT allowed.action ORDER BY allowed.action)
  FROM pg_catalog.unnest(
    platform_private.p7a_safe_audit_actions_pre_sales_import_tails()
      || ARRAY[
    'client.duplicate.merge'
      ]::TEXT[]
  ) AS allowed(action)
$$;

ALTER FUNCTION platform_private.p7a_safe_audit_resource_types()
  RENAME TO p7a_safe_audit_resource_types_pre_sales_import_tails;
CREATE FUNCTION platform_private.p7a_safe_audit_resource_types()
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.array_agg(DISTINCT allowed.resource_type ORDER BY allowed.resource_type)
  FROM pg_catalog.unnest(
    platform_private.p7a_safe_audit_resource_types_pre_sales_import_tails()
      || ARRAY[
    'client'
      ]::TEXT[]
  ) AS allowed(resource_type)
$$;

REVOKE ALL ON FUNCTION
  platform_private.p7a_safe_audit_actions_pre_sales_import_tails(),
  platform_private.p7a_safe_audit_actions(),
  platform_private.p7a_safe_audit_resource_types_pre_sales_import_tails(),
  platform_private.p7a_safe_audit_resource_types()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- d) Звонки склеенных клиентов в «Ленте» лида
-- ---------------------------------------------------------------------------
SELECT pg_temp.a316_replace(
  'platform.telephony_lead_calls_v1(uuid,uuid,integer,timestamptz,timestamptz)',
  ARRAY[$old$AND (c.lead_id = p_lead_id OR (c.lead_id IS NULL AND c.client_id = v_client))$old$],
  ARRAY[$new$AND (c.lead_id = p_lead_id OR (c.lead_id IS NULL
        AND c.client_id = ANY (platform_private.client_merged_ids(p_organization_id, v_client))))$new$]);

SELECT pg_temp.a316_replace(
  'platform.telephony_lead_recordings_v1(uuid,uuid,uuid[])',
  ARRAY[$old$AND (c.lead_id = p_lead_id OR (c.lead_id IS NULL AND c.client_id = v_client))$old$],
  ARRAY[$new$AND (c.lead_id = p_lead_id OR (c.lead_id IS NULL
        AND c.client_id = ANY (platform_private.client_merged_ids(p_organization_id, v_client))))$new$]);

SELECT pg_temp.a316_replace(
  'platform.telephony_set_result_v1(uuid,uuid,text,date)',
  ARRAY[$old$AND l.client_id = v_call.client_id$old$],
  ARRAY[$new$AND l.client_id = platform_private.resolve_canonical_client_id(p_organization_id, v_call.client_id)$new$]);

-- ---------------------------------------------------------------------------
-- Проверка в конце: объекты на месте, права ровно такие, как задумано.
-- ---------------------------------------------------------------------------
DO $a316_verify$
DECLARE
  f pg_catalog.pg_proc%ROWTYPE;
  r TEXT;
BEGIN
  -- a) the erasure: closed table, closed helpers, service_role-only entry point, the new lock.
  SELECT p.* INTO f FROM pg_catalog.pg_proc p
  WHERE p.oid = 'platform.sales_report_erase_person_v1(uuid,uuid,uuid,uuid,uuid,uuid,boolean)'::regprocedure;
  IF NOT f.prosecdef OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
    OR NOT has_function_privilege('service_role', f.oid, 'EXECUTE')
    OR has_function_privilege('authenticated', f.oid, 'EXECUTE')
    OR has_function_privilege('anon', f.oid, 'EXECUTE')
    OR has_function_privilege('public', f.oid, 'EXECUTE')
    OR has_table_privilege('service_role', 'platform_private.sales_report_erasure_requests', 'SELECT')
    OR has_table_privilege('authenticated', 'platform_private.sales_report_erasure_requests', 'SELECT')
    OR NOT (SELECT c.relforcerowsecurity FROM pg_catalog.pg_class c
      WHERE c.oid = 'platform_private.sales_report_erasure_requests'::regclass)
    OR (SELECT count(*) FROM pg_catalog.pg_trigger t
      WHERE t.tgrelid = 'platform_private.sales_report_import_receipts'::regclass AND NOT t.tgisinternal
        AND t.tgfoid = 'platform_private.sales_report_receipts_block_mutation()'::regprocedure) <> 1
    OR (SELECT count(*) FROM pg_catalog.pg_trigger t
      WHERE t.tgrelid = 'platform_private.sales_report_import_receipts'::regclass AND NOT t.tgisinternal
        AND t.tgfoid = 'platform_private.block_append_only_mutation()'::regprocedure) <> 1
  THEN
    RAISE EXCEPTION 'a316_verify_erasure' USING ERRCODE = '55000';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'supabase_auth_admin', 'evo_ai_agent'] LOOP
    IF has_function_privilege(r, 'platform_private.sales_report_erasure_bypass(uuid)', 'EXECUTE')
      OR has_function_privilege(r, 'platform_private.sales_report_receipts_block_mutation()', 'EXECUTE')
      OR has_function_privilege(r, 'platform_private.sales_report_erasure_scope(uuid,uuid,uuid,uuid)', 'EXECUTE')
      OR has_function_privilege(r, 'platform_private.sales_report_erasure_counts(uuid,bigint[])', 'EXECUTE')
      OR has_function_privilege(r, 'platform_private.client_merged_ids(uuid,uuid)', 'EXECUTE')
    THEN
      RAISE EXCEPTION 'a316_verify_helper_acl: %', r USING ERRCODE = '55000';
    END IF;
  END LOOP;
  -- b) the WhatsApp intake: the same definer routine, still closed to every client role.
  IF (SELECT prosrc FROM pg_catalog.pg_proc
        WHERE oid = 'platform_private.acquire_waha_canonical_identity(uuid,uuid,uuid,uuid)'::regprocedure)
        NOT LIKE '%direct_case_persons%'
    OR NOT (SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[]
        FROM pg_catalog.pg_proc p
        WHERE p.oid = 'platform_private.acquire_waha_canonical_identity(uuid,uuid,uuid,uuid)'::regprocedure)
    OR has_function_privilege('service_role', 'platform_private.acquire_waha_canonical_identity(uuid,uuid,uuid,uuid)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'platform_private.acquire_waha_canonical_identity(uuid,uuid,uuid,uuid)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'a316_verify_whatsapp' USING ERRCODE = '55000';
  END IF;
  -- c) the journal: one action and one object type more, the old lists intact.
  IF NOT ('client.duplicate.merge' = ANY (platform_private.p7a_safe_audit_actions()))
    OR 'client.duplicate.merge' = ANY (platform_private.p7a_safe_audit_actions_pre_sales_import_tails())
    OR NOT ('client' = ANY (platform_private.p7a_safe_audit_resource_types()))
    OR 'client' = ANY (platform_private.p7a_safe_audit_resource_types_pre_sales_import_tails())
    OR NOT ('whatsapp.connect.qr' = ANY (platform_private.p7a_safe_audit_actions()))
    OR cardinality(platform_private.p7a_safe_audit_actions())
      <> cardinality(platform_private.p7a_safe_audit_actions_pre_sales_import_tails()) + 1
    OR cardinality(platform_private.p7a_safe_audit_resource_types())
      <> cardinality(platform_private.p7a_safe_audit_resource_types_pre_sales_import_tails()) + 1
    OR has_function_privilege('authenticated', 'platform_private.p7a_safe_audit_actions()', 'EXECUTE')
    OR has_function_privilege('anon', 'platform_private.p7a_safe_audit_resource_types()', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'a316_verify_allowlist' USING ERRCODE = '55000';
  END IF;
  -- d) the call feed: the three replaced bodies read the merged clients, grants as before.
  IF (SELECT prosrc FROM pg_catalog.pg_proc
        WHERE oid = 'platform.telephony_lead_calls_v1(uuid,uuid,integer,timestamptz,timestamptz)'::regprocedure)
        NOT LIKE '%client_merged_ids(p_organization_id, v_client)%'
    OR (SELECT prosrc FROM pg_catalog.pg_proc
        WHERE oid = 'platform.telephony_lead_recordings_v1(uuid,uuid,uuid[])'::regprocedure)
        NOT LIKE '%client_merged_ids(p_organization_id, v_client)%'
    OR (SELECT prosrc FROM pg_catalog.pg_proc
        WHERE oid = 'platform.telephony_set_result_v1(uuid,uuid,text,date)'::regprocedure)
        NOT LIKE '%resolve_canonical_client_id(p_organization_id, v_call.client_id)%'
    OR NOT has_function_privilege('authenticated', 'platform.telephony_lead_calls_v1(uuid,uuid,integer,timestamptz,timestamptz)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'platform.telephony_lead_recordings_v1(uuid,uuid,uuid[])', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'platform.telephony_set_result_v1(uuid,uuid,text,date)', 'EXECUTE')
    OR has_function_privilege('anon', 'platform.telephony_lead_calls_v1(uuid,uuid,integer,timestamptz,timestamptz)', 'EXECUTE')
    OR has_function_privilege('service_role', 'platform.telephony_set_result_v1(uuid,uuid,text,date)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'a316_verify_call_feed' USING ERRCODE = '55000';
  END IF;
END
$a316_verify$;

NOTIFY pgrst, 'reload schema';
COMMIT;
