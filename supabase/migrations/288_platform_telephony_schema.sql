-- 288_platform_telephony_schema — «Телефония Beeline KG» срез T1a: схема и RLS.
-- Контракт: docs/EVO_TELEPHONY_PLAN_2026-10-16.md §5.2, §6 (6.1–6.5), §7.1,
-- §9.1, §11; ADR 0033 (решения 3–5); docs/PLAN_CHANGES.md (запись «Телефония
-- T1a»). Только таблицы, проверки, индексы и замки доступа. Функций приёма,
-- проекции и чтения нет: они идут срезами T1b и далее.
--
-- Что делает (все таблицы — platform_private, организация в каждой строке):
--  * telephony_settings — одна строка организации: флаги (ui_enabled,
--    dial_enabled, projection_enabled, missed_task_enabled,
--    unknown_lead_enabled; все по умолчанию ВЫКЛЮЧЕНЫ, §9.1), outbound_paused,
--    рабочие часы (пн–сб 10:00–20:00 Asia/Bishkek) и срок перезвона (15
--    рабочих минут), получатель эскалаций, разрешённые префиксы набора
--    (+996), лимиты набора (150/сутки на сотрудника, 1 набор в 5 с, 60/час и
--    400/сутки на организацию), потолки автоматики (лиды 10/час и 40/сутки,
--    задачи 30/час и 120/сутки), каденс «Недозвона», reached_default_step_days
--    (пусто — выключено);
--  * telephony_runtime_state — одна строка организации: времена запусков
--    фоновых режимов, курсор сверки и первичного импорта, метки здоровья
--    (последнее событие, последний ответ и ошибка ВАТС), счётчик внутренних
--    звонков, остановка автоматики по потолку;
--  * telephony_extensions — сопоставление пользователя ВАТС (логин из GET
--    /users) и сотрудника EVO (§6.3);
--  * telephony_pbx_events — append-only доказательство приёма (§5.2): очищенные
--    поля БЕЗ токена и БЕЗ ссылки на запись (вместо неё has_link), ключ
--    дедупликации, SHA-256 тела, validation_state ok / incomplete / rejected;
--    для отклонённых после токена только форма (имена полей и длины);
--  * telephony_event_work — исходящий «ящик»: аренда, попытки, отсрочка,
--    мёртвые письма; ссылки на запись здесь НЕТ, только has_link (§5.2, §7.1);
--  * telephony_dial_requests — наборы «Позвонить»: идемпотентность по
--    (организация, сотрудник, request_id), ответ ВАТС, код отказа (§6.5);
--  * telephony_calls — звонок, одна строка на pbx_callid (§6.1);
--  * telephony_call_legs — нога звонка: участие одного сотрудника или группы;
--    ЕДИНСТВЕННОЕ место, где лежит ссылка на запись (recording_link, §7.1);
--  * telephony_call_events — append-only хронология событий звонка;
--  * telephony_recording_grants — выдача на прослушивание (§7.2);
--  * telephony_task_links — связь системных задач со звонком; частичный
--    уникальный индекс «одна открытая задача на предмет и вид» (§9.2).
--
-- Замки: ENABLE и FORCE ROW LEVEL SECURITY, политик нет, права отозваны у
-- PUBLIC, anon, authenticated, service_role, supabase_auth_admin и
-- evo_ai_agent. Доступ появится только через SECURITY DEFINER функции с
-- search_path = '' (срезы T1b и далее; шаблон 268, 156, 062). Вспомогательные
-- проверки (platform_private.telephony_*_ok) тоже без грантов.
-- Append-only: telephony_pbx_events и telephony_call_events закрыты от
-- UPDATE, DELETE и TRUNCATE общим platform_private.block_append_only_mutation
-- (041), в том числе для владельца таблицы. Единственное исключение — то, что
-- миграция 280 уже встроила в эту функцию: УДАЛЕНИЕ СТРОКИ (не UPDATE и не
-- TRUNCATE) внутри транзакции удаления аккаунта, помеченной номером запроса;
-- эти таблицы его наследуют (docs/runbooks/account-deletion.md, раздел
-- «Телефония»). Очистка доказательств старше 12 месяцев (§13) — отдельная
-- контролируемая функция среза T11 вместе с заменой этого замка; до тех пор
-- доказательства не очищаются.
--
-- Требования к следующим срезам (записаны и в docs/PLAN_CHANGES.md, пункты
-- 13, 15–17):
--  * Писатели T1b, T4a, T6. Нарушение ЛЮБОГО ограничения целостности внутри
--    функции владельца (SQLSTATE класса 23: 23502 NOT NULL, 23503 внешний ключ,
--    23505 уникальность, 23514 CHECK) кладёт в DETAIL ошибки значения: всю
--    строку целиком («Failing row contains …») или ключ («Key (…)=(…)»), а в
--    них может быть ссылка на запись или номер. Писатель ловит ошибку и
--    сохраняет только SQLSTATE и имя ограничения (для NOT NULL — имя столбца;
--    GET STACKED DIAGNOSTICS CONSTRAINT_NAME, COLUMN_NAME) в last_error_code по
--    форме ^[a-z][a-z0-9_]{0,63}$; SQLERRM, PG_EXCEPTION_DETAIL и
--    PG_EXCEPTION_CONTEXT не сохраняются и не логируются; приложение не пишет в
--    журнал поле details ответа RPC. Тест T1b: нога со ссылкой и пустым
--    leg_started_at (NOT NULL), нога со ссылкой при recording_state 'none'
--    (CHECK) и повтор ключа ноги (UNIQUE) — ни ссылки, ни номера в сохранённой
--    ошибке. Предпосылка (DETAIL несёт значения при 23502) закреплена в наборе
--    T1a.
--  * Функции T1b, T2 и далее, закрытые флагами. Строк telephony_settings
--    миграция не создаёт, поэтому «выключено» включает «строки нет». В plpgsql
--    IF NOT v.flag при отсутствующей строке даёт NULL и отказ НЕ срабатывает:
--    проверка пишется как NOT COALESCE(v.flag, FALSE). Тест T1b: без строки
--    telephony_settings каждая закрытая флагом функция отказывает.
--  * Ключ ноги (call_id, pbx_user, leg_started_at) содержит изменяемый столбец
--    (см. «Решения этого среза»). Функция слияния ног и её тесты — блокирующее
--    условие приёмки T1b: повтор события, history после event, воспроизведение
--    сообщения, одна нога на сотрудника в групповом звонке и переводе не дают
--    ни дубля, ни коллизии ключа. Если настоящие групповой звонок и перевод
--    (план §15, строка 5) покажут, что ключ неверен, ограничение заменяется
--    новой миграцией.
--  * Разбор T3. Имена полей доказательства и формы отклонённого запроса обязаны
--    соответствовать ^[A-Za-z][A-Za-z0-9_]{0,63}$ (замок схемы): разбор не
--    пропускает к писателю другие имена, а отклонённый запрос с таким именем
--    записывает без него (например, под общим ключом invalid_name_N), чтобы
--    чужое имя не роняло запись. Свободный текст ВАТС (pbx_callid, second_callid,
--    group_name, company_number_name, extension, pbx_user, lease_owner) схема от
--    ссылок не защищает: значение-ссылку разбор отклоняет до писателя; набор T1a
--    проверяет инвариант «ссылка хранится в одной колонке» по именам столбцов.
--
-- Решения этого среза, которых нет дословно в плане (точная схема «уточняется
-- в T1a», §6.1):
--  * ключ ноги — (call_id, pbx_user, leg_started_at): у `event` нет `start`,
--    поэтому нога, созданная событием, получает leg_started_at = время приёма
--    события (leg_start_source = 'event') и уточняется при `history`
--    ('history') или сверке ('pull'); pbx_user '' — нога группы без сотрудника;
--  * статус ноги, причина (destination) и ошибки хранятся как слова в нижнем
--    регистре по форме `^[a-z][a-z0-9_]{0,31}$`, без закрытого списка: портал
--    ВАТС не перечисляет значения исчерпывающе, а неизвестное значение не должно
--    ронять приём (мягкая проверка, §5.1). Закрытые списки — только у наших
--    собственных состояний (state, outcome, match_state, created_via и др.);
--  * ссылка на запись связана со своим состоянием проверкой: она есть тогда и
--    только тогда, когда recording_state = 'available' или 'unavailable'
--    (§7.3: 'none' — ссылки нет, 'expired' — ссылка обнулена); форма ссылки —
--    https без пробелов и управляющих знаков (закрепление хоста и пути — срез
--    T6, функция выдачи);
--  * в telephony_call_events ссылка на доказательство — мягкая (без внешнего
--    ключа): доказательства очищаются через 12 месяцев (T11), хронология остаётся;
--  * все внешние ключи — ON DELETE RESTRICT: ни каскадов, ни SET NULL (SET NULL
--    был бы UPDATE строки append-only таблицы);
--  * согласованность между строками там, где её даёт ключ: лид звонка, набора и
--    связи задачи обязан принадлежать указанному клиенту (составной ключ
--    (организация, клиент, лид) на platform.leads, 084), а событие хронологии —
--    ноге того же звонка (составной ключ (организация, звонок, нога)). Составной
--    ключ на лид с ON UPDATE CASCADE: слияние дублей клиентов
--    (platform.resolve_client_duplicate, 084) переносит лиды на выжившего
--    клиента UPDATE-ом platform.leads.client_id, и строки телефонии следуют
--    за лидом, а не блокируют слияние;
--  * связь задачи хранит и звонок-источник (call_id), и звонок, закрывший
--    задачу (closed_call_id, §9.2: «закрывается системой со ссылкой на звонок»);
--  * жёсткие верхние границы настроек, которых план не называет: срок
--    перезвона 1–480 рабочих минут; лимиты набора — сотрудник до 1 000 в сутки
--    и пауза до 3 600 с, организация до 1 000 в час и 5 000 в сутки; потолки
--    автоматики — лиды до 100/400, задачи до 300/1 200 (час/сутки), час не
--    больше суток. Значения по умолчанию — ровно планово (§6.5, §9.1); границы
--    защищают деньги и «Заявки» от случайной или злонамеренной правки, а менять
--    их можно новой миграцией;
--  * исходящий «ящик» (telephony_event_work): по умолчанию 8 попыток, не больше
--    20; состояния queued, leased, retry_wait, succeeded, dead_lettered — как
--    у durable_work_items (045);
--  * виды системных задач (telephony_task_links.kind): missed_callback,
--    no_answer_callback, result_callback, verify_call, reached_followup (§9.2–
--    §9.4); предмет «одной открытой задачи» — лид, иначе клиент, иначе звонок;
--  * поле fields доказательства — последний замок от секрета, а не его
--    единственная защита: ключ — имя вида ^[A-Za-z][A-Za-z0-9_]{0,63}$ (ссылка,
--    номер, пробелы и управляющие знаки именем быть не могут) и не содержит
--    (без учёта регистра) token, link, record, url, uri, href, mp3, secret,
--    passw, api[_-]key или authorization, а строковое значение не должно быть
--    ссылкой (содержать «://», начинаться с
--    https:/http:/ftp:/file: или оканчиваться на .mp3, .wav, .ogg и т. п.). Ни
--    одно из 19 полей, документированных для запросов ВАТС (event, history,
--    rating), этим правилам не противоречит. Проверка эвристическая: список
--    разрешённых имён и вырезание токена и ссылки делает разбор среза T3 (имена
--    полей «link» вебхука и «record» истории не подтверждены на настоящем
--    запросе, план §5.1, шаг 8); missing_fields — только имена
--    ^[A-Za-z][A-Za-z0-9_]{0,31}$, до 16 штук;
--
-- Безопасно для production: только новые таблицы и функции без данных; ни одна
-- существующая таблица, функция, политика или право не меняется; приём
-- телефонии не существует (маршрут — срез T3). Повторный запуск в той же точке
-- цепочки останавливается на уже существующих таблицах.
BEGIN;

