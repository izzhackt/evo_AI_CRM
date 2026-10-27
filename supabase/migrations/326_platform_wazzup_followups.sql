-- 326 «WhatsApp продаж через Wazzup: дополнения этапа 1» (решение владельца 26.10.2026: «Да, через Wazzup»; план этапа 1
-- docs/EVO_WAZZUP_WHATSAPP_PLAN_2026-10-27.md §5.4, §5.6, §9, §11 п. 4, §12 A6; docs/PLAN_CHANGES.md «2026-10-27 · WhatsApp через
-- Wazzup, дополнения этапа 1 (миграция 326)»). Номер 326: на origin/main последняя 323, 324 - значение провайдера и 325 - приём и
-- запрет отправки (одна серия); сверяется ещё раз перед слиянием (хуки набора привязаны к имени файла, не к номеру).
--
-- Зачем. Срезы W1-W3 оставили три пробела, которые закрываются только базой (служебная роль приложения не читает закрытые
-- таблицы `platform_private`, а читающих функций у 325 для неё нет):
--  a) таймер не видит слово пути (`none` / `waha` / `wazzup`): ему доступно лишь «путь Wazzup или нет», поэтому «расхождение»
--     плана §9 (переключатели env и путь в базе не сходятся) он не называет, а слово пути выведывает пустой порцией записи;
--  b) карточка «WhatsApp продаж через Wazzup» в «Настройках» не может показать последние четыре цифры номера канала: чтение
--     для сотрудника их не отдаёт (разбор в приложении поле уже принимает);
--  c) команда оператора `wazzup-ops replay <id событий>` из плана §5.6 / §12 A6 была невозможна: сохранённые сырые события
--     лежат в `platform_private`, читать их служебной роли нечем.
--
-- Что нового (повторный запуск целой миграции отказывает `a326_already_applied`; ничего не удаляется, таблицы не меняются):
--  1) `platform.whatsapp_transport_read_v1(организация)` - service_role: путь (`none` / `waha` / `wazzup`; нет строки = `none`),
--     выключатели ИИ и Gemini, привязанный канал (id канала, вид, последние четыре цифры, слово состояния и время наблюдения).
--     Ключа, адреса вебхука, токена, SHA-256 и самого номера в ответе нет. STABLE, ничего не пишет.
--  2) `platform.whatsapp_intake_events_read_v1(организация, id событий)` - service_role: сохранённые события Wazzup этой
--     организации по их идентификаторам (от 1 до 100 штук; чужая организация, другой провайдер и несуществующий id -
--     просто «не найдено»), в порядке запроса, в виде, который принимает `wazzup_webhook_persist_v1`: вид элемента
--     (`message` для сообщения, правки и удаления, `channel` для состояния канала) и сам элемент. Событие `unparsed` отдаёт
--     вид и элемент NULL (его форма неизвестна, повторять нечего). STABLE, ничего не пишет. Единственный вызывающий -
--     команда оператора, которая печатает только итоги: ни текстов, ни номеров, ни идентификаторов чатов в выводе нет.
--  3) `platform.staff_whatsapp_transport_v1` получает в объекте `channel` ключ `last4` (последние четыре цифры номера канала,
--     `^[0-9]{4}$`; полного номера и SHA-256 по-прежнему нет). Остальные ключи и правила прежние. Заменяется один раз,
--     заменой проверенного фрагмента тела (приём 282/320/325), под md5-якорем тела из 325.
--
-- Счётчики и повторы (отклонение 10 среза W2). Элемент, отфильтрованный по каналу или виду чата, не сохраняется, и ключа для
-- дедупа у него нет: повторная доставка того же пакета считала бы его снова. `replay` теперь берёт только СОХРАНЁННЫЕ события
-- (п. 2), поэтому отфильтрованного в повторе не бывает, а сохранённое дедуплицируется по ключу 325 и счётчики не трогает
-- (набор `platform_wazzup_followups.sql` это проверяет). Что остаётся: собственная повторная доставка Wazzup пакета с
-- отфильтрованными элементами всё ещё считается заново (документация о повторах молчит; запись обязательна к ключу, а ключ у
-- отфильтрованного означал бы строку на каждый такой элемент) - допуск суточной сверки `max(3, 2 %)` это переносит; записано
-- в PLAN_CHANGES.
--
-- Порядок выката. Миграция идёт в одном PR с 324-325 и ДО приложения: прежнее приложение новых функций не зовёт; новое
-- приложение без неё не смогло бы прочитать путь (таймер сказал бы `failed`, `replay` - `database_error`). Безвредно для
-- работающего приложения: чтение пути для сотрудника зовёт только приложение этой серии (его разбор принимает и прежнюю
-- форму канала из трёх ключей, и форму с `last4`); образы старше эту функцию не читают.
BEGIN;