DO $tel288_preconditions$
BEGIN
  IF to_regclass('platform.organizations') IS NULL
    OR to_regclass('platform.organization_memberships') IS NULL
    OR to_regclass('platform.clients') IS NULL
    OR to_regclass('platform.leads') IS NULL
    OR to_regclass('platform.staff_tasks') IS NULL
    OR to_regprocedure('platform_private.block_append_only_mutation()') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'evo_ai_agent') THEN
    RAISE EXCEPTION 'telephony_t1a_requires_current_chain' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'platform_private' AND c.relname LIKE 'telephony\_%'
  ) THEN
    RAISE EXCEPTION 'telephony_t1a_tables_already_exist' USING ERRCODE = '55000';
  END IF;
END
$tel288_preconditions$;

-- ---------------------------------------------------------------------------
-- Проверки формы (IMMUTABLE; используются в CHECK; без грантов).
-- ---------------------------------------------------------------------------

-- Разрешённые префиксы набора: 1–20 различных значений вида «+996».
CREATE FUNCTION platform_private.telephony_prefixes_ok(p_prefixes TEXT[])
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_prefixes IS NOT NULL
    AND cardinality(p_prefixes) BETWEEN 1 AND 20
    AND array_position(p_prefixes, NULL) IS NULL
    AND NOT EXISTS (SELECT 1 FROM unnest(p_prefixes) AS p WHERE p !~ '^\+[1-9][0-9]{0,3}$')
    AND (SELECT count(DISTINCT p) FROM unnest(p_prefixes) AS p) = cardinality(p_prefixes)
$$;

-- Рабочие дни недели: 1–7 различных значений 1..7 (1 — понедельник).
CREATE FUNCTION platform_private.telephony_working_days_ok(p_days SMALLINT[])
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_days IS NOT NULL
    AND cardinality(p_days) BETWEEN 1 AND 7
    AND array_position(p_days, NULL) IS NULL
    AND p_days <@ '{1,2,3,4,5,6,7}'::SMALLINT[]
    AND (SELECT count(DISTINCT d) FROM unnest(p_days) AS d) = cardinality(p_days)
$$;

-- Имена недостающих полей доказательства: до 16 имён вида слова из латиницы,
-- цифр и «_» (до 32 знаков), без пустых значений. Значений полей здесь нет и
-- быть не может: ни ссылки, ни номера, ни длинного текста.
CREATE FUNCTION platform_private.telephony_names_ok(p_names TEXT[])
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_names IS NOT NULL
    AND cardinality(p_names) <= 16
    AND array_position(p_names, NULL) IS NULL
    AND NOT EXISTS (SELECT 1 FROM unnest(p_names) AS n WHERE n !~ '^[A-Za-z][A-Za-z0-9_]{0,31}$')
$$;

-- Один шаг каденса «Недозвона»: {"unit":"work_hours","n":1..24},
-- {"unit":"work_days","n":1..30} или {"unit":"next_work_day_at","at":"HH:MM"}.
CREATE FUNCTION platform_private.telephony_cadence_step_ok(p_step JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  v_unit TEXT;
  v_keys TEXT[];
BEGIN
  IF p_step IS NULL OR jsonb_typeof(p_step) <> 'object' THEN
    RETURN FALSE;
  END IF;
  SELECT array_agg(k ORDER BY k) INTO v_keys FROM jsonb_object_keys(p_step) AS k;
  v_unit := p_step ->> 'unit';
  IF v_unit IN ('work_hours', 'work_days') THEN
    IF v_keys IS DISTINCT FROM ARRAY['n', 'unit']
      OR jsonb_typeof(p_step -> 'n') IS DISTINCT FROM 'number'
      OR (p_step ->> 'n') !~ '^[0-9]{1,3}$' THEN
      RETURN FALSE;
    END IF;
    RETURN (p_step ->> 'n')::INTEGER BETWEEN 1 AND CASE v_unit WHEN 'work_hours' THEN 24 ELSE 30 END;
  ELSIF v_unit = 'next_work_day_at' THEN
    IF v_keys IS DISTINCT FROM ARRAY['at', 'unit']
      OR jsonb_typeof(p_step -> 'at') IS DISTINCT FROM 'string' THEN
      RETURN FALSE;
    END IF;
    RETURN (p_step ->> 'at') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$';
  END IF;
  RETURN FALSE;
END
$$;

-- Каденс «Недозвона»: 1–8 шагов.
CREATE FUNCTION platform_private.telephony_cadence_ok(p_cadence JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF p_cadence IS NULL OR jsonb_typeof(p_cadence) <> 'array' THEN
    RETURN FALSE;
  END IF;
  IF jsonb_array_length(p_cadence) NOT BETWEEN 1 AND 8 THEN
    RETURN FALSE;
  END IF;
  RETURN NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_cadence) AS s
    WHERE NOT platform_private.telephony_cadence_step_ok(s)
  );
END
$$;