-- ---------------------------------------------------------------------------
-- Якоря: объекты 324-325, на которые опирается миграция; новые имена свободны; md5 заменяемого тела (приём 303/316/320/325).
-- Расхождение останавливает миграцию, ничего не меняя.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE a326_pins (sig TEXT PRIMARY KEY, md5sum TEXT NOT NULL) ON COMMIT DROP;
INSERT INTO a326_pins (sig, md5sum) VALUES
  -- Чтение пути для сотрудника: тело 325 (раздел 16 миграции 325).
  ('platform.staff_whatsapp_transport_v1(uuid)', '6b1503878518a84ed5f4c4e6f4921305');

DO $a326_anchor$
DECLARE r RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_enum e
      WHERE e.enumtypid = 'platform.communication_provider'::REGTYPE AND e.enumlabel = 'wazzup')
    OR to_regclass('platform_private.provider_webhook_events') IS NULL
    OR to_regclass('platform_private.whatsapp_transport_state') IS NULL
    OR to_regclass('platform_private.wazzup_channels') IS NULL
    OR to_regclass('platform_private.wazzup_operator_events') IS NULL
    OR to_regprocedure('platform_private.require_p2g_service()') IS NULL
    OR to_regprocedure('platform.wazzup_webhook_persist_v1(uuid,text,text,jsonb,jsonb)') IS NULL
    OR to_regprocedure('platform.whatsapp_transport_configure_v1(uuid,text,boolean,boolean,uuid)') IS NULL
    OR to_regprocedure('platform.staff_whatsapp_transport_v1(uuid)') IS NULL
  THEN
    RAISE EXCEPTION 'a326_anchor_drift: migrations 324 / 325 (the Wazzup provider value and intake) are not applied' USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('platform.whatsapp_transport_read_v1(uuid)') IS NOT NULL
    OR to_regprocedure('platform.whatsapp_intake_events_read_v1(uuid,uuid[])') IS NOT NULL
  THEN
    RAISE EXCEPTION 'a326_already_applied' USING ERRCODE = '55000';
  END IF;
  FOR r IN SELECT p.sig, p.md5sum FROM a326_pins p LOOP
    IF (SELECT md5(x.prosrc) FROM pg_catalog.pg_proc x WHERE x.oid = to_regprocedure(r.sig)) IS DISTINCT FROM r.md5sum THEN
      RAISE EXCEPTION 'a326_anchor_drift: % is not the expected definition', r.sig USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$a326_anchor$;

-- Снимок атрибутов заменяемой функции: после замены права, владелец, определитель, изменчивость и search_path те же.
CREATE TEMP TABLE a326_before ON COMMIT DROP AS
  SELECT p.oid, pins.sig, p.prosecdef, p.provolatile, p.proconfig, p.proacl::TEXT AS acl, p.proowner, p.proleakproof,
    p.proparallel, p.prorettype, p.proretset, p.pronargdefaults
  FROM a326_pins pins JOIN pg_catalog.pg_proc p ON p.oid = to_regprocedure(pins.sig);