-- Очищенные поля доказательства (§5.2): плоский объект из скаляров, до 32
-- ключей, ключ — имя вида ^[A-Za-z][A-Za-z0-9_]{0,63}$ (так ссылка или номер не
-- могут лежать в самом ключе), строка до 2 048 знаков. Последний замок от
-- секрета (эвристика, не белый список): ключ не называется как токен, ссылка или
-- запись, а строка не похожа на ссылку. Белый список документированных полей и
-- вырезание токена и ссылки делает разбор среза T3.
CREATE FUNCTION platform_private.telephony_fields_ok(p_fields JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF p_fields IS NULL OR jsonb_typeof(p_fields) <> 'object' THEN
    RETURN FALSE;
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_fields)) > 32 THEN
    RETURN FALSE;
  END IF;
  RETURN NOT EXISTS (
    SELECT 1 FROM jsonb_each(p_fields) AS e
    WHERE e.key !~ '^[A-Za-z][A-Za-z0-9_]{0,63}$'
      OR e.key ~* '(token|link|record|url|uri|href|mp3|secret|passw|api.?key|authorization)'
      OR jsonb_typeof(e.value) NOT IN ('string', 'number', 'boolean', 'null')
      OR (jsonb_typeof(e.value) = 'string' AND (
        char_length(e.value #>> '{}') > 2048
        OR (e.value #>> '{}') ~* '(://|^\s*(https?|ftp|file):|\.(mp3|wav|ogg|m4a|aac|opus|flac)(\?|$))'))
  );
END
$$;

-- Форма отклонённого после токена запроса (§5.1, пункт 6): имя поля → длина
-- значения. Значений нет; имя — вида ^[A-Za-z][A-Za-z0-9_]{0,63}$, чужие имена
-- (ссылка, номер) в форму не попадают.
CREATE FUNCTION platform_private.telephony_form_shape_ok(p_shape JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF p_shape IS NULL OR jsonb_typeof(p_shape) <> 'object' THEN
    RETURN FALSE;
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_shape)) > 64 THEN
    RETURN FALSE;
  END IF;
  RETURN NOT EXISTS (
    SELECT 1 FROM jsonb_each(p_shape) AS e
    WHERE e.key !~ '^[A-Za-z][A-Za-z0-9_]{0,63}$'
      OR jsonb_typeof(e.value) <> 'number'
      OR (e.value #>> '{}') !~ '^[0-9]{1,5}$'
  );
END
$$;

-- ---------------------------------------------------------------------------
-- Настройки и состояние (одна строка организации; строки создают функции
-- следующих срезов при первом обращении, миграция данных не вносит).
-- ---------------------------------------------------------------------------
CREATE TABLE platform_private.telephony_settings (
  organization_id UUID PRIMARY KEY REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  -- Флаги включения (§9.1): все выключены, слияние кода ничего не открывает.
  ui_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  dial_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  projection_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  missed_task_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  unknown_lead_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  outbound_paused BOOLEAN NOT NULL DEFAULT FALSE,
  -- Рабочее время и срок перезвона (§9.2): значения по умолчанию, владелец их
  -- не подтверждал (§18.1, № 5).
  timezone TEXT NOT NULL DEFAULT 'Asia/Bishkek' CHECK (timezone = 'Asia/Bishkek'),
  working_days SMALLINT[] NOT NULL DEFAULT '{1,2,3,4,5,6}'
    CHECK (platform_private.telephony_working_days_ok(working_days)),
  work_from TIME NOT NULL DEFAULT '10:00',
  work_to TIME NOT NULL DEFAULT '20:00',
  callback_work_minutes INTEGER NOT NULL DEFAULT 15 CHECK (callback_work_minutes BETWEEN 1 AND 480),
  -- Получатель эскалаций: администратор или держатель роли «Телефония —
  -- руководитель»; это проверяет функция настроек (T4b), не поле.
  escalation_membership_id UUID,
  -- Набор (§6.5).
  dial_prefixes TEXT[] NOT NULL DEFAULT '{+996}' CHECK (platform_private.telephony_prefixes_ok(dial_prefixes)),
  limit_user_day INTEGER NOT NULL DEFAULT 150 CHECK (limit_user_day BETWEEN 1 AND 1000),
  limit_user_gap_seconds INTEGER NOT NULL DEFAULT 5 CHECK (limit_user_gap_seconds BETWEEN 1 AND 3600),
  limit_org_hour INTEGER NOT NULL DEFAULT 60 CHECK (limit_org_hour BETWEEN 1 AND 1000),
  limit_org_day INTEGER NOT NULL DEFAULT 400 CHECK (limit_org_day BETWEEN 1 AND 5000),
  -- Потолки автоматики (§9.1).
  ceiling_leads_hour INTEGER NOT NULL DEFAULT 10 CHECK (ceiling_leads_hour BETWEEN 1 AND 100),
  ceiling_leads_day INTEGER NOT NULL DEFAULT 40 CHECK (ceiling_leads_day BETWEEN 1 AND 400),
  ceiling_tasks_hour INTEGER NOT NULL DEFAULT 30 CHECK (ceiling_tasks_hour BETWEEN 1 AND 300),
  ceiling_tasks_day INTEGER NOT NULL DEFAULT 120 CHECK (ceiling_tasks_day BETWEEN 1 AND 1200),
  -- Каденс «Недозвона» (§9.4): +2 рабочих часа, следующий рабочий день 11:00,
  -- +2 рабочих дня.
  no_answer_cadence JSONB NOT NULL DEFAULT
    '[{"unit":"work_hours","n":2},{"unit":"next_work_day_at","at":"11:00"},{"unit":"work_days","n":2}]'::JSONB
    CHECK (platform_private.telephony_cadence_ok(no_answer_cadence)),
  -- Автозадача «Связаться» через N дней после «Дозвонился»; пусто — выключено.
  reached_default_step_days INTEGER CHECK (reached_default_step_days IS NULL OR reached_default_step_days BETWEEN 1 AND 30),
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_by_membership_id UUID,
  CONSTRAINT telephony_settings_hours_check CHECK (work_from < work_to),
  CONSTRAINT telephony_settings_dial_limits_check CHECK (limit_org_hour <= limit_org_day),
  CONSTRAINT telephony_settings_ceilings_check CHECK (ceiling_leads_hour <= ceiling_leads_day
    AND ceiling_tasks_hour <= ceiling_tasks_day),
  CONSTRAINT telephony_settings_escalation_fkey FOREIGN KEY (organization_id, escalation_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT telephony_settings_updated_by_fkey FOREIGN KEY (organization_id, updated_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id) ON DELETE RESTRICT
);
COMMENT ON TABLE platform_private.telephony_settings IS
  'Telephony T1a: one settings row per organization. Every flag ships OFF (plan 9.1); limits and ceilings carry hard upper bounds.';

CREATE TABLE platform_private.telephony_runtime_state (
  organization_id UUID PRIMARY KEY REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  -- Времена последних запусков фоновых режимов (§5.3).
  retry_run_at TIMESTAMPTZ,
  settle_run_at TIMESTAMPTZ,
  reconcile_run_at TIMESTAMPTZ,
  recording_check_run_at TIMESTAMPTZ,
  -- Курсор сверки сдвигается только после разбора всего ответа (§5.4); курсор
  -- первичного импорта идёт назад суточными окнами до 22.10.2025.
  reconcile_cursor_at TIMESTAMPTZ,
  reconcile_success_at TIMESTAMPTZ,
  backfill_cursor_at TIMESTAMPTZ,
  backfill_done_at TIMESTAMPTZ,
  -- Метки здоровья для «Настроек» (§12): без номеров и текстов.
  last_event_at TIMESTAMPTZ,
  last_pbx_ok_at TIMESTAMPTZ,
  last_pbx_error_at TIMESTAMPTZ,
  last_pbx_error_code TEXT CHECK (last_pbx_error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  -- Внутренние звонки между сотрудниками строк не создают (§6.2): только счёт.
  internal_calls_total BIGINT NOT NULL DEFAULT 0 CHECK (internal_calls_total >= 0),
  -- Автоматика остановлена по потолку (§9.1).
  automation_stopped_at TIMESTAMPTZ,
  automation_stop_code TEXT CHECK (automation_stop_code IN ('leads_hour', 'leads_day', 'tasks_hour', 'tasks_day')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT telephony_runtime_state_error_check CHECK ((last_pbx_error_at IS NULL) = (last_pbx_error_code IS NULL)),
  CONSTRAINT telephony_runtime_state_stop_check CHECK ((automation_stopped_at IS NULL) = (automation_stop_code IS NULL))
);
COMMENT ON TABLE platform_private.telephony_runtime_state IS
  'Telephony T1a: one runtime row per organization (cursors, health marks, automation stop). Holds no phone numbers or texts.';

-- ---------------------------------------------------------------------------
-- Сотрудники ВАТС ↔ сотрудники EVO (§6.3).
-- ---------------------------------------------------------------------------
CREATE TABLE platform_private.telephony_extensions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  -- Логин из GET /users. Имя группы, ivr, fax и пустое значение сотрудником
  -- не считаются (§6.1, правило 1), поэтому в таблице их нет.
  pbx_user TEXT NOT NULL CHECK (char_length(pbx_user) BETWEEN 1 AND 128
    AND pbx_user = btrim(pbx_user)
    AND pbx_user !~ '[[:cntrl:]]'
    AND lower(pbx_user) NOT IN ('ivr', 'fax')),
  extension TEXT CHECK (char_length(extension) BETWEEN 1 AND 32 AND extension !~ '[[:cntrl:]]'),
  pbx_display_name TEXT CHECK (char_length(pbx_display_name) BETWEEN 1 AND 200 AND pbx_display_name !~ '[[:cntrl:]]'),
  membership_id UUID,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_in_users_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT telephony_extensions_org_id_key UNIQUE (organization_id, id),
  CONSTRAINT telephony_extensions_user_key UNIQUE (organization_id, pbx_user),
  CONSTRAINT telephony_extensions_membership_fkey FOREIGN KEY (organization_id, membership_id)
    REFERENCES platform.organization_memberships(organization_id, id) ON DELETE RESTRICT
);
-- Один сотрудник EVO — не больше одного действующего пользователя ВАТС.
CREATE UNIQUE INDEX telephony_extensions_membership_active_key
  ON platform_private.telephony_extensions (organization_id, membership_id)
  WHERE membership_id IS NOT NULL AND active;
CREATE INDEX telephony_extensions_extension_idx
  ON platform_private.telephony_extensions (organization_id, extension)
  WHERE extension IS NOT NULL;
COMMENT ON TABLE platform_private.telephony_extensions IS
  'Telephony T1a: PBX user (login from GET /users) to EVO staff member. Unmapped users keep their calls without membership_id (plan 6.3).';

-- ---------------------------------------------------------------------------
-- Доказательство приёма и очередь (§5.2).
-- ---------------------------------------------------------------------------
CREATE TABLE platform_private.telephony_pbx_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  -- Идентификатор HTTP-запроса приёма (корреляция). Повторная доставка того же
  -- сообщения (тот же dedup_key) не сохраняется второй раз.
  request_id UUID NOT NULL UNIQUE,
  -- event, history, rating; у отклонённого — как пришло, если безопасной формы,
  -- иначе пусто. Значений остальных полей отклонённого запроса нет (§5.1).
  cmd TEXT NOT NULL CHECK (cmd ~ '^[A-Za-z0-9_.:-]{0,32}$'),
  event_type TEXT CHECK (event_type ~ '^[A-Za-z][A-Za-z0-9_]{0,31}$'),
  pbx_callid TEXT CHECK (char_length(pbx_callid) BETWEEN 1 AND 200
    AND pbx_callid = btrim(pbx_callid) AND pbx_callid !~ '[[:cntrl:]]'),
  second_callid TEXT CHECK (char_length(second_callid) BETWEEN 1 AND 200
    AND second_callid = btrim(second_callid) AND second_callid !~ '[[:cntrl:]]'),
  -- SHA-256 канонической строки (cmd, type, callid, second_callid, user, status,
  -- missedStatus, start, ext, phone) без токена и ссылки; у отклонённого пусто.
  dedup_key TEXT CHECK (dedup_key ~ '^[0-9a-f]{64}$'),
  body_sha256 TEXT NOT NULL CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
  -- Каким ключом принят запрос: текущим или «следующим» (ротация, §5.5).
  token_slot TEXT NOT NULL CHECK (token_slot IN ('current', 'next')),
  validation_state TEXT NOT NULL CHECK (validation_state IN ('ok', 'incomplete', 'rejected')),
  -- Обязательные по документации поля, которых не было (user, phone, callid…):
  -- только имена (CHECK ниже), без значений.
  missing_fields TEXT[] NOT NULL DEFAULT '{}',
  -- Очищенные поля; ссылка заменена has_link, токена нет (CHECK).
  fields JSONB CHECK (fields IS NULL OR platform_private.telephony_fields_ok(fields)),
  form_shape JSONB CHECK (form_shape IS NULL OR platform_private.telephony_form_shape_ok(form_shape)),
  has_link BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT telephony_pbx_events_org_id_key UNIQUE (organization_id, id),
  CONSTRAINT telephony_pbx_events_dedup_key UNIQUE (organization_id, dedup_key),
  CONSTRAINT telephony_pbx_events_state_shape_check CHECK (
    (validation_state = 'rejected'
      AND fields IS NULL AND form_shape IS NOT NULL AND dedup_key IS NULL
      AND cardinality(missing_fields) = 0
      AND cmd NOT IN ('event', 'history', 'rating'))
    OR (validation_state IN ('ok', 'incomplete')
      AND fields IS NOT NULL AND form_shape IS NULL AND dedup_key IS NOT NULL
      AND cmd IN ('event', 'history', 'rating'))
  ),
  CONSTRAINT telephony_pbx_events_missing_check CHECK (
    (validation_state = 'incomplete') = (cardinality(missing_fields) > 0)
    AND platform_private.telephony_names_ok(missing_fields)
  )
);
CREATE INDEX telephony_pbx_events_received_idx
  ON platform_private.telephony_pbx_events (organization_id, received_at DESC, id DESC);
CREATE INDEX telephony_pbx_events_callid_idx
  ON platform_private.telephony_pbx_events (organization_id, pbx_callid, received_at)
  WHERE pbx_callid IS NOT NULL;
CREATE INDEX telephony_pbx_events_rejected_idx
  ON platform_private.telephony_pbx_events (organization_id, received_at DESC)
  WHERE validation_state = 'rejected';
CREATE TRIGGER telephony_pbx_events_append_only
  BEFORE UPDATE OR DELETE ON platform_private.telephony_pbx_events
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER telephony_pbx_events_no_truncate
  BEFORE TRUNCATE ON platform_private.telephony_pbx_events
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
COMMENT ON TABLE platform_private.telephony_pbx_events IS
  'Telephony T1a: append-only evidence of authenticated PBX requests. No token, no recording link (has_link only); a rejected request keeps field names and lengths only.';

CREATE TABLE platform_private.telephony_event_work (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  event_id UUID NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'leased', 'retry_wait', 'succeeded', 'dead_lettered')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 8 CHECK (max_attempts BETWEEN 1 AND 20),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  lease_owner TEXT CHECK (char_length(lease_owner) BETWEEN 1 AND 200),
  lease_expires_at TIMESTAMPTZ,
  last_error_code TEXT CHECK (last_error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  -- Только признак: ссылка на запись живёт в строке ноги и больше нигде (§7.1).
  has_link BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT telephony_event_work_org_id_key UNIQUE (organization_id, id),
  CONSTRAINT telephony_event_work_event_key UNIQUE (organization_id, event_id),
  CONSTRAINT telephony_event_work_event_fkey FOREIGN KEY (organization_id, event_id)
    REFERENCES platform_private.telephony_pbx_events(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT telephony_event_work_lease_check CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL)),
  CONSTRAINT telephony_event_work_state_shape_check CHECK (
    (state IN ('queued', 'retry_wait') AND lease_owner IS NULL AND completed_at IS NULL)
    OR (state = 'leased' AND lease_owner IS NOT NULL AND completed_at IS NULL)
    OR (state IN ('succeeded', 'dead_lettered') AND lease_owner IS NULL AND completed_at IS NOT NULL)
  ),
  CONSTRAINT telephony_event_work_attempts_check CHECK (
    attempt_count <= max_attempts
    AND (state <> 'retry_wait' OR attempt_count >= 1)
    AND (state <> 'dead_lettered' OR last_error_code IS NOT NULL)
  )
);
CREATE INDEX telephony_event_work_due_idx
  ON platform_private.telephony_event_work (organization_id, next_attempt_at, id)
  WHERE state IN ('queued', 'retry_wait');
CREATE INDEX telephony_event_work_lease_idx
  ON platform_private.telephony_event_work (organization_id, lease_expires_at)
  WHERE state = 'leased';
COMMENT ON TABLE platform_private.telephony_event_work IS
  'Telephony T1a: outbox of projection work (lease, attempts, backoff, dead letters). Never holds a recording link, only has_link.';

-- ---------------------------------------------------------------------------
-- Наборы «Позвонить» (§6.4, §6.5). Раньше звонков: звонок ссылается на набор.
-- ---------------------------------------------------------------------------
CREATE TABLE platform_private.telephony_dial_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  -- Идемпотентность: повторный request_id того же сотрудника возвращает прежний
  -- результат, второго звонка нет.
  request_id UUID NOT NULL,
  membership_id UUID NOT NULL,
  client_id UUID,
  lead_id UUID,
  -- Логин пользователя ВАТС, на чьё устройство звонили; номер клиента (E.164)
  -- нужен сверке, чтобы найти звонок, у которого makecall не вернул callid.
  pbx_user TEXT CHECK (char_length(pbx_user) BETWEEN 1 AND 128
    AND pbx_user = btrim(pbx_user) AND pbx_user !~ '[[:cntrl:]]'),
  client_phone TEXT CHECK (client_phone ~ '^\+[1-9][0-9]{6,14}$'),
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'sent', 'unconfirmed', 'refused', 'failed')),
  refusal_code TEXT CHECK (refusal_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  pbx_callid TEXT CHECK (char_length(pbx_callid) BETWEEN 1 AND 200
    AND pbx_callid = btrim(pbx_callid) AND pbx_callid !~ '[[:cntrl:]]'),
  pbx_http_status SMALLINT CHECK (pbx_http_status BETWEEN 100 AND 599),
  pbx_error_code TEXT CHECK (pbx_error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT telephony_dial_requests_org_id_key UNIQUE (organization_id, id),
  CONSTRAINT telephony_dial_requests_request_key UNIQUE (organization_id, membership_id, request_id),
  CONSTRAINT telephony_dial_requests_membership_fkey FOREIGN KEY (organization_id, membership_id)
    REFERENCES platform.organization_memberships(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT telephony_dial_requests_client_fkey FOREIGN KEY (organization_id, client_id)
    REFERENCES platform.clients(organization_id, id) ON DELETE RESTRICT,
  -- Лид набора принадлежит указанному клиенту; ON UPDATE CASCADE — слияние
  -- дублей клиентов переносит лиды на выжившего клиента (084).
  CONSTRAINT telephony_dial_requests_lead_fkey FOREIGN KEY (organization_id, client_id, lead_id)
    REFERENCES platform.leads(organization_id, client_id, id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT telephony_dial_requests_lead_client_check CHECK (lead_id IS NULL OR client_id IS NOT NULL),
  -- Отказ всегда с кодом причины и только отказ; номер и пользователь ВАТС
  -- обязательны у всего, что не отказ (отказ «нет номера» или «не сопоставлен»
  -- их иметь не может).
  CONSTRAINT telephony_dial_requests_refusal_check CHECK ((status = 'refused') = (refusal_code IS NOT NULL)),
  CONSTRAINT telephony_dial_requests_call_check CHECK ((status = 'sent') = (pbx_callid IS NOT NULL)),
  CONSTRAINT telephony_dial_requests_target_check CHECK (
    status = 'refused'
    OR (pbx_user IS NOT NULL AND client_phone IS NOT NULL AND (client_id IS NOT NULL OR lead_id IS NOT NULL))
  )
);
CREATE INDEX telephony_dial_requests_org_created_idx
  ON platform_private.telephony_dial_requests (organization_id, created_at DESC);
CREATE INDEX telephony_dial_requests_member_created_idx
  ON platform_private.telephony_dial_requests (organization_id, membership_id, created_at DESC);
-- Под внешние ключи на клиента и лид: слияние дублей клиентов (UPDATE
-- platform.leads.client_id с ON UPDATE CASCADE) и удаление клиента ищут строки по
-- (организация, клиент[, лид]).
CREATE INDEX telephony_dial_requests_client_idx
  ON platform_private.telephony_dial_requests (organization_id, client_id, lead_id)
  WHERE client_id IS NOT NULL;
CREATE INDEX telephony_dial_requests_callid_idx
  ON platform_private.telephony_dial_requests (organization_id, pbx_callid)
  WHERE pbx_callid IS NOT NULL;
COMMENT ON TABLE platform_private.telephony_dial_requests IS
  'Telephony T1a: every dial attempt and refusal (plan 6.5): idempotency key, PBX answer, refusal code. Basis of dial limits and audit.';

-- ---------------------------------------------------------------------------
-- Звонок и его ноги (§6.1).
-- ---------------------------------------------------------------------------
CREATE TABLE platform_private.telephony_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  -- Уникален в организации; у сообщения без callid — временный ключ из хэша
  -- (start, phone, user) и needs_review.
  pbx_callid TEXT NOT NULL CHECK (char_length(pbx_callid) BETWEEN 1 AND 200
    AND pbx_callid = btrim(pbx_callid) AND pbx_callid !~ '[[:cntrl:]]'),
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  state TEXT NOT NULL DEFAULT 'ringing' CHECK (state IN ('ringing', 'answered', 'ended')),
  outcome TEXT CHECK (outcome IN ('answered', 'missed', 'cancelled', 'busy', 'unavailable',
    'not_found', 'not_allowed', 'no_answer_unknown')),
  -- webhook: точный итог; pull: итог по сверке, неточный (§5.4).
  outcome_source TEXT CHECK (outcome_source IN ('webhook', 'pull')),
  started_at TIMESTAMPTZ NOT NULL,
  answered_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  -- Когда звонок считается завершённым для решений (правило 5, окно успокоения).
  settled_at TIMESTAMPTZ,
  -- Последнее сообщение по этому звонку: окно успокоения 90 с от него.
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  -- Общая длительность по вебхуку: с ожиданием и приветствием, НЕ время
  -- разговора. Время разговора (talk_seconds) приходит только из сверки.
  webhook_total_seconds INTEGER CHECK (webhook_total_seconds >= 0),
  wait_seconds INTEGER CHECK (wait_seconds >= 0),
  talk_seconds INTEGER CHECK (talk_seconds >= 0),
  -- Нормализованный номер клиента (E.164): персональные данные, наружу не
  -- отдаётся; у анонимного звонящего пусто.
  client_phone TEXT CHECK (client_phone ~ '^\+[1-9][0-9]{6,14}$'),
  company_number TEXT CHECK (char_length(company_number) BETWEEN 1 AND 64 AND company_number !~ '[[:cntrl:]]'),
  company_number_name TEXT CHECK (char_length(company_number_name) BETWEEN 1 AND 200
    AND company_number_name !~ '[[:cntrl:]]'),
  -- Из сверки: кому пришёл входящий (user, group, ivr, onduty, offtime, hello,
  -- vm, am, telnum) и подсказка ВАТС по пропущенному (1–4).
  pbx_destination TEXT CHECK (pbx_destination ~ '^[a-z][a-z0-9_]{0,31}$'),
  pbx_missed_status SMALLINT CHECK (pbx_missed_status BETWEEN 1 AND 4),
  linked_call_id UUID,
  -- Сотрудник, ответивший первым; пусто, если не ответил никто.
  membership_id UUID,
  client_id UUID,
  lead_id UUID,
  match_state TEXT NOT NULL DEFAULT 'unmatched'
    CHECK (match_state IN ('matched', 'ambiguous', 'unmatched', 'created')),
  result_code TEXT CHECK (result_code IN ('reached', 'callback', 'not_interested', 'no_answer')),
  result_by UUID,
  result_at TIMESTAMPTZ,
  -- Сводное по ногам (§7.3).
  recording_state TEXT NOT NULL DEFAULT 'none'
    CHECK (recording_state IN ('none', 'available', 'unavailable', 'expired')),
  created_via TEXT NOT NULL CHECK (created_via IN ('webhook', 'reconcile', 'backfill', 'dial')),
  needs_review BOOLEAN NOT NULL DEFAULT FALSE,
  dial_request_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT telephony_calls_org_id_key UNIQUE (organization_id, id),
  CONSTRAINT telephony_calls_callid_key UNIQUE (organization_id, pbx_callid),
  CONSTRAINT telephony_calls_linked_fkey FOREIGN KEY (organization_id, linked_call_id)
    REFERENCES platform_private.telephony_calls(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT telephony_calls_membership_fkey FOREIGN KEY (organization_id, membership_id)
    REFERENCES platform.organization_memberships(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT telephony_calls_result_by_fkey FOREIGN KEY (organization_id, result_by)
    REFERENCES platform.organization_memberships(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT telephony_calls_client_fkey FOREIGN KEY (organization_id, client_id)
    REFERENCES platform.clients(organization_id, id) ON DELETE RESTRICT,
  -- Лид звонка принадлежит клиенту звонка (лид без клиента невозможен, см.
  -- telephony_calls_match_check); ON UPDATE CASCADE — слияние дублей клиентов
  -- переносит лиды на выжившего клиента (084), звонки следуют за лидом.
  CONSTRAINT telephony_calls_lead_fkey FOREIGN KEY (organization_id, client_id, lead_id)
    REFERENCES platform.leads(organization_id, client_id, id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT telephony_calls_dial_fkey FOREIGN KEY (organization_id, dial_request_id)
    REFERENCES platform_private.telephony_dial_requests(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT telephony_calls_linked_self_check CHECK (linked_call_id IS DISTINCT FROM id),
  -- Снимок состояния (правило 2, «ответ необратим»): ringing — итога нет,
  -- answered — итог answered, ended — итог и время окончания есть; а раз время
  -- ответа записано, итог — answered, а не missed или cancelled. CASE, а не OR:
  -- у CHECK неопределённый (NULL) результат означает «прошло». CHECK видит
  -- только новую строку, поэтому ПРАВИЛО ПЕРЕХОДА (ответ никогда не
  -- перезаписывается более поздней ногой) — логика функций проекции T1b, их
  -- тесты обязательны; здесь закрыта лишь запись самого противоречия.
  CONSTRAINT telephony_calls_state_outcome_check CHECK (
    CASE state
      WHEN 'ringing' THEN outcome IS NULL
      WHEN 'answered' THEN outcome IS NOT NULL AND outcome = 'answered'
      ELSE outcome IS NOT NULL AND ended_at IS NOT NULL
    END
  ),
  CONSTRAINT telephony_calls_answered_at_check CHECK (
    answered_at IS NULL OR outcome IS NOT DISTINCT FROM 'answered'
  ),
  CONSTRAINT telephony_calls_outcome_pair_check CHECK (
    (outcome IS NULL) = (outcome_source IS NULL)
    AND (outcome IS DISTINCT FROM 'no_answer_unknown' OR outcome_source = 'pull')
  ),
  -- Привязка (§6.2): клиент есть у matched и created и только у них; лид
  -- невозможен без клиента, а created несёт и клиента, и лид.
  CONSTRAINT telephony_calls_match_check CHECK (
    (match_state IN ('matched', 'created')) = (client_id IS NOT NULL)
    AND (lead_id IS NULL OR client_id IS NOT NULL)
    AND (match_state <> 'created' OR lead_id IS NOT NULL)
  ),
  -- Результат (§9.4): три нажатия сотрудника — с автором; «Недозвон» — авто, без.
  CONSTRAINT telephony_calls_result_check CHECK (
    CASE
      WHEN result_code IS NULL THEN result_at IS NULL AND result_by IS NULL
      WHEN result_code = 'no_answer' THEN result_at IS NOT NULL AND result_by IS NULL
      ELSE result_at IS NOT NULL AND result_by IS NOT NULL
    END
  ),
  -- Звонок из «Позвонить» (created_via 'dial') всегда несёт свой набор (§6.1:
  -- dial_request_id — «для исходящих из EVO»); и он, и любая строка с набором
  -- исходящие. Сверка может привязать исходящий звонок к набору позже.
  CONSTRAINT telephony_calls_dial_direction_check CHECK (
    (created_via <> 'dial' OR dial_request_id IS NOT NULL)
    AND ((created_via <> 'dial' AND dial_request_id IS NULL) OR direction = 'out')
  )
);
-- Один набор — не больше одного звонка.
CREATE UNIQUE INDEX telephony_calls_dial_request_key
  ON platform_private.telephony_calls (organization_id, dial_request_id)
  WHERE dial_request_id IS NOT NULL;
CREATE INDEX telephony_calls_started_idx
  ON platform_private.telephony_calls (organization_id, started_at DESC, id DESC);
CREATE INDEX telephony_calls_client_idx
  ON platform_private.telephony_calls (organization_id, client_id, started_at DESC)
  WHERE client_id IS NOT NULL;
CREATE INDEX telephony_calls_lead_idx
  ON platform_private.telephony_calls (organization_id, lead_id, started_at DESC)
  WHERE lead_id IS NOT NULL;
CREATE INDEX telephony_calls_phone_idx
  ON platform_private.telephony_calls (organization_id, client_phone, started_at DESC)
  WHERE client_phone IS NOT NULL;
CREATE INDEX telephony_calls_membership_idx
  ON platform_private.telephony_calls (organization_id, membership_id, started_at DESC)
  WHERE membership_id IS NOT NULL;
CREATE INDEX telephony_calls_unsettled_idx
  ON platform_private.telephony_calls (organization_id, last_message_at)
  WHERE settled_at IS NULL;
CREATE INDEX telephony_calls_linked_idx
  ON platform_private.telephony_calls (organization_id, linked_call_id)
  WHERE linked_call_id IS NOT NULL;
CREATE INDEX telephony_calls_reconciled_idx
  ON platform_private.telephony_calls (organization_id, created_at DESC)
  WHERE created_via = 'reconcile';
COMMENT ON TABLE platform_private.telephony_calls IS
  'Telephony T1a: one row per PBX call id. client_phone is personal data and is never returned to a browser; talk_seconds comes only from reconciliation.';

CREATE TABLE platform_private.telephony_call_legs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  call_id UUID NOT NULL,
  -- Логин сотрудника ВАТС; '' — нога группы без сотрудника (nobody took it).
  pbx_user TEXT NOT NULL DEFAULT '' CHECK (char_length(pbx_user) <= 128
    AND pbx_user = btrim(pbx_user) AND pbx_user !~ '[[:cntrl:]]'),
  extension TEXT CHECK (char_length(extension) BETWEEN 1 AND 32 AND extension !~ '[[:cntrl:]]'),
  group_name TEXT CHECK (char_length(group_name) BETWEEN 1 AND 200 AND group_name !~ '[[:cntrl:]]'),
  membership_id UUID,
  state TEXT NOT NULL DEFAULT 'ringing'
    CHECK (state IN ('ringing', 'accepted', 'completed', 'cancelled', 'transferred', 'missed')),
  -- status из history ноги, слово в нижнем регистре (success, missed, cancel,
  -- busy, notavailable, notallowed, notfound, noanswer…); список не закрыт.
  status TEXT CHECK (status ~ '^[a-z][a-z0-9_]{0,31}$'),
  -- Ключ ноги вместе с call_id и pbx_user. У event нет start: нога от события
  -- получает время приёма ('event'), history даёт start ('history'), сверка —
  -- 'pull'.
  leg_started_at TIMESTAMPTZ NOT NULL,
  leg_start_source TEXT NOT NULL CHECK (leg_start_source IN ('event', 'history', 'pull')),
  accepted_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  webhook_total_seconds INTEGER CHECK (webhook_total_seconds >= 0),
  wait_seconds INTEGER CHECK (wait_seconds >= 0),
  talk_seconds INTEGER CHECK (talk_seconds >= 0),
  -- СЕКРЕТ (§7.1): единственное место хранения ссылки на запись. Любой, у кого
  -- есть ссылка, слушает запись. Не копировать в другие таблицы, журналы,
  -- ответы, аналитику и в браузер; читает только серверная функция выдачи.
  recording_link TEXT CHECK (char_length(recording_link) BETWEEN 1 AND 1024
    AND recording_link ~ '^https://[^[:space:][:cntrl:]]+$'),
  recording_state TEXT NOT NULL DEFAULT 'none'
    CHECK (recording_state IN ('none', 'available', 'unavailable', 'expired')),
  not_found_count INTEGER NOT NULL DEFAULT 0 CHECK (not_found_count >= 0),
  first_not_found_at TIMESTAMPTZ,
  -- Суточная проверка срока (§7.5): когда пробовать снова.
  recording_next_check_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT telephony_call_legs_org_id_key UNIQUE (organization_id, id),
  -- Цель составного ключа хронологии: событие обязано ссылаться на ногу СВОЕГО звонка.
  CONSTRAINT telephony_call_legs_org_call_id_key UNIQUE (organization_id, call_id, id),
  CONSTRAINT telephony_call_legs_key UNIQUE (organization_id, call_id, pbx_user, leg_started_at),
  CONSTRAINT telephony_call_legs_call_fkey FOREIGN KEY (organization_id, call_id)
    REFERENCES platform_private.telephony_calls(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT telephony_call_legs_membership_fkey FOREIGN KEY (organization_id, membership_id)
    REFERENCES platform.organization_memberships(organization_id, id) ON DELETE RESTRICT,
  -- Ссылка есть тогда и только тогда, когда запись доступна или временно
  -- недоступна; «нет записи» и «срок вышел» ссылки не несут (§7.3).
  CONSTRAINT telephony_call_legs_recording_check CHECK (
    (recording_state IN ('available', 'unavailable')) = (recording_link IS NOT NULL)
  ),
  CONSTRAINT telephony_call_legs_not_found_check CHECK ((not_found_count = 0) = (first_not_found_at IS NULL))
);
CREATE INDEX telephony_call_legs_call_idx
  ON platform_private.telephony_call_legs (organization_id, call_id);
CREATE INDEX telephony_call_legs_membership_idx
  ON platform_private.telephony_call_legs (organization_id, membership_id, leg_started_at DESC)
  WHERE membership_id IS NOT NULL;
CREATE INDEX telephony_call_legs_user_idx
  ON platform_private.telephony_call_legs (organization_id, pbx_user, leg_started_at DESC);
CREATE INDEX telephony_call_legs_recording_check_idx
  ON platform_private.telephony_call_legs (organization_id, recording_next_check_at)
  WHERE recording_state IN ('available', 'unavailable');
COMMENT ON TABLE platform_private.telephony_call_legs IS
  'Telephony T1a: one leg per participant (employee or group) of a call. recording_link is a SECRET and lives only here (plan 7.1).';
COMMENT ON COLUMN platform_private.telephony_call_legs.recording_link IS
  'SECRET recording URL (unsigned MP3 link). Only this column stores it; the playback proxy reads it through a service-only function.';

CREATE TABLE platform_private.telephony_call_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  call_id UUID NOT NULL,
  leg_id UUID,
  source TEXT NOT NULL CHECK (source IN ('webhook', 'pull')),
  -- Слово в нижнем регистре: incoming, accepted, completed, cancelled,
  -- outgoing, transferred, history, reconcile.
  event_type TEXT NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9_]{0,31}$'),
  pbx_user TEXT CHECK (char_length(pbx_user) <= 128 AND pbx_user = btrim(pbx_user) AND pbx_user !~ '[[:cntrl:]]'),
  occurred_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  -- Мягкая ссылка на telephony_pbx_events.id (без внешнего ключа): доказательства
  -- очищаются через 12 месяцев (T11), хронология остаётся.
  pbx_event_id UUID,
  CONSTRAINT telephony_call_events_org_id_key UNIQUE (organization_id, id),
  CONSTRAINT telephony_call_events_call_fkey FOREIGN KEY (organization_id, call_id)
    REFERENCES platform_private.telephony_calls(organization_id, id) ON DELETE RESTRICT,
  -- Нога события принадлежит тому же звонку (при пустой ноге ключ не проверяется,
  -- звонок проверяет ключ выше).
  CONSTRAINT telephony_call_events_leg_fkey FOREIGN KEY (organization_id, call_id, leg_id)
    REFERENCES platform_private.telephony_call_legs(organization_id, call_id, id) ON DELETE RESTRICT,
  CONSTRAINT telephony_call_events_webhook_ref_check CHECK ((source = 'webhook') = (pbx_event_id IS NOT NULL))
);
CREATE INDEX telephony_call_events_call_idx
  ON platform_private.telephony_call_events (organization_id, call_id, occurred_at, id);
CREATE INDEX telephony_call_events_leg_idx
  ON platform_private.telephony_call_events (organization_id, leg_id, occurred_at)
  WHERE leg_id IS NOT NULL;
CREATE TRIGGER telephony_call_events_append_only
  BEFORE UPDATE OR DELETE ON platform_private.telephony_call_events
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER telephony_call_events_no_truncate
  BEFORE TRUNCATE ON platform_private.telephony_call_events
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
COMMENT ON TABLE platform_private.telephony_call_events IS
  'Telephony T1a: append-only chronology of call events (wait time, phase 2). No phone numbers or links.';

-- ---------------------------------------------------------------------------
-- Выдачи на прослушивание (§7.2) и связи задач со звонками (§9.2).
-- ---------------------------------------------------------------------------
CREATE TABLE platform_private.telephony_recording_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  membership_id UUID NOT NULL,
  leg_id UUID NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  -- Срок 15 минут и число обращений до 40 назначает функция выдачи (T6); схема
  -- держит жёсткий потолок срока — час.
  expires_at TIMESTAMPTZ NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 40 CHECK (max_uses BETWEEN 1 AND 100),
  use_count INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  last_used_at TIMESTAMPTZ,
  CONSTRAINT telephony_recording_grants_org_id_key UNIQUE (organization_id, id),
  CONSTRAINT telephony_recording_grants_membership_fkey FOREIGN KEY (organization_id, membership_id)
    REFERENCES platform.organization_memberships(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT telephony_recording_grants_leg_fkey FOREIGN KEY (organization_id, leg_id)
    REFERENCES platform_private.telephony_call_legs(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT telephony_recording_grants_term_check CHECK (
    expires_at > granted_at AND expires_at - granted_at <= INTERVAL '1 hour'
  ),
  CONSTRAINT telephony_recording_grants_uses_check CHECK (
    use_count <= max_uses AND ((use_count = 0) = (last_used_at IS NULL))
  )
);
CREATE INDEX telephony_recording_grants_member_idx
  ON platform_private.telephony_recording_grants (organization_id, membership_id, granted_at DESC);
CREATE INDEX telephony_recording_grants_leg_idx
  ON platform_private.telephony_recording_grants (organization_id, leg_id, granted_at DESC);
COMMENT ON TABLE platform_private.telephony_recording_grants IS
  'Telephony T1a: time- and count-limited permission to stream one recording leg. Holds no link; the link is consumed server-side from the leg row.';

CREATE TABLE platform_private.telephony_task_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  -- Вид системной задачи: «Перезвонить» по пропущенному, «Перезвонить» по
  -- каденсу «Недозвона», «Перезвонить» по кнопке результата, «Проверить
  -- звонок» (неоднозначный номер), «Связаться» после «Дозвонился».
  kind TEXT NOT NULL CHECK (kind IN ('missed_callback', 'no_answer_callback', 'result_callback',
    'verify_call', 'reached_followup')),
  task_id UUID NOT NULL,
  call_id UUID NOT NULL,
  client_id UUID,
  lead_id UUID,
  -- Предмет «одной открытой задачи на предмет и вид»: лид, иначе клиент, иначе
  -- сам звонок (неоднозначный номер).
  scope_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  closed_at TIMESTAMPTZ,
  closed_reason TEXT CHECK (closed_reason IN ('task_done', 'answered_call', 'replaced', 'cancelled')),
  -- Звонок, закрывший задачу (§9.2: автозакрытие «со ссылкой на звонок»).
  closed_call_id UUID,
  CONSTRAINT telephony_task_links_org_id_key UNIQUE (organization_id, id),
  CONSTRAINT telephony_task_links_task_key UNIQUE (organization_id, task_id),
  CONSTRAINT telephony_task_links_task_fkey FOREIGN KEY (organization_id, task_id)
    REFERENCES platform.staff_tasks(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT telephony_task_links_call_fkey FOREIGN KEY (organization_id, call_id)
    REFERENCES platform_private.telephony_calls(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT telephony_task_links_client_fkey FOREIGN KEY (organization_id, client_id)
    REFERENCES platform.clients(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT telephony_task_links_closed_call_fkey FOREIGN KEY (organization_id, closed_call_id)
    REFERENCES platform_private.telephony_calls(organization_id, id) ON DELETE RESTRICT,
  -- Лид связи принадлежит указанному клиенту; ON UPDATE CASCADE — слияние
  -- дублей клиентов переносит лиды на выжившего клиента (084).
  CONSTRAINT telephony_task_links_lead_fkey FOREIGN KEY (organization_id, client_id, lead_id)
    REFERENCES platform.leads(organization_id, client_id, id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT telephony_task_links_lead_client_check CHECK (lead_id IS NULL OR client_id IS NOT NULL),
  CONSTRAINT telephony_task_links_scope_check CHECK (scope_id = COALESCE(lead_id, client_id, call_id)),
  CONSTRAINT telephony_task_links_closed_check CHECK ((closed_at IS NULL) = (closed_reason IS NULL)),
  -- Звонок закрытия — только у закрытой связи; автозакрытие по отвеченному
  -- звонку (answered_call) без звонка невозможно.
  CONSTRAINT telephony_task_links_closed_call_check CHECK (
    (closed_call_id IS NULL OR closed_at IS NOT NULL)
    AND (closed_reason IS DISTINCT FROM 'answered_call' OR closed_call_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX telephony_task_links_open_key
  ON platform_private.telephony_task_links (organization_id, kind, scope_id)
  WHERE closed_at IS NULL;
CREATE INDEX telephony_task_links_call_idx
  ON platform_private.telephony_task_links (organization_id, call_id);
CREATE INDEX telephony_task_links_client_idx
  ON platform_private.telephony_task_links (organization_id, client_id, lead_id)
  WHERE client_id IS NOT NULL;
CREATE INDEX telephony_task_links_closed_call_idx
  ON platform_private.telephony_task_links (organization_id, closed_call_id)
  WHERE closed_call_id IS NOT NULL;
COMMENT ON TABLE platform_private.telephony_task_links IS
  'Telephony T1a: system tasks created from calls. The partial unique index allows one open task per subject (lead, else client, else call) and kind.';

-- ---------------------------------------------------------------------------
-- Замки: FORCE RLS без политик, права отозваны у всех клиентских ролей.
-- ---------------------------------------------------------------------------
DO $tel288_lockdown$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'telephony_settings', 'telephony_runtime_state', 'telephony_extensions',
    'telephony_pbx_events', 'telephony_event_work', 'telephony_dial_requests',
    'telephony_calls', 'telephony_call_legs', 'telephony_call_events',
    'telephony_recording_grants', 'telephony_task_links'
  ] LOOP
    EXECUTE format('ALTER TABLE platform_private.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE platform_private.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE platform_private.%I FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent', t);
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname = 'platform_private' AND tablename = t) THEN
      RAISE EXCEPTION 'telephony_table_has_policies: %', t USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$tel288_lockdown$;

DO $tel288_private_acl$
DECLARE f REGPROCEDURE;
BEGIN
  FOR f IN SELECT p.oid::REGPROCEDURE FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform_private' AND p.proname LIKE 'telephony\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent', f);
  END LOOP;
END
$tel288_private_acl$;

COMMIT;