-- Замена фрагмента в теле функции (приём 282/320/325): фрагмент обязан встретиться ровно столько раз, сколько ожидается, и
-- запрещённая метка (уже внесённая правка) не должна быть в теле, иначе миграция падает, ничего не меняя. CREATE OR
-- REPLACE сохраняет владельца и права.
CREATE FUNCTION pg_temp.a326_replace(p_signature TEXT, p_old TEXT, p_new TEXT, p_count INTEGER, p_forbid TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE body TEXT; matches INTEGER;
BEGIN
  body := pg_get_functiondef(to_regprocedure(p_signature));
  matches := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  IF body IS NULL OR matches IS DISTINCT FROM p_count OR (p_forbid IS NOT NULL AND strpos(body, p_forbid) <> 0) THEN
    RAISE EXCEPTION 'a326_replace_drift: % expected %, found %', p_signature, p_count, matches USING ERRCODE = '55000';
  END IF;
  EXECUTE replace(body, p_old, p_new);
END $$;

-- ---------------------------------------------------------------------------
-- 1. Путь WhatsApp для служебной роли (таймер, команды оператора).
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.whatsapp_transport_read_v1(p_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_state platform_private.whatsapp_transport_state; v_channel platform_private.wazzup_channels;
BEGIN
  PERFORM platform_private.require_p2g_service();
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'whatsapp_transport_invalid_request' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_state FROM platform_private.whatsapp_transport_state s WHERE s.organization_id = p_organization_id;
  SELECT * INTO v_channel FROM platform_private.wazzup_channels c WHERE c.organization_id = p_organization_id;
  RETURN jsonb_build_object(
    'transport', COALESCE(v_state.active_transport, 'none'),
    'aiTriggerEnabled', COALESCE(v_state.ai_trigger_enabled, FALSE),
    'geminiEnabled', COALESCE(v_state.gemini_enabled, FALSE),
    'channel', CASE WHEN v_channel.organization_id IS NULL THEN NULL ELSE jsonb_build_object(
      'channelId', v_channel.channel_id, 'transport', v_channel.transport, 'last4', v_channel.phone_last4,
      'state', v_channel.state, 'observedAt', v_channel.observed_at) END);
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Сохранённые события Wazzup по идентификаторам (проверка A6: `wazzup-ops replay <id событий>`).
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.whatsapp_intake_events_read_v1(p_organization_id UUID, p_event_ids UUID[])
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_asked INTEGER; v_events JSONB;
BEGIN
  PERFORM platform_private.require_p2g_service();
  IF p_organization_id IS NULL OR p_event_ids IS NULL OR cardinality(p_event_ids) NOT BETWEEN 1 AND 100
    OR EXISTS (SELECT 1 FROM unnest(p_event_ids) AS x(id) WHERE x.id IS NULL) THEN
    RAISE EXCEPTION 'whatsapp_intake_events_invalid_request' USING ERRCODE = '22023';
  END IF;
  SELECT count(DISTINCT x.id) INTO v_asked FROM unnest(p_event_ids) AS x(id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'eventId', f.id,
      'eventType', f.event_type,
      'kind', CASE f.event_type WHEN 'channel.state' THEN 'channel' WHEN 'unparsed' THEN NULL ELSE 'message' END,
      'element', CASE WHEN f.event_type = 'unparsed' THEN NULL ELSE f.raw_payload END) ORDER BY f.ord), '[]'::JSONB)
    INTO v_events
  FROM (
    SELECT a.ord, e.id, e.event_type, e.raw_payload
    FROM (SELECT u.id, min(u.ord) AS ord FROM unnest(p_event_ids) WITH ORDINALITY AS u(id, ord) GROUP BY u.id) a
    JOIN platform_private.provider_webhook_events e ON e.id = a.id
    WHERE e.organization_id = p_organization_id AND e.provider = 'wazzup'
  ) f;
  RETURN jsonb_build_object('events', v_events, 'missing', v_asked - jsonb_array_length(v_events));
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Чтение пути для сотрудника: последние четыре цифры номера канала.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a326_replace('platform.staff_whatsapp_transport_v1(uuid)',
  $old$'transport', v_channel.transport, 'state', v_channel.state$old$,
  $new$'transport', v_channel.transport, 'last4', v_channel.phone_last4, 'state', v_channel.state$new$, 1, 'last4');

DROP FUNCTION pg_temp.a326_replace(TEXT, TEXT, TEXT, INTEGER, TEXT);

-- ---------------------------------------------------------------------------
-- Права: обе новые функции - только service_role. Заменённая функция сохраняет прежние права (CREATE OR REPLACE их не меняет).
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION platform.whatsapp_transport_read_v1(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
GRANT EXECUTE ON FUNCTION platform.whatsapp_transport_read_v1(UUID) TO service_role;
REVOKE ALL ON FUNCTION platform.whatsapp_intake_events_read_v1(UUID, UUID[])
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
GRANT EXECUTE ON FUNCTION platform.whatsapp_intake_events_read_v1(UUID, UUID[]) TO service_role;

COMMENT ON FUNCTION platform.whatsapp_transport_read_v1(UUID) IS
  '326: service-only; the active WhatsApp transport (none, waha, wazzup), the AI trigger and Gemini switches and the bound Wazzup channel (id, kind, last four digits, state word and time); no key, token, hash or phone number; writes nothing.';
COMMENT ON FUNCTION platform.whatsapp_intake_events_read_v1(UUID, UUID[]) IS
  '326: service-only; the stored Wazzup events of the organization by id (1 to 100), in request order, as the elements wazzup_webhook_persist_v1 accepts (message or channel; an unparsed event gives kind and element NULL); for the operator replay check, whose caller prints counts only; writes nothing.';

-- ---------------------------------------------------------------------------
-- Самопроверка: функции - определитель с пустым search_path, STABLE, EXECUTE только у service_role, владелец тот же, что у
-- функций 325; заменённая функция сохранила атрибуты, тело действительно новое и несёт ключ; число функций 325 не изменилось.
-- ---------------------------------------------------------------------------
DO $a326_verify$
DECLARE f REGPROCEDURE; p pg_catalog.pg_proc%ROWTYPE; b RECORD; v_owner OID;
BEGIN
  SELECT x.proowner INTO v_owner FROM pg_catalog.pg_proc x
  WHERE x.oid = 'platform.whatsapp_transport_configure_v1(uuid,text,boolean,boolean,uuid)'::REGPROCEDURE;
  FOREACH f IN ARRAY ARRAY[
    'platform.whatsapp_transport_read_v1(uuid)'::REGPROCEDURE,
    'platform.whatsapp_intake_events_read_v1(uuid,uuid[])'::REGPROCEDURE] LOOP
    SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid = f;
    IF NOT p.prosecdef OR p.provolatile <> 's' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
      OR p.proowner IS DISTINCT FROM v_owner
      OR NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
      OR has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
      OR has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE') OR has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')
      OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) THEN
      RAISE EXCEPTION 'a326_verify_service_function: %', f USING ERRCODE = '55000';
    END IF;
  END LOOP;
  -- Заменённая функция: права, владелец, определитель, изменчивость и search_path прежние; тело действительно новое.
  FOR b IN SELECT * FROM a326_before LOOP
    SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid = b.oid;
    IF p.prosecdef IS DISTINCT FROM b.prosecdef OR p.provolatile IS DISTINCT FROM b.provolatile
      OR p.proconfig IS DISTINCT FROM b.proconfig OR p.proacl::TEXT IS DISTINCT FROM b.acl OR p.proowner IS DISTINCT FROM b.proowner
      OR p.proleakproof IS DISTINCT FROM b.proleakproof OR p.proparallel IS DISTINCT FROM b.proparallel
      OR p.prorettype IS DISTINCT FROM b.prorettype OR p.proretset IS DISTINCT FROM b.proretset
      OR p.pronargdefaults IS DISTINCT FROM b.pronargdefaults THEN
      RAISE EXCEPTION 'a326_verify_attributes: %', b.sig USING ERRCODE = '55000';
    END IF;
    IF md5(p.prosrc) = (SELECT pin.md5sum FROM a326_pins pin WHERE pin.sig = b.sig) THEN
      RAISE EXCEPTION 'a326_verify_unchanged_body: %', b.sig USING ERRCODE = '55000';
    END IF;
  END LOOP;
  -- Чтение для сотрудника: ключ last4 стоит в теле и по-прежнему только у authenticated.
  SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid = 'platform.staff_whatsapp_transport_v1(uuid)'::REGPROCEDURE;
  IF strpos(p.prosrc, '''last4'', v_channel.phone_last4') = 0 OR strpos(p.prosrc, 'phone_sha256') <> 0
    OR NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
    OR has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('service_role', p.oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'a326_verify_staff_read' USING ERRCODE = '55000';
  END IF;
  -- Набор функций 325 не изменился: девять служебных функций и ни одной новой с их именами.
  IF (SELECT count(*) FROM pg_catalog.pg_proc x JOIN pg_catalog.pg_namespace n ON n.oid = x.pronamespace
      WHERE n.nspname = 'platform' AND (x.proname LIKE 'wazzup\_%\_v1' OR x.proname = 'whatsapp_transport_configure_v1')) <> 9 THEN
    RAISE EXCEPTION 'a326_verify_service_count' USING ERRCODE = '55000';
  END IF;
END
$a326_verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
