-- 325 «WhatsApp продаж через Wazzup: приём, проекция и запрет отправки» (решение владельца 26.10.2026: «Да, через Wazzup»;
-- план этапа 1 docs/EVO_WAZZUP_WHATSAPP_PLAN_2026-10-27.md §3.2, §5.2-§5.4, §6, §7, §9, §13 (PR #1307, редакция 2 после независимой
-- критики), срез W1: только база данных). Номер 325: на origin/main последняя 322, 323 занята параллельной веткой, 324 -
-- значение провайдера (эта серия); сверяется ещё раз перед слиянием (хуки набора привязаны к имени файла, не к номеру).
--
-- Зачем. WhatsApp продаж возвращается через Wazzup, а не через WAHA: Wazzup шлёт каждое сообщение вебхуком, EVO его принимает и
-- показывает в «Продажи → WhatsApp», но НЕ отвечает клиентам (этап 1 - только приём). Здесь - всё, что для этого нужно в базе:
-- модель переписки для второго провайдера, проекция событий в общие беседы, личность клиента без дублей, тревога о связи и
-- сверка, и - главное - запрет отправки и передачи текстов Gemini, который держится в базе, а не только в интерфейсе.
--
-- Что нового (ничего существующего не удаляется; повторный запуск целой миграции отказывает `a325_already_applied`):
--  a) Сырые события: проверки формы `provider_webhook_events` получают ветку `wazzup` (без сессии WAHA, счёт `wazzup:<канал>`,
--     события message / message.edited / message.deleted / channel.state / unparsed; вариант - SHA-256 элемента для правок,
--     удалений и состояний канала); деловой ключ Wazzup. Ветки WAHA, kommo и amocrm прежние.
--  b) Восемь закрытых таблиц `platform_private`: `wazzup_channels` (привязанный канал, один на организацию; номера нет -
--     последние четыре цифры и SHA-256), `wazzup_chat_bindings` (номер клиента -> беседа, как он определён; только добавление),
--     `wazzup_message_bindings` (messageId -> сообщение; меняется только отметка удаления клиентом, один раз),
--     `wazzup_event_projections` (итог проекции события и очередь догрузки), `wazzup_daily_counters` (суточные количества по
--     Бишкеку: отфильтрованное, статусы, автоэхо, битые элементы), `whatsapp_transport_state` (действующий путь none / waha /
--     wazzup и выключатели ИИ и Gemini без выпуска; send_enabled при wazzup всегда false), `wazzup_api_key_bindings` (ссылка на
--     ключ в Vault и отпечаток), `wazzup_operator_events` (журнал команд оператора, только добавление).
--  c) Беседы: `waha_session_name` необязателен, новое `wazzup_channel_id`; ровно одно из двух; канал беседы неизменяем (триггер
--     защиты идентичности пересоздан с тем же списком плюс это поле). Сообщения: два источника личности -
--     `private_wazzup_binding` (входящее) и `private_wazzup_echo_binding` (ответ продавца без авторизации EVO); отложенный
--     триггер требует точную привязку, событие Wazzup того же канала, messageId и чат беседы.
--  d) Приём (service_role): `wazzup_webhook_persist_v1` - порция до 100 элементов, каждый в своей подтранзакции, идемпотентно;
--     ничего не пишет, пока путь не wazzup; чужой канал и не личный WhatsApp только считаются; код привязки устройства из
--     состояния канала не сохраняется; битый элемент - событие `unparsed`. `wazzup_daily_counts_v1` - количества для суточной сверки.
--  e) Проекция (service_role): `wazzup_project_event_v1` и `wazzup_projection_sweep_v1` (старейшие pending/failed, до 8 попыток,
--     по времени сообщения; возраст самого старого - в ответе). Новый номер: студент по правилу 316 -> совпадение по номеру
--     (единственный клиент; лид - его единственный открытый лид) -> новый клиент БЕЗ лида; несколько клиентов на номере -
--     беседа без клиента (`ambiguous`), агенту закрыта. Ответ продавца (эхо с authorId или sentFromApp) - исходящее своей
--     беседы; автоматическое эхо в беседу не попадает; ответ до беседы ждёт и добавляется при первом входящем. Метки медиа - ровно
--     формата 259. Правка не проецируется; удаление клиентом скрывает текст от ИИ.
--  f) Команды оператора (service_role): `wazzup_channel_bind_v1`, `wazzup_channel_observe_v1`, `whatsapp_transport_configure_v1`
--     (переключение на wazzup закрывает открытые тревоги `crm_primary`), `wazzup_api_key_provision_v1` (ключ только в Vault) и
--     `wazzup_api_key_resolve_v1` (чтение ключа для задачи таймера: сверх плана, образец resolve_manual_send_waha_runtime, 080).
--  g) ВОРОТА ОТПРАВКИ `platform_private.whatsapp_send_allowed` - один источник правды для шести путей: инструмент агента
--     `send_message` (черновик `receive_only`, никогда прямой отправки; и без Wazzup прямая отправка только при состоянии
--     `connected`), авторизация черновика, отметка черновика, ночной автоответчик (due, commit, authorize), ручной ответ
--     сотрудника, захват уже авторизованной работы. Закрыты, пока действующий путь wazzup (любая беседа, и старые беседы WAHA
--     тоже) или беседа пришла через Wazzup.
--  h) ВОРОТА GEMINI `platform_private.whatsapp_gemini_allowed`: поллер входящих, память, ночная сводка, окно ИИ в чате и его
--     билет, автоответчик (`wazzup_ai_off`) - беседа Wazzup тексты Gemini не отдаёт, пока владелец не включит флаг командой.
--  i) Чтение переписки агентами: при закрытых воротах `whatsapp_state = receive_only`, `can_reply = false`; беседа с неопределённым
--     клиентом закрыта (`identity_unresolved`, строки аудита чтения нет); удалённое клиентом сообщение - `text: null, deleted: true`.
--  j) Тревога о связи (321): сессия `wazzup`, вид `gap` (суточная сверка), причины закрытия `transport_switched`, `counts_match`;
--     для Wazzup последнее входящее - событие `message` с isEcho = false за 30 суток; слова задачи по сессии (номеров нет).
--  k) Имя и номер в списке чатов (278) для бесед Wazzup; чтение пути для сотрудника `staff_whatsapp_transport_v1`
--     (communication.read.full): путь, можно ли отвечать, состояние и вид канала.
--  l) Сверх плана, ради паритета с WAHA (085): происхождение `wazzup` в `subject_provenance` и `external_identifiers` скрыто так же,
--     как `waha` - политикой чтения и карточками клиента и лида (иначе «Wazzup» и номер канала попали бы в карточку клиента).
--
-- Заменяются двадцать пять функций (каждая привязана к md5 прежнего определения: чужой дрейф останавливает миграцию, ничего не
-- меняя; снимок прав, владельца, определителя и search_path сверяется в конце): шесть путей отправки (`ai_agent_tool_send_message_v1`,
-- `ai_agent_runtime_whatsapp_authorize_v1`, `ai_agent_runtime_draft_mark_v1`, `ai_autosend_check`,
-- `request_manual_whatsapp_send_with_authorization`, `claim_manual_whatsapp_send_item`), два чтения агентов (`get_conversation`,
-- `list_conversations`), шесть путей Gemini (`inbound_since_v1`, `ai_memory_poke`, `memory_context_v1`, `autosend_summary_context_v1`,
-- `ai_agent_ticket_v1`, `ai_ticket_allowed`; сверх списка плана - ещё два устаревших предложения Gemini U9 `request_gemini_proposal` и
-- `begin_gemini_proposal`: у них нет вызывающего кода, но права остались, 320 закрыл их тем же правилом) и слова причин автоответчика, пять функций 321 (страж, чтение, открытие, закрытие и задача;
-- задача - сверх списка плана, она берёт слова по сессии), помощник списка чатов 278 и две карточки (клиент, лид). Тела меняются
-- заменой проверенных фрагментов (приём 282/320).
--
-- Отклонения от плана (записаны честно): (1) команды оператора пишутся в собственный журнал `wazzup_operator_events`, а не в
-- `platform.audit_events`: новые действия в общем списке журнала тянут правку словарей приложения и набора журнала, это W2; те же
-- поля, только добавление, ключ и номер в журнал не попадают; (2) захват работы при закрытых воротах отвечает прежней формой
-- «захватывать нечего» (ровно три ключа: приложение разбирает их строго), слово `receive_only` у него не нужно; (3) уход с Wazzup
-- закрывает открытые тревоги Wazzup (причина `transport_switched`), иначе они остались бы задачами навсегда.
--
-- Порядок выката. Миграция без приложения безвредна: строки Wazzup появляются только после переключения пути командой оператора
-- (этапы W2-W3 и порядок §11 плана); пока строк нет, старое приложение читает ровно то, что читало. Для WAHA меняется одно:
-- агент больше не отправляет напрямую при НЕИЗВЕСТНОМ состоянии канала (нет строки здоровья сессии) - готовит черновик.
-- Откат: forward-only; `transport none` возвращает агентам и интерфейсу прежнее поведение, беседы Wazzup остаются неотправляемыми.
BEGIN;

-- ---------------------------------------------------------------------------
-- Якоря: объекты, на которые опирается миграция; новые имена свободны; md5 заменяемых тел (приём 303/316/320).
-- Расхождение останавливает миграцию, ничего не меняя. Определения проверок и триггера, которые пересоздаются,
-- сверяются по смысловым маркерам (не по тексту разбора: тот зависит от версии сервера).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE a325_pins (sig TEXT PRIMARY KEY, md5sum TEXT NOT NULL) ON COMMIT DROP;
INSERT INTO a325_pins (sig, md5sum) VALUES
  -- Шесть путей отправки (ворота отправки, §6 B.9): 318 (инструмент), 317 (авторизация, отметка), 276/320 (автоответчик),
  -- 050 (ручная отправка), 266 (захват).
  ('platform.ai_agent_tool_send_message_v1(uuid,text,jsonb)', '5ef8e0cf8f7594bddc55eedcf6cc49b3'),
  ('platform.ai_agent_runtime_whatsapp_authorize_v1(uuid,uuid,uuid,text,uuid)', 'eebd9f5efde3f941d815486092a8cdd1'),
  ('platform.ai_agent_runtime_draft_mark_v1(uuid,uuid,text,text,uuid,jsonb)', '6c6c73320bf817ccca2af1387a0a20f6'),
  ('platform_private.ai_autosend_check(platform_private.ai_autosend_log,text,text,bigint[])', 'ac691666e20a5a4ee2da0cba08d31b71'),
  ('platform.request_manual_whatsapp_send_with_authorization(uuid,uuid,uuid,uuid,text,text,text,uuid)', '5a2689b4b1e7e61a6a8b5c155c5fe6a9'),
  ('platform.claim_manual_whatsapp_send_item(uuid,uuid,integer,text,uuid)', '53f27c1f3f33cbc36b554f7f01986736'),
  -- Чтение переписки агентами (320).
  ('platform.ai_agent_tool_get_conversation_v1(uuid,text,jsonb)', '6a073b4308ec0c615f0b1d466cba2fa6'),
  ('platform.ai_agent_tool_list_conversations_v1(uuid,text,jsonb)', 'bf232b4fd7233de3c0438f1d8c99595b'),
  -- Пути Gemini (ворота Gemini, §6 B.11): P3 опрос, память, ночная сводка, окно ИИ в чате и его проверка (320).
  ('platform_ai_agent.inbound_since_v1(timestamptz,uuid,integer)', 'eeb3018740105333350481895344cdb1'),
  ('platform_private.ai_memory_poke(uuid,boolean,integer)', '115a2cfc6ed3dd596f8a11f234723cf8'),
  ('platform_ai_agent.memory_context_v1(uuid,text,integer)', 'ae7d308d250db120ac8639a5ebc7fade'),
  ('platform_ai_agent.autosend_summary_context_v1(uuid,text,integer)', '993b3a755b101d5f9b4e6eb83a7e10b0'),
  ('platform.ai_agent_ticket_v1(uuid,text,uuid,uuid)', 'cd1c49547c5a9dd951b564860b26ede9'),
  ('platform_private.ai_ticket_allowed(platform_private.ai_tickets)', '443a23780ddbec9b5b4cf968eb36a46b'),
  ('platform_private.ai_autosend_reason_ru(text)', '3852f2bfac8bc492192845901b9ebde9'),
  -- Устаревшие предложения Gemini U9 (066, 320): у них нет вызывающего кода, но права остались - путь закрывается тем же воротом.
  ('platform.request_gemini_proposal(uuid,uuid,uuid,uuid,text,integer,text,text)', '1cac7c1dcb0dd6685498810bf8fe1541'),
  ('platform.begin_gemini_proposal(uuid,uuid,uuid,uuid,text,integer,text)', 'dddef3772d83d9323132d5f8759c8503'),
  -- Тревога о связи (321): страж, чтение, открытие, закрытие и задача.
  ('platform_private.whatsapp_health_guard(uuid,text)', 'ff26172eaec81582086c209adc188855'),
  ('platform.whatsapp_health_read_v1(uuid,text)', '4c63ea36194bfa3521944769101e25ff'),
  ('platform.whatsapp_health_open_v1(uuid,text,text,text,uuid)', '2ae7d3c22de2aa1fbd0a3bfe60f42bce'),
  ('platform.whatsapp_health_resolve_v1(uuid,text,text,text)', 'b1ecbc8660a39aaab1599a9b67244697'),
  ('platform_private.whatsapp_health_make_task(uuid,uuid,uuid,text,text)', '0e148bd12682c6be34ebe5412b4a6f7e'),
  -- Имя и номер в списке чатов (278) и карточки клиента и лида (085/084): происхождение Wazzup скрыто, как у WAHA.
  ('platform_private.waha_conversation_contact(uuid,uuid)', 'ee5e547bfe625ffaf3b97b3cd5b59c96'),
  ('platform.staff_canonical_client_detail(uuid)', 'c71f838448a0832b70e47a28ba08b0de'),
  ('platform.staff_canonical_lead_detail(uuid)', '44b1c148a07d30d33d4514753b83a4f3');

DO $a325_anchor$
DECLARE r RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_enum e
      WHERE e.enumtypid = 'platform.communication_provider'::REGTYPE AND e.enumlabel = 'wazzup') THEN
    RAISE EXCEPTION 'a325_anchor_drift: migration 324 (the wazzup provider value) is not applied' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('platform_private.provider_webhook_events') IS NULL
    OR to_regclass('platform.communication_conversations') IS NULL
    OR to_regclass('platform.communication_messages') IS NULL
    OR to_regclass('platform.conversation_participants') IS NULL
    OR to_regclass('platform.conversation_handoff_events') IS NULL
    OR to_regclass('platform.record_scopes') IS NULL
    OR to_regclass('platform.membership_scope_assignments') IS NULL
    OR to_regclass('platform.clients') IS NULL
    OR to_regclass('platform.leads') IS NULL
    OR to_regclass('platform.student_cases') IS NULL
    OR to_regclass('platform.subject_provenance') IS NULL
    OR to_regclass('platform.external_identifiers') IS NULL
    OR to_regclass('platform_private.ai_agent_drafts') IS NULL
    OR to_regclass('platform_private.whatsapp_health_monitor') IS NULL
    OR to_regclass('platform_private.whatsapp_health_alerts') IS NULL
    OR to_regclass('platform_private.waha_direct_chat_bindings') IS NULL
    OR to_regprocedure('platform_private.require_p2g_service()') IS NULL
    OR to_regprocedure('platform_private.block_append_only_mutation()') IS NULL
    OR to_regprocedure('platform_private.protect_domain_identity()') IS NULL
    OR to_regprocedure('platform_private.p3c_request_child_id(uuid,text)') IS NULL
    OR to_regprocedure('platform_private.staff_intake_owner_is_eligible(uuid,uuid)') IS NULL
    OR to_regprocedure('platform_private.create_or_link_client(uuid,text,text,text,text,text,text,text,timestamptz,timestamptz,text)') IS NULL
    OR to_regprocedure('platform_private.person_phone_match_keys(text)') IS NULL
    OR to_regprocedure('platform_private.normalize_person_name(text)') IS NULL
    OR to_regprocedure('platform_private.whatsapp_masked_phone(text)') IS NULL
    OR to_regprocedure('platform_private.waha_generated_conversation_subject(text,uuid)') IS NULL
    OR to_regprocedure('platform_private.waha_generated_client_name(text,text,text,uuid)') IS NULL
    OR to_regprocedure('platform_private.ai_agent_conversation_ai_allowed(uuid,uuid)') IS NULL
    OR to_regprocedure('platform_private.ai_agent_whatsapp_state(uuid,text)') IS NULL
    OR to_regprocedure('platform_private.require_domain_actor_read(uuid,text)') IS NULL
    OR to_regprocedure('private.platform_can_read_canonical_client(uuid,uuid)') IS NULL
    OR to_regprocedure('platform_private.whatsapp_health_assignable(uuid,uuid)') IS NULL
    OR to_regprocedure('platform_private.whatsapp_health_title(text,text)') IS NULL
    OR to_regprocedure('platform_private.whatsapp_health_text(text,text)') IS NULL
    OR to_regprocedure('vault.create_secret(text,text,text,uuid)') IS NULL
    OR to_regprocedure('vault.update_secret(uuid,text,text,text,uuid)') IS NULL
  THEN
    RAISE EXCEPTION 'a325_anchor_drift: the 044 / 259 / 278 / 317 / 320 / 321 objects this migration builds on are missing' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('platform_private.wazzup_channels') IS NOT NULL
    OR to_regclass('platform_private.wazzup_chat_bindings') IS NOT NULL
    OR to_regclass('platform_private.wazzup_message_bindings') IS NOT NULL
    OR to_regclass('platform_private.wazzup_event_projections') IS NOT NULL
    OR to_regclass('platform_private.wazzup_daily_counters') IS NOT NULL
    OR to_regclass('platform_private.whatsapp_transport_state') IS NOT NULL
    OR to_regclass('platform_private.wazzup_api_key_bindings') IS NOT NULL
    OR to_regclass('platform_private.wazzup_operator_events') IS NOT NULL
    OR to_regprocedure('platform_private.whatsapp_send_allowed(uuid,uuid)') IS NOT NULL
    OR to_regprocedure('platform_private.whatsapp_gemini_allowed(uuid,uuid)') IS NOT NULL
    OR to_regprocedure('platform.whatsapp_transport_configure_v1(uuid,text,boolean,boolean,uuid)') IS NOT NULL
    OR to_regprocedure('platform.wazzup_webhook_persist_v1(uuid,text,text,jsonb,jsonb)') IS NOT NULL
    OR to_regprocedure('platform.staff_whatsapp_transport_v1(uuid)') IS NOT NULL
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = 'platform.communication_conversations'::REGCLASS AND a.attname = 'wazzup_channel_id' AND NOT a.attisdropped)
  THEN
    RAISE EXCEPTION 'a325_already_applied' USING ERRCODE = '55000';
  END IF;
  -- Проверки и триггер, которые пересоздаются, остались ровно такими, какими их оставили 044 / 060 / 259 / 321.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid = 'platform_private.provider_webhook_events'::REGCLASS
        AND c.conname = 'provider_webhook_events_waha_shape_check'
        AND pg_get_constraintdef(c.oid) LIKE '%kommo%' AND pg_get_constraintdef(c.oid) LIKE '%amocrm%'
        AND pg_get_constraintdef(c.oid) NOT LIKE '%wazzup%')
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid = 'platform_private.provider_webhook_events'::REGCLASS
        AND c.conname = 'provider_webhook_events_variant_shape_check'
        AND pg_get_constraintdef(c.oid) LIKE '%message.ack%' AND pg_get_constraintdef(c.oid) LIKE '%message.any%'
        AND pg_get_constraintdef(c.oid) NOT LIKE '%wazzup%')
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid = 'platform.communication_messages'::REGCLASS
        AND c.conname = 'communication_messages_direction_shape_check'
        AND pg_get_constraintdef(c.oid) LIKE '%private_waha_phone_binding%' AND pg_get_constraintdef(c.oid) NOT LIKE '%wazzup%')
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid = 'platform.communication_messages'::REGCLASS
        AND c.conname = 'communication_messages_provider_identity_check'
        AND pg_get_constraintdef(c.oid) LIKE '%private_waha_phone_binding%' AND pg_get_constraintdef(c.oid) NOT LIKE '%wazzup%')
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid = 'platform.communication_conversations'::REGCLASS
        AND t.tgname = 'communication_conversations_identity_immutable' AND NOT t.tgisinternal
        AND pg_get_triggerdef(t.oid) LIKE '%''created_from_webhook_event_id''%' AND pg_get_triggerdef(t.oid) NOT LIKE '%wazzup%')
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid = 'platform_private.whatsapp_health_monitor'::REGCLASS
        AND c.conname = 'whatsapp_health_monitor_session_check' AND pg_get_constraintdef(c.oid) LIKE '%crm_primary%'
        AND pg_get_constraintdef(c.oid) NOT LIKE '%wazzup%')
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid = 'platform_private.whatsapp_health_alerts'::REGCLASS
        AND c.conname = 'whatsapp_health_alerts_session_check' AND pg_get_constraintdef(c.oid) LIKE '%crm_primary%'
        AND pg_get_constraintdef(c.oid) NOT LIKE '%wazzup%')
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid = 'platform_private.whatsapp_health_alerts'::REGCLASS
        AND c.conname = 'whatsapp_health_alerts_kind_check' AND pg_get_constraintdef(c.oid) LIKE '%silent%'
        AND pg_get_constraintdef(c.oid) NOT LIKE '%gap%')
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid = 'platform_private.whatsapp_health_alerts'::REGCLASS
        AND c.conname = 'whatsapp_health_alerts_resolved_check' AND pg_get_constraintdef(c.oid) LIKE '%messages_arrived%'
        AND pg_get_constraintdef(c.oid) NOT LIKE '%transport_switched%')
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid = 'platform.communication_conversations'::REGCLASS
        AND a.attname = 'waha_session_name' AND a.attnotnull)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid = 'platform.subject_provenance'::REGCLASS
        AND p.polname = 'subject_provenance_read' AND pg_get_expr(p.polqual, p.polrelid) LIKE '%waha%'
        AND pg_get_expr(p.polqual, p.polrelid) NOT LIKE '%wazzup%')
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid = 'platform.external_identifiers'::REGCLASS
        AND p.polname = 'external_identifiers_read' AND pg_get_expr(p.polqual, p.polrelid) LIKE '%waha%'
        AND pg_get_expr(p.polqual, p.polrelid) NOT LIKE '%wazzup%')
  THEN
    RAISE EXCEPTION 'a325_anchor_drift: a check, trigger or policy this migration recreates is not the 044 / 060 / 085 / 259 / 321 one' USING ERRCODE = '55000';
  END IF;
  FOR r IN SELECT p.sig, p.md5sum FROM a325_pins p LOOP
    IF (SELECT md5(x.prosrc) FROM pg_catalog.pg_proc x WHERE x.oid = to_regprocedure(r.sig)) IS DISTINCT FROM r.md5sum THEN
      RAISE EXCEPTION 'a325_anchor_drift: % is not the expected definition', r.sig USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$a325_anchor$;

-- Снимок атрибутов заменяемых функций: после замены права, владелец, определитель, изменчивость и search_path те же.
CREATE TEMP TABLE a325_before ON COMMIT DROP AS
  SELECT p.oid, pins.sig, p.prosecdef, p.provolatile, p.proconfig, p.proacl::TEXT AS acl, p.proowner, p.proleakproof,
    p.proparallel, p.prorettype, p.proretset, p.pronargdefaults
  FROM a325_pins pins JOIN pg_catalog.pg_proc p ON p.oid = to_regprocedure(pins.sig);

-- Замена фрагмента в теле функции (приём 282/320): фрагмент обязан встретиться ровно столько раз, сколько ожидается, и
-- запрещённая метка (уже внесённая правка) не должна быть в теле, иначе миграция падает, ничего не меняя. CREATE OR
-- REPLACE сохраняет владельца и права.
CREATE FUNCTION pg_temp.a325_replace(p_signature TEXT, p_old TEXT, p_new TEXT, p_count INTEGER, p_forbid TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE body TEXT; matches INTEGER;
BEGIN
  body := pg_get_functiondef(to_regprocedure(p_signature));
  matches := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  IF body IS NULL OR matches IS DISTINCT FROM p_count OR (p_forbid IS NOT NULL AND strpos(body, p_forbid) <> 0) THEN
    RAISE EXCEPTION 'a325_replace_drift: % expected %, found %', p_signature, p_count, matches USING ERRCODE = '55000';
  END IF;
  EXECUTE replace(body, p_old, p_new);
END $$;

-- ---------------------------------------------------------------------------
-- 1. Сырые события: проверки формы получают ветку `wazzup`, ключ идемпотентности. Ветки WAHA, kommo, amocrm прежние.
-- ---------------------------------------------------------------------------
ALTER TABLE platform_private.provider_webhook_events DROP CONSTRAINT provider_webhook_events_waha_shape_check;
ALTER TABLE platform_private.provider_webhook_events ADD CONSTRAINT provider_webhook_events_waha_shape_check CHECK (
  (provider = 'waha' AND waha_session_name IS NOT NULL AND btrim(waha_session_name) <> '' AND provider_conversation_ref IS NULL)
  OR (provider = 'kommo' AND waha_session_name IS NULL AND provider_conversation_ref IS NOT NULL
    AND btrim(provider_conversation_ref) <> '')
  OR (provider = 'amocrm' AND waha_session_name IS NULL AND provider_conversation_ref IS NULL)
  OR (provider = 'wazzup' AND waha_session_name IS NULL AND provider_conversation_ref IS NULL
    AND provider_account_ref ~ '^wazzup:[0-9a-f-]{36}$'
    AND event_type IN ('message', 'message.edited', 'message.deleted', 'channel.state', 'unparsed'))
);
ALTER TABLE platform_private.provider_webhook_events DROP CONSTRAINT provider_webhook_events_variant_shape_check;
ALTER TABLE platform_private.provider_webhook_events ADD CONSTRAINT provider_webhook_events_variant_shape_check CHECK (
  (provider = 'waha' AND event_type = 'message.ack' AND provider_event_variant_ref IS NOT NULL
    AND btrim(provider_event_variant_ref) <> '')
  OR (provider = 'waha' AND event_type = 'message.any' AND provider_event_variant_ref IS NULL)
  OR (provider = 'waha' AND event_type NOT IN ('message.ack', 'message.any'))
  OR provider IN ('kommo', 'amocrm')
  OR (provider = 'wazzup' AND (
    (event_type IN ('message', 'unparsed') AND provider_event_variant_ref IS NULL)
    OR (event_type IN ('message.edited', 'message.deleted', 'channel.state') AND provider_event_variant_ref IS NOT NULL
      AND provider_event_variant_ref ~ '^[0-9a-f]{64}$')))
);
-- Деловой ключ Wazzup: событие + идентификатор + вариант (SHA-256 элемента для правок, удалений и состояния канала).
-- Общий ключ по provider_request_id (044) остаётся.
CREATE UNIQUE INDEX provider_webhook_events_wazzup_business_key
  ON platform_private.provider_webhook_events (
    organization_id, provider_account_ref, event_type, payload_id, COALESCE(provider_event_variant_ref, ''))
  WHERE provider = 'wazzup';

-- ---------------------------------------------------------------------------
-- 2. Таблицы Wazzup (platform_private, закрыты для всех ролей API).
-- ---------------------------------------------------------------------------

-- Привязанный канал приёма: один на организацию. Самого номера нет: последние 4 цифры и SHA-256 номера.
CREATE TABLE platform_private.wazzup_channels (
  organization_id UUID NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  channel_id UUID NOT NULL,
  transport TEXT NOT NULL,
  phone_last4 TEXT NOT NULL,
  phone_sha256 TEXT NOT NULL,
  state TEXT,
  observed_at TIMESTAMPTZ,
  bound_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  request_id UUID NOT NULL,
  CONSTRAINT wazzup_channels_pkey PRIMARY KEY (organization_id),
  CONSTRAINT wazzup_channels_channel_key UNIQUE (organization_id, channel_id),
  CONSTRAINT wazzup_channels_transport_check CHECK (transport IN ('whatsapp', 'wapi')),
  CONSTRAINT wazzup_channels_last4_check CHECK (phone_last4 ~ '^[0-9]{4}$'),
  CONSTRAINT wazzup_channels_phone_sha_check CHECK (phone_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT wazzup_channels_state_check CHECK (state IS NULL OR state ~ '^[A-Za-z][A-Za-z0-9_]{0,63}$'),
  CONSTRAINT wazzup_channels_observed_check CHECK ((state IS NULL) = (observed_at IS NULL))
);
COMMENT ON TABLE platform_private.wazzup_channels IS
  '325: the one Wazzup channel the organization receives WhatsApp from (no phone number: last four digits and a SHA-256 only); state is the last Wazzup state word seen.';

-- Привязка чата: номер клиента в канале -> беседа. Только добавление.
CREATE TABLE platform_private.wazzup_chat_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  channel_id UUID NOT NULL,
  chat_digits TEXT NOT NULL,
  conversation_id UUID NOT NULL,
  source_webhook_event_id UUID NOT NULL,
  identity_state TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT wazzup_chat_bindings_chat_key UNIQUE (organization_id, channel_id, chat_digits),
  CONSTRAINT wazzup_chat_bindings_conversation_key UNIQUE (organization_id, conversation_id),
  CONSTRAINT wazzup_chat_bindings_organization_id_id_key UNIQUE (organization_id, id),
  CONSTRAINT wazzup_chat_bindings_digits_check CHECK (chat_digits ~ '^[1-9][0-9]{6,14}$'),
  CONSTRAINT wazzup_chat_bindings_identity_check CHECK (identity_state IN ('matched_case', 'matched_phone', 'new_client', 'ambiguous')),
  CONSTRAINT wazzup_chat_bindings_channel_fkey FOREIGN KEY (organization_id, channel_id)
    REFERENCES platform_private.wazzup_channels(organization_id, channel_id) ON DELETE RESTRICT,
  CONSTRAINT wazzup_chat_bindings_conversation_fkey FOREIGN KEY (organization_id, conversation_id)
    REFERENCES platform.communication_conversations(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT wazzup_chat_bindings_source_fkey FOREIGN KEY (organization_id, source_webhook_event_id)
    REFERENCES platform_private.provider_webhook_events(organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX wazzup_chat_bindings_source_idx ON platform_private.wazzup_chat_bindings (organization_id, source_webhook_event_id);
COMMENT ON TABLE platform_private.wazzup_chat_bindings IS
  '325: (organization, Wazzup channel, customer digits) -> conversation, with how the customer was identified; append-only.';

-- Привязка сообщения: идентификатор Wazzup -> строка беседы. Меняется только отметка удаления клиентом, один раз.
CREATE TABLE platform_private.wazzup_message_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  channel_id UUID NOT NULL,
  wazzup_message_id TEXT NOT NULL,
  communication_message_id UUID NOT NULL,
  source_webhook_event_id UUID NOT NULL,
  kind TEXT NOT NULL,
  sender_deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT wazzup_message_bindings_provider_key UNIQUE (organization_id, channel_id, wazzup_message_id),
  CONSTRAINT wazzup_message_bindings_message_key UNIQUE (organization_id, communication_message_id),
  CONSTRAINT wazzup_message_bindings_message_id_check CHECK (btrim(wazzup_message_id) <> '' AND char_length(wazzup_message_id) <= 128),
  CONSTRAINT wazzup_message_bindings_kind_check CHECK (kind IN ('inbound', 'staff_echo')),
  CONSTRAINT wazzup_message_bindings_channel_fkey FOREIGN KEY (organization_id, channel_id)
    REFERENCES platform_private.wazzup_channels(organization_id, channel_id) ON DELETE RESTRICT,
  CONSTRAINT wazzup_message_bindings_message_fkey FOREIGN KEY (organization_id, communication_message_id)
    REFERENCES platform.communication_messages(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT wazzup_message_bindings_source_fkey FOREIGN KEY (organization_id, source_webhook_event_id)
    REFERENCES platform_private.provider_webhook_events(organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX wazzup_message_bindings_source_idx ON platform_private.wazzup_message_bindings (organization_id, source_webhook_event_id);
COMMENT ON TABLE platform_private.wazzup_message_bindings IS
  '325: Wazzup message id -> stored message (inbound or a staff echo); only sender_deleted_at may be set, once.';

-- Итог проекции события: pending (записано, не разобрано) -> один из итогов. Не журнал: строка меняется.
CREATE TABLE platform_private.wazzup_event_projections (
  organization_id UUID NOT NULL,
  event_id UUID NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_code TEXT,
  conversation_id UUID,
  message_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT wazzup_event_projections_pkey PRIMARY KEY (organization_id, event_id),
  CONSTRAINT wazzup_event_projections_event_fkey FOREIGN KEY (organization_id, event_id)
    REFERENCES platform_private.provider_webhook_events(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT wazzup_event_projections_state_check CHECK (state IN
    ('pending', 'projected', 'deferred', 'ignored', 'ignored_auto_echo', 'needs_review', 'failed')),
  CONSTRAINT wazzup_event_projections_attempts_check CHECK (attempts BETWEEN 0 AND 1000),
  CONSTRAINT wazzup_event_projections_code_check CHECK (last_code IS NULL OR last_code ~ '^[A-Za-z0-9_:.-]{1,64}$')
);
CREATE INDEX wazzup_event_projections_work_idx
  ON platform_private.wazzup_event_projections (organization_id, created_at, event_id) WHERE state IN ('pending', 'failed');
CREATE INDEX wazzup_event_projections_deferred_idx
  ON platform_private.wazzup_event_projections (organization_id, state, created_at) WHERE state = 'deferred';
COMMENT ON TABLE platform_private.wazzup_event_projections IS
  '325: projection state of each stored Wazzup event; pending/failed rows are the sweep queue.';

-- Суточные счётчики (сутки по Бишкеку): только количества, без номеров и текстов.
CREATE TABLE platform_private.wazzup_daily_counters (
  organization_id UUID NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  day DATE NOT NULL,
  counter TEXT NOT NULL,
  n BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT wazzup_daily_counters_pkey PRIMARY KEY (organization_id, day, counter),
  CONSTRAINT wazzup_daily_counters_counter_check CHECK (counter ~ '^[a-z][a-z0-9_]{0,39}$'),
  CONSTRAINT wazzup_daily_counters_n_check CHECK (n >= 0)
);
COMMENT ON TABLE platform_private.wazzup_daily_counters IS
  '325: per Bishkek day counts of what the Wazzup intake saw but did not store (other channels, statuses, automatic echoes, unparsed or failed elements); no numbers, no texts.';

-- Действующий путь WhatsApp и выключатели без выпуска. Нет строки = none.
CREATE TABLE platform_private.whatsapp_transport_state (
  organization_id UUID NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  active_transport TEXT NOT NULL DEFAULT 'none',
  send_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ai_trigger_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  gemini_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  version BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT whatsapp_transport_state_pkey PRIMARY KEY (organization_id),
  CONSTRAINT whatsapp_transport_state_transport_check CHECK (active_transport IN ('none', 'waha', 'wazzup')),
  -- Этап 1: отправки нет, пока путь Wazzup. Этап 2 снимет проверку отдельной миграцией вместе с воротами.
  CONSTRAINT whatsapp_transport_state_send_check CHECK (active_transport <> 'wazzup' OR NOT send_enabled),
  CONSTRAINT whatsapp_transport_state_version_check CHECK (version > 0)
);
COMMENT ON TABLE platform_private.whatsapp_transport_state IS
  '325: the one active WhatsApp transport (none, waha, wazzup), the send flag (always false for wazzup in stage 1), the AI trigger flag and the Gemini flag; changed by the operator command without a release.';

-- Ключ Wazzup: само значение только в Vault; здесь ссылка и отпечаток (как привязка WAHA, 081).
CREATE TABLE platform_private.wazzup_api_key_bindings (
  organization_id UUID NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  api_key_secret_id UUID NOT NULL,
  api_key_sha256 TEXT NOT NULL,
  binding_version BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT wazzup_api_key_bindings_pkey PRIMARY KEY (organization_id),
  CONSTRAINT wazzup_api_key_bindings_sha_check CHECK (api_key_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT wazzup_api_key_bindings_version_check CHECK (binding_version BETWEEN 1 AND 9007199254740991)
);
COMMENT ON TABLE platform_private.wazzup_api_key_bindings IS
  '325: pointer to the Wazzup API key in Supabase Vault and its SHA-256; the key itself never lives in a table.';

-- Журнал команд оператора (привязка канала, переключение транспорта, ключ). Только добавление; только безопасные поля.
CREATE TABLE platform_private.wazzup_operator_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  request_id UUID NOT NULL,
  action TEXT NOT NULL,
  input_sha256 TEXT NOT NULL,
  before_state JSONB,
  after_state JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT wazzup_operator_events_request_key UNIQUE (request_id),
  CONSTRAINT wazzup_operator_events_action_check CHECK (action IN ('transport.configure', 'channel.bind', 'key.provision')),
  CONSTRAINT wazzup_operator_events_input_check CHECK (input_sha256 ~ '^[0-9a-f]{64}$')
);
CREATE INDEX wazzup_operator_events_org_idx ON platform_private.wazzup_operator_events (organization_id, created_at DESC);
COMMENT ON TABLE platform_private.wazzup_operator_events IS
  '325: append-only journal of the operator commands for the Wazzup path (transport, channel, key); safe fields only, no key, no phone number.';

-- Замки «только добавление» (общий замок 044/280) и особый замок привязки сообщения.
CREATE TRIGGER wazzup_chat_bindings_append_only BEFORE DELETE OR UPDATE ON platform_private.wazzup_chat_bindings
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER wazzup_chat_bindings_no_truncate BEFORE TRUNCATE ON platform_private.wazzup_chat_bindings
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER wazzup_operator_events_append_only BEFORE DELETE OR UPDATE ON platform_private.wazzup_operator_events
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER wazzup_operator_events_no_truncate BEFORE TRUNCATE ON platform_private.wazzup_operator_events
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE FUNCTION platform_private.wazzup_message_bindings_update_guard()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF (to_jsonb(NEW) - 'sender_deleted_at') IS DISTINCT FROM (to_jsonb(OLD) - 'sender_deleted_at')
    OR (OLD.sender_deleted_at IS NOT NULL AND NEW.sender_deleted_at IS DISTINCT FROM OLD.sender_deleted_at) THEN
    RAISE EXCEPTION 'platform_private.wazzup_message_bindings is append-only; only sender_deleted_at may be set, once'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER wazzup_message_bindings_update_guard BEFORE UPDATE ON platform_private.wazzup_message_bindings
  FOR EACH ROW EXECUTE FUNCTION platform_private.wazzup_message_bindings_update_guard();
CREATE TRIGGER wazzup_message_bindings_no_delete BEFORE DELETE ON platform_private.wazzup_message_bindings
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER wazzup_message_bindings_no_truncate BEFORE TRUNCATE ON platform_private.wazzup_message_bindings
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();

DO $wz325_tables$
DECLARE t REGCLASS;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'platform_private.wazzup_channels'::REGCLASS, 'platform_private.wazzup_chat_bindings'::REGCLASS,
    'platform_private.wazzup_message_bindings'::REGCLASS, 'platform_private.wazzup_event_projections'::REGCLASS,
    'platform_private.wazzup_daily_counters'::REGCLASS, 'platform_private.whatsapp_transport_state'::REGCLASS,
    'platform_private.wazzup_api_key_bindings'::REGCLASS, 'platform_private.wazzup_operator_events'::REGCLASS] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent', t);
  END LOOP;
END
$wz325_tables$;

-- ---------------------------------------------------------------------------
-- 3. Беседы: канал Wazzup вместо сессии WAHA. Ровно одно из двух; канал беседы после создания не меняется.
-- ---------------------------------------------------------------------------
ALTER TABLE platform.communication_conversations ALTER COLUMN waha_session_name DROP NOT NULL;
ALTER TABLE platform.communication_conversations ADD COLUMN wazzup_channel_id UUID;
ALTER TABLE platform.communication_conversations ADD CONSTRAINT communication_conversations_transport_check
  CHECK ((waha_session_name IS NOT NULL) <> (wazzup_channel_id IS NOT NULL));
ALTER TABLE platform.communication_conversations ADD CONSTRAINT communication_conversations_wazzup_channel_fkey
  FOREIGN KEY (organization_id, wazzup_channel_id)
  REFERENCES platform_private.wazzup_channels(organization_id, channel_id) ON DELETE RESTRICT;
COMMENT ON COLUMN platform.communication_conversations.wazzup_channel_id IS
  '325: the Wazzup channel of a conversation that came through Wazzup (waha_session_name is then NULL); immutable.';
DROP TRIGGER communication_conversations_identity_immutable ON platform.communication_conversations;
CREATE TRIGGER communication_conversations_identity_immutable
  BEFORE UPDATE ON platform.communication_conversations
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.protect_domain_identity(
    'id',
    'organization_id',
    'responsible_sales_membership_id',
    'sales_authority_source',
    'subject',
    'waha_session_name',
    'kommo_account_id',
    'kommo_conversation_id',
    'amocrm_account_id',
    'amocrm_lead_id',
    'amocrm_contact_id',
    'created_from_webhook_event_id',
    'created_at',
    'wazzup_channel_id'
  );

-- ---------------------------------------------------------------------------
-- 4. Сообщения: два источника личности Wazzup (входящее клиента и ответ продавца без авторизации EVO).
-- ---------------------------------------------------------------------------
ALTER TABLE platform.communication_messages DROP CONSTRAINT communication_messages_direction_shape_check;
ALTER TABLE platform.communication_messages ADD CONSTRAINT communication_messages_direction_shape_check CHECK (
  (direction = 'inbound' AND manual_send_authorization_id IS NULL AND autonomous_reply_intent_id IS NULL)
  OR (direction = 'outbound' AND manual_send_authorization_id IS NOT NULL AND autonomous_reply_intent_id IS NULL)
  OR (direction = 'outbound' AND manual_send_authorization_id IS NULL AND autonomous_reply_intent_id IS NULL
    AND message_identity_source = 'private_waha_history_binding')
  OR (direction = 'outbound' AND manual_send_authorization_id IS NULL AND autonomous_reply_intent_id IS NOT NULL
    AND message_identity_source = 'private_autonomous_reply_binding')
  OR (direction = 'outbound' AND manual_send_authorization_id IS NULL AND autonomous_reply_intent_id IS NULL
    AND message_identity_source = 'private_waha_phone_binding')
  OR (direction = 'outbound' AND manual_send_authorization_id IS NULL AND autonomous_reply_intent_id IS NULL
    AND message_identity_source = 'private_wazzup_echo_binding')
);
ALTER TABLE platform.communication_messages DROP CONSTRAINT communication_messages_provider_identity_check;
ALTER TABLE platform.communication_messages ADD CONSTRAINT communication_messages_provider_identity_check CHECK (
  (message_identity_source = 'public_provider_id' AND autonomous_reply_intent_id IS NULL
    AND (waha_message_id IS NOT NULL OR kommo_message_id IS NOT NULL))
  OR (message_identity_source = 'private_waha_binding' AND autonomous_reply_intent_id IS NULL AND direction = 'inbound'
    AND waha_session_name IS NULL AND waha_message_id IS NULL AND kommo_account_id IS NULL AND kommo_conversation_id IS NULL
    AND kommo_message_id IS NULL AND amocrm_account_id IS NULL AND amocrm_lead_id IS NULL AND amocrm_contact_id IS NULL)
  OR (message_identity_source = 'private_waha_history_binding' AND autonomous_reply_intent_id IS NULL
    AND direction IN ('inbound', 'outbound')
    AND waha_session_name IS NULL AND waha_message_id IS NULL AND kommo_account_id IS NULL AND kommo_conversation_id IS NULL
    AND kommo_message_id IS NULL AND amocrm_account_id IS NULL AND amocrm_lead_id IS NULL AND amocrm_contact_id IS NULL)
  OR (message_identity_source = 'private_autonomous_reply_binding' AND autonomous_reply_intent_id IS NOT NULL
    AND direction = 'outbound'
    AND waha_session_name IS NULL AND waha_message_id IS NULL AND kommo_account_id IS NULL AND kommo_conversation_id IS NULL
    AND kommo_message_id IS NULL AND amocrm_account_id IS NULL AND amocrm_lead_id IS NULL AND amocrm_contact_id IS NULL)
  OR (message_identity_source = 'private_manual_send_binding' AND autonomous_reply_intent_id IS NULL
    AND direction = 'outbound' AND manual_send_authorization_id IS NOT NULL
    AND waha_session_name IS NULL AND waha_message_id IS NULL AND kommo_account_id IS NULL AND kommo_conversation_id IS NULL
    AND kommo_message_id IS NULL AND amocrm_account_id IS NULL AND amocrm_lead_id IS NULL AND amocrm_contact_id IS NULL)
  OR (message_identity_source = 'private_waha_phone_binding' AND autonomous_reply_intent_id IS NULL
    AND direction = 'outbound' AND manual_send_authorization_id IS NULL
    AND waha_session_name IS NULL AND waha_message_id IS NULL AND kommo_account_id IS NULL AND kommo_conversation_id IS NULL
    AND kommo_message_id IS NULL AND amocrm_account_id IS NULL AND amocrm_lead_id IS NULL AND amocrm_contact_id IS NULL)
  OR (message_identity_source = 'private_wazzup_binding' AND autonomous_reply_intent_id IS NULL AND direction = 'inbound'
    AND waha_session_name IS NULL AND waha_message_id IS NULL AND kommo_account_id IS NULL AND kommo_conversation_id IS NULL
    AND kommo_message_id IS NULL AND amocrm_account_id IS NULL AND amocrm_lead_id IS NULL AND amocrm_contact_id IS NULL)
  OR (message_identity_source = 'private_wazzup_echo_binding' AND autonomous_reply_intent_id IS NULL
    AND direction = 'outbound' AND manual_send_authorization_id IS NULL
    AND waha_session_name IS NULL AND waha_message_id IS NULL AND kommo_account_id IS NULL AND kommo_conversation_id IS NULL
    AND kommo_message_id IS NULL AND amocrm_account_id IS NULL AND amocrm_lead_id IS NULL AND amocrm_contact_id IS NULL)
);
COMMENT ON COLUMN platform.communication_messages.message_identity_source IS
  'Immutable provenance: public provider id, signed inbound private WAHA binding, explicit read-only private WAHA history binding, a message the sales team sent from the phone/app (private_waha_phone_binding), or a Wazzup message: private_wazzup_binding (inbound, from a verified Wazzup event) and private_wazzup_echo_binding (a seller reply seen as an echo, never sent by EVO).';

-- Строка сообщения Wazzup обязана иметь точную привязку, событие Wazzup того же канала с тем же messageId и чатом
-- беседы (по образцу require_private_waha_message_binding, 260). Отложенная проверка: привязка вставляется следом.
CREATE FUNCTION platform_private.require_private_wazzup_message_binding()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.message_identity_source IN ('private_wazzup_binding', 'private_wazzup_echo_binding')
    AND NOT EXISTS (
      SELECT 1
      FROM platform_private.wazzup_message_bindings AS binding
      JOIN platform_private.provider_webhook_events AS source_event
        ON source_event.organization_id = binding.organization_id AND source_event.id = binding.source_webhook_event_id
      JOIN platform.communication_conversations AS conversation
        ON conversation.organization_id = NEW.organization_id AND conversation.id = NEW.conversation_id
      JOIN platform_private.wazzup_chat_bindings AS chat
        ON chat.organization_id = conversation.organization_id AND chat.conversation_id = conversation.id
      WHERE binding.organization_id = NEW.organization_id
        AND binding.communication_message_id = NEW.id
        AND binding.source_webhook_event_id = NEW.source_webhook_event_id
        AND conversation.wazzup_channel_id = binding.channel_id
        AND chat.channel_id = binding.channel_id
        AND source_event.provider = 'wazzup'
        AND source_event.verification_status = 'verified'
        AND source_event.event_type = 'message'
        AND source_event.provider_account_ref = 'wazzup:' || binding.channel_id::TEXT
        AND source_event.payload_id = binding.wazzup_message_id
        AND source_event.raw_payload ->> 'chatId' = chat.chat_digits
        AND (
          (NEW.message_identity_source = 'private_wazzup_binding' AND NEW.direction = 'inbound' AND binding.kind = 'inbound'
            AND source_event.raw_payload -> 'isEcho' = 'false'::JSONB)
          OR (NEW.message_identity_source = 'private_wazzup_echo_binding' AND NEW.direction = 'outbound'
            AND binding.kind = 'staff_echo' AND source_event.raw_payload -> 'isEcho' = 'true'::JSONB)
        )
    )
  THEN
    RAISE EXCEPTION 'A private Wazzup message requires its exact canonical provider binding' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE CONSTRAINT TRIGGER communication_messages_private_wazzup_binding
  AFTER INSERT ON platform.communication_messages
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION platform_private.require_private_wazzup_message_binding();

-- ---------------------------------------------------------------------------
-- 5. Ворота. Один источник правды для всех путей отправки (B.9) и для путей Gemini (B.11).
-- ---------------------------------------------------------------------------

-- Можно ли отправлять WhatsApp в этой беседе. Нельзя, если действующий путь Wazzup (любая беседа, и прежние беседы WAHA
-- тоже) или беседа пришла через Wazzup (в этапе 1 такая беседа неотправляема ничем, даже когда путь потом вернули).
-- Беседа может быть NULL (портал, нет беседы): тогда решает только путь организации.
CREATE FUNCTION platform_private.whatsapp_send_allowed(p_organization_id UUID, p_conversation_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT NOT (
    COALESCE((SELECT s.active_transport = 'wazzup' FROM platform_private.whatsapp_transport_state s
      WHERE s.organization_id = p_organization_id), FALSE)
    OR EXISTS (SELECT 1 FROM platform.communication_conversations c
      WHERE c.organization_id = p_organization_id AND c.id = p_conversation_id AND c.wazzup_channel_id IS NOT NULL))
$$;

-- Можно ли отдавать тексты этой беседы Gemini (Google). Беседа Wazzup - только когда владелец сказал «да»
-- (`gemini_enabled`, команда оператора без выпуска). Остальные беседы - как всегда.
CREATE FUNCTION platform_private.whatsapp_gemini_allowed(p_organization_id UUID, p_conversation_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT NOT (
    EXISTS (SELECT 1 FROM platform.communication_conversations c
      WHERE c.organization_id = p_organization_id AND c.id = p_conversation_id AND c.wazzup_channel_id IS NOT NULL)
    AND NOT COALESCE((SELECT s.gemini_enabled FROM platform_private.whatsapp_transport_state s
      WHERE s.organization_id = p_organization_id), FALSE))
$$;

-- Беседа Wazzup, чей клиент не определён (несколько клиентов на одном номере): агентам закрыта целиком.
CREATE FUNCTION platform_private.wazzup_conversation_unresolved(p_organization_id UUID, p_conversation_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM platform_private.wazzup_chat_bindings b
    WHERE b.organization_id = p_organization_id AND b.conversation_id = p_conversation_id
      AND b.identity_state = 'ambiguous')
$$;

-- Сообщение, которое клиент удалил у себя (текст для ИИ скрыт).
CREATE FUNCTION platform_private.wazzup_message_deleted(p_organization_id UUID, p_message_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM platform_private.wazzup_message_bindings b
    WHERE b.organization_id = p_organization_id AND b.communication_message_id = p_message_id
      AND b.sender_deleted_at IS NOT NULL)
$$;

-- Счётчик суток по Бишкеку (только количество).
CREATE FUNCTION platform_private.wazzup_count(p_organization_id UUID, p_counter TEXT, p_n BIGINT DEFAULT 1)
RETURNS VOID LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO platform_private.wazzup_daily_counters AS c (organization_id, day, counter, n)
  VALUES (p_organization_id, (clock_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE, p_counter, p_n)
  ON CONFLICT (organization_id, day, counter) DO UPDATE SET n = c.n + EXCLUDED.n
$$;

-- ---------------------------------------------------------------------------
-- 6. Команды оператора (service_role): привязка канала, путь, ключ, наблюдение за состоянием канала.
-- ---------------------------------------------------------------------------

-- Повтор команды по request_id: тот же вход - прежний итог; другой вход - 22023.
CREATE FUNCTION platform_private.wazzup_operator_replay(p_organization_id UUID, p_request_id UUID, p_action TEXT, p_input_sha TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v platform_private.wazzup_operator_events;
BEGIN
  SELECT * INTO v FROM platform_private.wazzup_operator_events e WHERE e.request_id = p_request_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF v.organization_id <> p_organization_id OR v.action <> p_action OR v.input_sha256 <> p_input_sha THEN
    RAISE EXCEPTION 'request_id % was already used with different input', p_request_id USING ERRCODE = '22023';
  END IF;
  RETURN v.after_state || jsonb_build_object('replayed', TRUE);
END
$$;

CREATE FUNCTION platform.wazzup_channel_bind_v1(p_organization_id UUID, p_channel_id UUID, p_transport TEXT,
  p_phone_last4 TEXT, p_phone_sha256 TEXT, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_input TEXT; v_replay JSONB; v_row platform_private.wazzup_channels; v_result JSONB; v_before JSONB;
BEGIN
  PERFORM platform_private.require_p2g_service();
  IF p_organization_id IS NULL OR p_channel_id IS NULL OR p_request_id IS NULL
    OR p_transport IS NULL OR p_transport NOT IN ('whatsapp', 'wapi')
    OR p_phone_last4 IS NULL OR p_phone_last4 !~ '^[0-9]{4}$'
    OR p_phone_sha256 IS NULL OR p_phone_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'wazzup_channel_invalid_request' USING ERRCODE = '22023';
  END IF;
  v_input := encode(sha256(convert_to(jsonb_build_object('org', p_organization_id, 'channel', p_channel_id,
    'transport', p_transport, 'last4', p_phone_last4, 'phone', p_phone_sha256)::TEXT, 'UTF8')), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended('evo:wazzup:operator:' || p_organization_id::TEXT, 0));
  v_replay := platform_private.wazzup_operator_replay(p_organization_id, p_request_id, 'channel.bind', v_input);
  IF v_replay IS NOT NULL THEN
    RETURN v_replay;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform.organizations o WHERE o.id = p_organization_id AND o.status = 'active') THEN
    RAISE EXCEPTION 'wazzup_channel_unknown_organization' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_row FROM platform_private.wazzup_channels c WHERE c.organization_id = p_organization_id FOR UPDATE;
  IF FOUND THEN
    IF v_row.channel_id <> p_channel_id THEN
      RAISE EXCEPTION 'wazzup_channel_already_bound' USING ERRCODE = '55000';
    END IF;
    v_before := jsonb_build_object('channelId', v_row.channel_id, 'transport', v_row.transport, 'last4', v_row.phone_last4);
    UPDATE platform_private.wazzup_channels c SET transport = p_transport, phone_last4 = p_phone_last4,
      phone_sha256 = p_phone_sha256, request_id = p_request_id
    WHERE c.organization_id = p_organization_id;
  ELSE
    INSERT INTO platform_private.wazzup_channels (organization_id, channel_id, transport, phone_last4, phone_sha256, request_id)
    VALUES (p_organization_id, p_channel_id, p_transport, p_phone_last4, p_phone_sha256, p_request_id);
  END IF;
  v_result := jsonb_build_object('channelId', p_channel_id, 'transport', p_transport, 'last4', p_phone_last4);
  INSERT INTO platform_private.wazzup_operator_events (organization_id, request_id, action, input_sha256, before_state, after_state)
  VALUES (p_organization_id, p_request_id, 'channel.bind', v_input, v_before, v_result);
  RETURN v_result || jsonb_build_object('replayed', FALSE);
END
$$;

-- Состояние канала: слово Wazzup и время наблюдения. Не трогает серию 321 (её пишет только таймер).
CREATE FUNCTION platform.wazzup_channel_observe_v1(p_organization_id UUID, p_channel_id UUID, p_state TEXT,
  p_observed_at TIMESTAMPTZ DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_at TIMESTAMPTZ; v_n INTEGER;
BEGIN
  PERFORM platform_private.require_p2g_service();
  IF p_organization_id IS NULL OR p_channel_id IS NULL OR p_state IS NULL OR p_state !~ '^[A-Za-z][A-Za-z0-9_]{0,63}$' THEN
    RAISE EXCEPTION 'wazzup_channel_invalid_request' USING ERRCODE = '22023';
  END IF;
  v_at := LEAST(COALESCE(p_observed_at, clock_timestamp()), clock_timestamp());
  UPDATE platform_private.wazzup_channels c SET state = p_state, observed_at = v_at
  WHERE c.organization_id = p_organization_id AND c.channel_id = p_channel_id
    AND (c.observed_at IS NULL OR c.observed_at <= v_at);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('updated', v_n = 1);
END
$$;

-- Путь WhatsApp и выключатели (команда оператора `transport`). Переключение на Wazzup закрывает открытые тревоги
-- `crm_primary` (их больше никто не проверяет); уход с Wazzup закрывает открытые тревоги Wazzup.
CREATE FUNCTION platform.whatsapp_transport_configure_v1(p_organization_id UUID, p_transport TEXT, p_ai_trigger BOOLEAN,
  p_gemini BOOLEAN, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_input TEXT; v_replay JSONB; v_before platform_private.whatsapp_transport_state; v_after platform_private.whatsapp_transport_state;
  v_had BOOLEAN; v_closed INTEGER := 0; v_kind TEXT; v_res JSONB; v_result JSONB; v_before_state JSONB;
BEGIN
  PERFORM platform_private.require_p2g_service();
  IF p_organization_id IS NULL OR p_request_id IS NULL OR p_transport IS NULL OR p_transport NOT IN ('none', 'waha', 'wazzup') THEN
    RAISE EXCEPTION 'whatsapp_transport_invalid_request' USING ERRCODE = '22023';
  END IF;
  v_input := encode(sha256(convert_to(jsonb_build_object('org', p_organization_id, 'transport', p_transport,
    'ai', p_ai_trigger, 'gemini', p_gemini)::TEXT, 'UTF8')), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended('evo:wazzup:operator:' || p_organization_id::TEXT, 0));
  v_replay := platform_private.wazzup_operator_replay(p_organization_id, p_request_id, 'transport.configure', v_input);
  IF v_replay IS NOT NULL THEN
    RETURN v_replay;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform.organizations o WHERE o.id = p_organization_id AND o.status = 'active') THEN
    RAISE EXCEPTION 'whatsapp_transport_unknown_organization' USING ERRCODE = '22023';
  END IF;
  IF p_transport = 'wazzup' AND NOT EXISTS (SELECT 1 FROM platform_private.wazzup_channels c
    WHERE c.organization_id = p_organization_id) THEN
    RAISE EXCEPTION 'wazzup_channel_missing' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO v_before FROM platform_private.whatsapp_transport_state s WHERE s.organization_id = p_organization_id FOR UPDATE;
  v_had := FOUND;
  v_before_state := CASE WHEN v_had THEN jsonb_build_object('transport', v_before.active_transport,
    'aiTriggerEnabled', v_before.ai_trigger_enabled, 'geminiEnabled', v_before.gemini_enabled, 'version', v_before.version) END;
  INSERT INTO platform_private.whatsapp_transport_state AS s (organization_id, active_transport, ai_trigger_enabled, gemini_enabled)
  VALUES (p_organization_id, p_transport, COALESCE(p_ai_trigger, FALSE), COALESCE(p_gemini, FALSE))
  ON CONFLICT (organization_id) DO UPDATE SET active_transport = EXCLUDED.active_transport,
    ai_trigger_enabled = COALESCE(p_ai_trigger, s.ai_trigger_enabled),
    gemini_enabled = COALESCE(p_gemini, s.gemini_enabled),
    send_enabled = FALSE, version = s.version + 1, updated_at = clock_timestamp()
  RETURNING * INTO v_after;
  IF p_transport = 'wazzup' AND COALESCE(v_before.active_transport, 'none') <> 'wazzup' THEN
    FOREACH v_kind IN ARRAY ARRAY['disconnected', 'silent'] LOOP
      v_res := platform.whatsapp_health_resolve_v1(p_organization_id, 'crm_primary', v_kind, 'transport_switched');
      v_closed := v_closed + CASE WHEN (v_res ->> 'resolved')::BOOLEAN THEN 1 ELSE 0 END;
    END LOOP;
  ELSIF p_transport <> 'wazzup' AND COALESCE(v_before.active_transport, 'none') = 'wazzup' THEN
    FOREACH v_kind IN ARRAY ARRAY['disconnected', 'silent', 'gap'] LOOP
      v_res := platform.whatsapp_health_resolve_v1(p_organization_id, 'wazzup', v_kind, 'transport_switched');
      v_closed := v_closed + CASE WHEN (v_res ->> 'resolved')::BOOLEAN THEN 1 ELSE 0 END;
    END LOOP;
  END IF;
  v_result := jsonb_build_object('transport', v_after.active_transport, 'aiTriggerEnabled', v_after.ai_trigger_enabled,
    'geminiEnabled', v_after.gemini_enabled, 'sendEnabled', v_after.send_enabled, 'version', v_after.version,
    'closedAlerts', v_closed);
  INSERT INTO platform_private.wazzup_operator_events (organization_id, request_id, action, input_sha256, before_state, after_state)
  VALUES (p_organization_id, p_request_id, 'transport.configure', v_input, v_before_state, v_result);
  RETURN v_result || jsonb_build_object('replayed', FALSE);
END
$$;

-- Ключ API Wazzup: значение только в Vault (по образцу provision_manual_send_waha_runtime, 081); в таблице отпечаток.
CREATE FUNCTION platform_private.wazzup_api_key_valid(p_key TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_key IS NOT NULL AND p_key = btrim(p_key, E' \t\n\r\f\v') AND octet_length(p_key) BETWEEN 16 AND 4096
    AND p_key !~ '[[:cntrl:]]'
$$;

CREATE FUNCTION platform.wazzup_api_key_provision_v1(p_organization_id UUID, p_api_key TEXT, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_sha TEXT; v_replay JSONB; v_bind platform_private.wazzup_api_key_bindings; v_current TEXT; v_secret UUID; v_result JSONB;
  v_name TEXT; v_before JSONB; v_changed BOOLEAN := TRUE;
BEGIN
  PERFORM platform_private.require_p2g_service();
  IF p_organization_id IS NULL OR p_request_id IS NULL OR NOT platform_private.wazzup_api_key_valid(p_api_key) THEN
    RAISE EXCEPTION 'wazzup_api_key_invalid_request' USING ERRCODE = '22023';
  END IF;
  v_sha := encode(sha256(convert_to(p_api_key, 'UTF8')), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended('evo:wazzup:operator:' || p_organization_id::TEXT, 0));
  v_replay := platform_private.wazzup_operator_replay(p_organization_id, p_request_id, 'key.provision', v_sha);
  IF v_replay IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM platform_private.wazzup_api_key_bindings b
      WHERE b.organization_id = p_organization_id AND b.api_key_sha256 = v_sha) THEN
      RAISE EXCEPTION 'request_id % refers to an obsolete Wazzup key binding', p_request_id USING ERRCODE = '55000';
    END IF;
    RETURN v_replay;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform.organizations o WHERE o.id = p_organization_id AND o.status = 'active') THEN
    RAISE EXCEPTION 'wazzup_api_key_unknown_organization' USING ERRCODE = '22023';
  END IF;
  v_name := 'evo-wazzup-api-key-' || p_organization_id::TEXT;
  SELECT * INTO v_bind FROM platform_private.wazzup_api_key_bindings b WHERE b.organization_id = p_organization_id FOR UPDATE;
  IF FOUND THEN
    v_before := jsonb_build_object('apiKeySha256', v_bind.api_key_sha256, 'bindingVersion', v_bind.binding_version);
    SELECT s.decrypted_secret INTO v_current FROM vault.decrypted_secrets s WHERE s.id = v_bind.api_key_secret_id;
    IF v_bind.api_key_sha256 = v_sha AND v_current IS NOT DISTINCT FROM p_api_key THEN
      v_changed := FALSE;
    ELSE
      PERFORM vault.update_secret(v_bind.api_key_secret_id, p_api_key, v_name, 'EVO Platform Wazzup API key');
      UPDATE platform_private.wazzup_api_key_bindings b SET api_key_sha256 = v_sha, binding_version = b.binding_version + 1,
        updated_at = clock_timestamp() WHERE b.organization_id = p_organization_id RETURNING * INTO v_bind;
    END IF;
  ELSE
    v_secret := vault.create_secret(p_api_key, v_name, 'EVO Platform Wazzup API key');
    INSERT INTO platform_private.wazzup_api_key_bindings (organization_id, api_key_secret_id, api_key_sha256)
    VALUES (p_organization_id, v_secret, v_sha) RETURNING * INTO v_bind;
  END IF;
  v_result := jsonb_build_object('ready', TRUE, 'apiKeySha256', v_bind.api_key_sha256, 'bindingVersion', v_bind.binding_version,
    'changed', v_changed);
  INSERT INTO platform_private.wazzup_operator_events (organization_id, request_id, action, input_sha256, before_state, after_state)
  VALUES (p_organization_id, p_request_id, 'key.provision', v_sha, v_before, v_result);
  RETURN v_result || jsonb_build_object('replayed', FALSE);
END
$$;

-- Ключ для задачи таймера и команд оператора (как resolve_manual_send_waha_runtime, 080): только service_role. Если
-- привязка негодна - ключа нет, причина названа словом.
CREATE FUNCTION platform.wazzup_api_key_resolve_v1(p_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_bind platform_private.wazzup_api_key_bindings; v_secret TEXT; v_found BOOLEAN; v_reason TEXT;
BEGIN
  PERFORM platform_private.require_p2g_service();
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'wazzup_api_key_invalid_request' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_bind FROM platform_private.wazzup_api_key_bindings b WHERE b.organization_id = p_organization_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ready', FALSE, 'reasonCode', 'missing_binding');
  END IF;
  SELECT s.decrypted_secret, TRUE INTO v_secret, v_found FROM vault.decrypted_secrets s WHERE s.id = v_bind.api_key_secret_id;
  v_reason := CASE
    WHEN NOT COALESCE(v_found, FALSE) OR v_secret IS NULL THEN 'secret_missing'
    WHEN NOT platform_private.wazzup_api_key_valid(v_secret) THEN 'secret_invalid'
    WHEN encode(sha256(convert_to(v_secret, 'UTF8')), 'hex') <> v_bind.api_key_sha256 THEN 'secret_hash_mismatch'
    ELSE 'ready' END;
  IF v_reason <> 'ready' THEN
    RETURN jsonb_build_object('ready', FALSE, 'reasonCode', v_reason);
  END IF;
  RETURN jsonb_build_object('ready', TRUE, 'reasonCode', 'ready', 'apiKey', v_secret, 'apiKeySha256', v_bind.api_key_sha256,
    'bindingVersion', v_bind.binding_version);
END
$$;

-- ---------------------------------------------------------------------------
-- 7. Запись сырых событий (service_role): порция до 100 элементов, каждый элемент в своей подтранзакции.
-- ---------------------------------------------------------------------------

-- Один элемент вебхука -> одно сырое событие (или счётчик отфильтрованного). Идемпотентно по ключам §5.1.
-- kind: 'message' (элемент массива messages) или 'channel' (элемент channelsUpdates).
CREATE FUNCTION platform_private.wazzup_persist_element(p_organization_id UUID, p_bound_channel UUID, p_batch_sha256 TEXT,
  p_token_slot TEXT, p_kind TEXT, p_element JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c_uuid CONSTANT TEXT := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_msg_id TEXT; v_ch TEXT; v_chat_type TEXT; v_chat_id TEXT; v_state TEXT; v_valid BOOLEAN := FALSE; v_echo BOOLEAN := FALSE;
  v_raw JSONB := p_element; v_sha TEXT; v_event_type TEXT; v_variant TEXT; v_payload_id TEXT; v_ref TEXT; v_account TEXT;
  v_ts TIMESTAMPTZ; v_event UUID; v_counter TEXT;
BEGIN
  IF p_kind NOT IN ('message', 'channel') THEN
    RAISE EXCEPTION 'wazzup_persist_invalid_kind' USING ERRCODE = '22023';
  END IF;
  -- Код привязки устройства в состоянии канала не сохраняется ни в каком виде.
  IF p_kind = 'channel' AND jsonb_typeof(p_element) = 'object' THEN
    SELECT COALESCE(jsonb_object_agg(e.key, e.value), '{}'::JSONB) INTO v_raw
    FROM jsonb_each(p_element) AS e WHERE lower(e.key) NOT LIKE 'qr%';
  END IF;
  v_sha := encode(sha256(convert_to(v_raw::TEXT, 'UTF8')), 'hex');
  IF jsonb_typeof(v_raw) = 'object' THEN
    v_ch := CASE WHEN jsonb_typeof(v_raw -> 'channelId') = 'string' THEN lower(v_raw ->> 'channelId') END;
    IF p_kind = 'message' THEN
      v_msg_id := CASE WHEN jsonb_typeof(v_raw -> 'messageId') = 'string' THEN v_raw ->> 'messageId' END;
      v_chat_type := CASE WHEN jsonb_typeof(v_raw -> 'chatType') = 'string' THEN v_raw ->> 'chatType' END;
      v_chat_id := CASE WHEN jsonb_typeof(v_raw -> 'chatId') = 'string' THEN v_raw ->> 'chatId' END;
      v_valid := v_msg_id ~ '^[A-Za-z0-9._:-]{1,128}$' AND v_ch ~ c_uuid AND v_chat_type ~ '^[a-z]{1,32}$'
        AND v_chat_id IS NOT NULL AND char_length(v_chat_id) BETWEEN 1 AND 128 AND jsonb_typeof(v_raw -> 'isEcho') = 'boolean';
      v_echo := COALESCE(v_valid AND v_raw -> 'isEcho' = 'true'::JSONB, FALSE);
    ELSE
      v_state := CASE WHEN jsonb_typeof(v_raw -> 'state') = 'string' THEN v_raw ->> 'state' END;
      v_valid := v_ch ~ c_uuid AND v_state ~ '^[A-Za-z][A-Za-z0-9_]{0,63}$';
    END IF;
  END IF;

  IF v_valid THEN
    -- Чужой канал и всё, что не личный WhatsApp (группы, Telegram и т. д.), в этапе 1 не принимается: только счётчик.
    IF v_ch <> p_bound_channel::TEXT THEN
      v_counter := CASE WHEN p_kind = 'channel' THEN 'filtered_channel_update' WHEN v_echo THEN 'filtered_outbound'
        ELSE 'filtered_inbound_channel' END;
    ELSIF p_kind = 'message' AND v_chat_type <> 'whatsapp' THEN
      v_counter := CASE WHEN v_echo THEN 'filtered_outbound' ELSE 'filtered_inbound_chat_type' END;
    END IF;
    IF v_counter IS NOT NULL THEN
      PERFORM platform_private.wazzup_count(p_organization_id, v_counter);
      RETURN jsonb_build_object('outcome', 'filtered', 'code', v_counter);
    END IF;
    v_account := 'wazzup:' || v_ch;
    IF p_kind = 'channel' THEN
      v_event_type := 'channel.state'; v_payload_id := v_ch; v_variant := v_sha; v_ref := 'channel:' || v_ch || ':' || v_sha;
    ELSE
      v_payload_id := v_msg_id;
      IF v_raw -> 'isDeleted' = 'true'::JSONB THEN
        v_event_type := 'message.deleted'; v_variant := v_sha; v_ref := 'message.deleted:' || v_msg_id || ':' || v_sha;
      ELSIF v_raw -> 'isEdited' = 'true'::JSONB THEN
        v_event_type := 'message.edited'; v_variant := v_sha; v_ref := 'message.edited:' || v_msg_id || ':' || v_sha;
      ELSE
        v_event_type := 'message'; v_variant := NULL; v_ref := 'message:' || v_msg_id;
      END IF;
    END IF;
  ELSE
    -- Форма не прошла: сохраняем как `unparsed` под привязанным каналом; разберёт сотрудник.
    v_account := 'wazzup:' || p_bound_channel::TEXT;
    v_event_type := 'unparsed'; v_payload_id := 'sha256:' || v_sha; v_variant := NULL; v_ref := 'unparsed:' || v_sha;
  END IF;

  IF v_valid AND jsonb_typeof(v_raw -> 'dateTime') = 'string' THEN
    BEGIN
      v_ts := (v_raw ->> 'dateTime')::TIMESTAMPTZ;
    EXCEPTION WHEN OTHERS THEN
      v_ts := NULL;
    END;
  END IF;
  IF v_ts IS NULL OR v_ts > clock_timestamp() + INTERVAL '5 minutes' OR v_ts < clock_timestamp() - INTERVAL '3650 days' THEN
    v_ts := clock_timestamp();
  END IF;

  INSERT INTO platform_private.provider_webhook_events (organization_id, provider, provider_account_ref, provider_conversation_ref,
    provider_event_variant_ref, provider_request_id, waha_session_name, payload_id, event_type, provider_occurred_at,
    verification_status, raw_payload, verification_headers, verification_evidence_ref, payload_sha256, request_id)
  VALUES (p_organization_id, 'wazzup', v_account, NULL, v_variant, v_ref, NULL, v_payload_id, v_event_type, v_ts,
    'verified', v_raw, jsonb_build_object('url_token', p_token_slot, 'signature', 'absent'),
    'wazzup-batch-sha256:' || p_batch_sha256, v_sha, gen_random_uuid())
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_event;
  IF v_event IS NULL THEN
    SELECT e.id INTO v_event FROM platform_private.provider_webhook_events e
    WHERE e.organization_id = p_organization_id AND e.provider = 'wazzup' AND e.provider_account_ref = v_account
      AND e.provider_request_id = v_ref;
    RETURN jsonb_build_object('outcome', 'deduplicated', 'eventId', v_event, 'eventType', v_event_type);
  END IF;
  INSERT INTO platform_private.wazzup_event_projections (organization_id, event_id) VALUES (p_organization_id, v_event)
  ON CONFLICT DO NOTHING;
  IF v_event_type = 'unparsed' THEN
    PERFORM platform_private.wazzup_count(p_organization_id, 'unparsed');
  END IF;
  RETURN jsonb_build_object('outcome', CASE WHEN v_event_type = 'unparsed' THEN 'unparsed' ELSE 'stored' END,
    'eventId', v_event, 'eventType', v_event_type);
END
$$;

-- Порция до 100 элементов. `p_elements`: [{"kind": "message"|"channel", "element": {...}}]. Ошибка одного элемента не
-- роняет остальные. Действующий путь не Wazzup (или канала нет) - ничего не пишется, ответ `transportActive: false`.
-- `p_counters`: счётчики, которые разобрал маршрут (статусы, лишние подписки): status, ignored_subscription.
CREATE FUNCTION platform.wazzup_webhook_persist_v1(p_organization_id UUID, p_batch_sha256 TEXT, p_token_slot TEXT,
  p_elements JSONB, p_counters JSONB DEFAULT '{}'::JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_state platform_private.whatsapp_transport_state; v_channel platform_private.wazzup_channels; v_n INTEGER; v_i INTEGER;
  v_item JSONB; v_one JSONB; v_results JSONB := '[]'::JSONB; v_sqlstate TEXT; v_key TEXT; v_value JSONB;
  v_stored INTEGER := 0; v_dedup INTEGER := 0; v_unparsed INTEGER := 0; v_filtered INTEGER := 0; v_failed INTEGER := 0;
BEGIN
  PERFORM platform_private.require_p2g_service();
  IF p_organization_id IS NULL OR p_batch_sha256 IS NULL OR p_batch_sha256 !~ '^[0-9a-f]{64}$'
    OR p_token_slot IS NULL OR p_token_slot NOT IN ('current', 'next')
    OR p_elements IS NULL OR jsonb_typeof(p_elements) <> 'array' OR jsonb_array_length(p_elements) > 100
    OR p_counters IS NULL OR jsonb_typeof(p_counters) <> 'object' THEN
    RAISE EXCEPTION 'wazzup_persist_invalid_request' USING ERRCODE = '22023';
  END IF;
  v_n := jsonb_array_length(p_elements);
  FOR v_i IN 0 .. v_n - 1 LOOP
    v_item := p_elements -> v_i;
    IF jsonb_typeof(v_item) <> 'object' OR (v_item ->> 'kind') IS NULL OR (v_item ->> 'kind') NOT IN ('message', 'channel') THEN
      RAISE EXCEPTION 'wazzup_persist_invalid_request' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  FOR v_key, v_value IN SELECT e.key, e.value FROM jsonb_each(p_counters) AS e LOOP
    IF v_key NOT IN ('status', 'ignored_subscription') OR jsonb_typeof(v_value) <> 'number'
      OR (v_value #>> '{}') !~ '^[0-9]{1,7}$' THEN
      RAISE EXCEPTION 'wazzup_persist_invalid_request' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  SELECT * INTO v_state FROM platform_private.whatsapp_transport_state s WHERE s.organization_id = p_organization_id;
  SELECT * INTO v_channel FROM platform_private.wazzup_channels c WHERE c.organization_id = p_organization_id;
  IF v_state.organization_id IS NULL OR v_state.active_transport <> 'wazzup' OR v_channel.organization_id IS NULL THEN
    RETURN jsonb_build_object('transportActive', FALSE, 'results', '[]'::JSONB);
  END IF;
  FOR v_i IN 0 .. v_n - 1 LOOP
    v_item := p_elements -> v_i;
    BEGIN
      v_one := platform_private.wazzup_persist_element(p_organization_id, v_channel.channel_id, p_batch_sha256, p_token_slot,
        v_item ->> 'kind', COALESCE(v_item -> 'element', 'null'::JSONB));
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
      v_one := jsonb_build_object('outcome', 'element_failed', 'code', v_sqlstate,
        'sha256', encode(sha256(convert_to(COALESCE(v_item -> 'element', 'null'::JSONB)::TEXT, 'UTF8')), 'hex'));
    END;
    CASE v_one ->> 'outcome'
      WHEN 'stored' THEN v_stored := v_stored + 1;
      WHEN 'deduplicated' THEN v_dedup := v_dedup + 1;
      WHEN 'unparsed' THEN v_unparsed := v_unparsed + 1;
      WHEN 'filtered' THEN v_filtered := v_filtered + 1;
      ELSE v_failed := v_failed + 1;
    END CASE;
    v_results := v_results || jsonb_build_array(v_one || jsonb_build_object('index', v_i));
  END LOOP;
  IF v_failed > 0 THEN
    PERFORM platform_private.wazzup_count(p_organization_id, 'element_failed', v_failed);
  END IF;
  FOR v_key, v_value IN SELECT e.key, e.value FROM jsonb_each(p_counters) AS e LOOP
    IF (v_value #>> '{}')::BIGINT > 0 THEN
      PERFORM platform_private.wazzup_count(p_organization_id, v_key, (v_value #>> '{}')::BIGINT);
    END IF;
  END LOOP;
  RETURN jsonb_build_object('transportActive', TRUE, 'channelId', v_channel.channel_id, 'results', v_results,
    'counts', jsonb_build_object('stored', v_stored, 'deduplicated', v_dedup, 'unparsed', v_unparsed,
      'filtered', v_filtered, 'failed', v_failed));
END
$$;

-- Суточная сверка (service_role): входящие личные WhatsApp за сутки по Бишкеку, сохранённые в EVO, и счётчики того, что
-- не сохранено. Только количества.
CREATE FUNCTION platform.wazzup_daily_counts_v1(p_organization_id UUID, p_day DATE)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_from TIMESTAMPTZ; v_to TIMESTAMPTZ; v_stored BIGINT; v_counters JSONB;
BEGIN
  PERFORM platform_private.require_p2g_service();
  IF p_organization_id IS NULL OR p_day IS NULL THEN
    RAISE EXCEPTION 'wazzup_counts_invalid_request' USING ERRCODE = '22023';
  END IF;
  v_from := p_day::TIMESTAMP AT TIME ZONE 'Asia/Bishkek';
  v_to := (p_day + 1)::TIMESTAMP AT TIME ZONE 'Asia/Bishkek';
  SELECT count(*) INTO v_stored FROM platform_private.provider_webhook_events e
  WHERE e.organization_id = p_organization_id AND e.provider = 'wazzup' AND e.event_type = 'message'
    AND e.verification_status = 'verified' AND e.raw_payload ->> 'isEcho' = 'false'
    AND e.provider_occurred_at >= v_from AND e.provider_occurred_at < v_to;
  SELECT COALESCE(jsonb_object_agg(c.counter, c.n), '{}'::JSONB) INTO v_counters
  FROM platform_private.wazzup_daily_counters c WHERE c.organization_id = p_organization_id AND c.day = p_day;
  RETURN jsonb_build_object('day', p_day, 'inboundStored', v_stored, 'counters', v_counters,
    'inboundTotal', v_stored + COALESCE((v_counters ->> 'filtered_inbound_channel')::BIGINT, 0)
      + COALESCE((v_counters ->> 'filtered_inbound_chat_type')::BIGINT, 0));
END
$$;

-- ---------------------------------------------------------------------------
-- 8. Личность: студент (правило 316), совпадение по номеру (образец - телефония), новый номер.
-- ---------------------------------------------------------------------------

-- Номер уже записан у студента: ровно один клиент с делом прямого добавления в работе (правило 316, тот же запрос,
-- что в acquire_waha_canonical_identity). Функцию WAHA не трогаем: у неё свой тест.
CREATE FUNCTION platform_private.whatsapp_intake_direct_case_match(p_organization_id UUID, p_digits TEXT)
RETURNS TABLE (persons INTEGER, client_id UUID, lead_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT count(DISTINCT case_lead.client_id)::INTEGER,
    (array_agg(case_lead.client_id ORDER BY direct_case.created_at DESC, direct_case.id))[1],
    (array_agg(direct_case.canonical_lead_id ORDER BY direct_case.created_at DESC, direct_case.id))[1]
  FROM platform.student_cases AS direct_case
  JOIN platform.leads AS case_lead
    ON case_lead.organization_id = direct_case.organization_id AND case_lead.id = direct_case.canonical_lead_id
  JOIN platform.clients AS case_person
    ON case_person.organization_id = case_lead.organization_id AND case_person.id = case_lead.client_id
  WHERE direct_case.organization_id = p_organization_id
    AND direct_case.state IN ('pending', 'active')
    AND direct_case.source_key LIKE 'admissions-direct:%'
    AND case_person.lifecycle_state = 'active'
    AND case_person.normalized_phone = ANY (platform_private.person_phone_match_keys('+' || p_digits))
$$;

-- Совпадение по номеру без создания (образец - telephony_match_phone, 289): нет клиента - unmatched, один - matched
-- (лид - его единственный открытый лид, иначе без лида), несколько - ambiguous.
CREATE FUNCTION platform_private.whatsapp_intake_phone_match(p_organization_id UUID, p_digits TEXT)
RETURNS TABLE (m_state TEXT, m_client_id UUID, m_lead_id UUID)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_keys TEXT[]; v_count INTEGER; v_client UUID; v_open INTEGER; v_lead UUID;
BEGIN
  v_keys := platform_private.person_phone_match_keys('+' || p_digits);
  IF cardinality(v_keys) = 0 THEN
    RETURN QUERY SELECT 'unmatched'::TEXT, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;
  SELECT count(*)::INTEGER, (array_agg(c.id ORDER BY c.id))[1] INTO v_count, v_client
  FROM platform.clients c
  WHERE c.organization_id = p_organization_id AND c.lifecycle_state = 'active' AND c.normalized_phone = ANY (v_keys);
  IF v_count = 0 THEN
    RETURN QUERY SELECT 'unmatched'::TEXT, NULL::UUID, NULL::UUID;
  ELSIF v_count > 1 THEN
    RETURN QUERY SELECT 'ambiguous'::TEXT, NULL::UUID, NULL::UUID;
  ELSE
    SELECT count(*)::INTEGER, (array_agg(l.id ORDER BY l.id))[1] INTO v_open, v_lead
    FROM platform.leads l WHERE l.organization_id = p_organization_id AND l.client_id = v_client AND l.lifecycle_state = 'open';
    RETURN QUERY SELECT 'matched'::TEXT, v_client, CASE WHEN v_open = 1 THEN v_lead END;
  END IF;
END
$$;

-- Имя нового клиента из профиля Wazzup: тем же правилом, что в 278 - не пустая пунктуация и не цифры самого номера.
CREATE FUNCTION platform_private.wazzup_contact_name(p_element JSONB, p_digits TEXT)
RETURNS TEXT LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE n TEXT;
BEGIN
  IF jsonb_typeof(p_element #> '{contact,name}') IS DISTINCT FROM 'string' THEN
    RETURN NULL;
  END IF;
  n := btrim(regexp_replace(p_element #>> '{contact,name}',
    E'[\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]|[[:cntrl:]]', '', 'g'));
  n := btrim(left(n, 120));
  IF n = '' OR n ~ '^[[:punct:][:space:]]*$' OR regexp_replace(n, '[^0-9]', '', 'g') = p_digits
    OR COALESCE(platform_private.normalize_person_name(n), '') = '' THEN
    RETURN NULL;
  END IF;
  RETURN n;
END
$$;

-- Личность первого входящего чата без привязки (§5.3): студент -> совпадение по номеру -> новый клиент (лид не
-- создаётся). Одна транзакция вызывающего; замок по номеру держит вызывающий.
CREATE FUNCTION platform_private.acquire_wazzup_canonical_identity(p_organization_id UUID, p_channel_id UUID, p_digits TEXT,
  p_event_id UUID, p_observed_at TIMESTAMPTZ, p_contact_name TEXT)
RETURNS TABLE (r_state TEXT, r_client_id UUID, r_lead_id UUID)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE d RECORD; m RECORD; v_ref TEXT := 'wazzup-event:' || p_event_id::TEXT; v_client UUID;
BEGIN
  SELECT * INTO d FROM platform_private.whatsapp_intake_direct_case_match(p_organization_id, p_digits);
  IF d.persons = 1 THEN
    INSERT INTO platform.subject_provenance (organization_id, client_id, source_system, evidence_type, observed_at, imported_at, source_ref)
    VALUES (p_organization_id, d.client_id, 'wazzup', 'webhook_verified', p_observed_at, NULL, v_ref);
    INSERT INTO platform.subject_provenance (organization_id, lead_id, source_system, evidence_type, observed_at, imported_at, source_ref)
    VALUES (p_organization_id, d.lead_id, 'wazzup', 'webhook_verified', p_observed_at, NULL, v_ref);
    RETURN QUERY SELECT 'matched_case'::TEXT, d.client_id, d.lead_id;
    RETURN;
  END IF;
  SELECT * INTO m FROM platform_private.whatsapp_intake_phone_match(p_organization_id, p_digits);
  IF m.m_state = 'matched' THEN
    INSERT INTO platform.subject_provenance (organization_id, client_id, source_system, evidence_type, observed_at, imported_at, source_ref)
    VALUES (p_organization_id, m.m_client_id, 'wazzup', 'webhook_verified', p_observed_at, NULL, v_ref);
    IF m.m_lead_id IS NOT NULL THEN
      INSERT INTO platform.subject_provenance (organization_id, lead_id, source_system, evidence_type, observed_at, imported_at, source_ref)
      VALUES (p_organization_id, m.m_lead_id, 'wazzup', 'webhook_verified', p_observed_at, NULL, v_ref);
    END IF;
    RETURN QUERY SELECT 'matched_phone'::TEXT, m.m_client_id, m.m_lead_id;
    RETURN;
  ELSIF m.m_state = 'ambiguous' THEN
    RETURN QUERY SELECT 'ambiguous'::TEXT, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;
  v_client := platform_private.create_or_link_client(p_organization_id,
    COALESCE(p_contact_name, 'WhatsApp ••••' || right(p_digits, 4)), NULL, '+' || p_digits,
    'wazzup', 'direct_chat', 'wazzup:' || p_channel_id::TEXT || ':' || p_digits, 'webhook_verified', p_observed_at, NULL, v_ref);
  RETURN QUERY SELECT 'new_client'::TEXT, v_client, NULL::UUID;
END
$$;

-- ---------------------------------------------------------------------------
-- 9. Проекция событий Wazzup в общие беседы (§5.2).
-- ---------------------------------------------------------------------------

-- Текст сообщения: подпись и метка медиа ровно в формате 259 (её узнают ai_message_view и проверка media_only).
CREATE FUNCTION platform_private.wazzup_message_content(p_element JSONB)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  v_type TEXT := lower(COALESCE(NULLIF(btrim(p_element ->> 'type'), ''), 'text'));
  v_text TEXT := CASE WHEN jsonb_typeof(p_element -> 'text') = 'string' THEN NULLIF(btrim(p_element ->> 'text'), '') END;
  v_uri TEXT := CASE WHEN jsonb_typeof(p_element -> 'contentUri') = 'string' THEN NULLIF(btrim(p_element ->> 'contentUri'), '') END;
  v_kind TEXT;
  c_review CONSTANT TEXT :=
    '[Системное уведомление] Получено медиа или сообщение без текста. Требуется проверка сотрудником.';
BEGIN
  v_kind := CASE v_type
    WHEN 'image' THEN 'Фото' WHEN 'video' THEN 'Видео' WHEN 'audio' THEN 'Голосовое сообщение' WHEN 'document' THEN 'Файл'
    WHEN 'vcard' THEN 'Файл: контакт' WHEN 'geo' THEN 'Файл: геопозиция' END;
  IF v_kind IS NULL AND v_uri IS NOT NULL AND v_type IN ('text', 'wapi_template') THEN
    v_kind := 'Файл';
  END IF;
  IF v_kind IS NOT NULL THEN
    -- Содержимое контакта и координаты не копируются: только метка.
    IF v_type IN ('vcard', 'geo') THEN
      v_text := NULL;
    END IF;
    RETURN jsonb_build_object('body', '📎 ' || v_kind || ' — откройте в WhatsApp продаж'
        || CASE WHEN v_text IS NULL THEN '' ELSE E'\n' || v_text END,
      'has_media', TRUE, 'media_only', v_text IS NULL, 'review', v_text IS NULL, 'media_kind', v_kind);
  END IF;
  IF v_type = 'missing_call' THEN
    RETURN jsonb_build_object('body', 'Пропущенный звонок WhatsApp', 'has_media', FALSE, 'media_only', FALSE, 'review', FALSE);
  END IF;
  IF v_type IN ('unsupported', 'unknown', 'system') OR v_text IS NULL THEN
    RETURN jsonb_build_object('body', c_review, 'has_media', FALSE, 'media_only', FALSE, 'review', TRUE);
  END IF;
  RETURN jsonb_build_object('body', v_text, 'has_media', FALSE, 'media_only', FALSE, 'review', FALSE);
END
$$;

-- Итог проекции события (строка создана при записи события; тут она меняется).
CREATE FUNCTION platform_private.wazzup_projection_set(p_organization_id UUID, p_event_id UUID, p_state TEXT, p_code TEXT,
  p_conversation_id UUID, p_message_id UUID)
RETURNS VOID LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO platform_private.wazzup_event_projections AS x (organization_id, event_id, state, attempts, last_code,
    conversation_id, message_id)
  VALUES (p_organization_id, p_event_id, p_state, 1, p_code, p_conversation_id, p_message_id)
  ON CONFLICT (organization_id, event_id) DO UPDATE SET state = EXCLUDED.state, attempts = LEAST(x.attempts + 1, 1000),
    last_code = EXCLUDED.last_code, conversation_id = COALESCE(EXCLUDED.conversation_id, x.conversation_id),
    message_id = COALESCE(EXCLUDED.message_id, x.message_id), updated_at = clock_timestamp()
$$;

-- Новая беседа (по образцу 259): область записи, доступ ответственного, беседа с клиентом и лидом, участники, привязка чата.
CREATE FUNCTION platform_private.wazzup_create_conversation(p_organization_id UUID, p_channel_id UUID, p_digits TEXT,
  p_event_id UUID, p_owner UUID, p_identity_state TEXT, p_client_id UUID, p_lead_id UUID, p_request_id UUID)
RETURNS TABLE (r_conversation_id UUID, r_customer_participant_id UUID, r_sales_participant_id UUID)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_conv UUID := gen_random_uuid(); v_scope UUID := gen_random_uuid();
  v_customer UUID := gen_random_uuid(); v_sales UUID := gen_random_uuid();
BEGIN
  INSERT INTO platform.record_scopes (id, organization_id, scope_kind, scope_key, scope_version, is_active)
  VALUES (v_scope, p_organization_id, 'conversation', v_conv, 1, TRUE);
  INSERT INTO platform.membership_scope_assignments (organization_id, membership_id, scope_id, scope_version,
    assignment_version, granted, actor_kind, actor_profile_id, reason, request_id)
  VALUES (p_organization_id, p_owner, v_scope, 1, 1, TRUE, 'service', NULL,
    'Grant Sales access to one Wazzup conversation', platform_private.p3c_request_child_id(p_request_id, 'wazzup-scope:' || v_conv::TEXT));
  INSERT INTO platform.communication_conversations (id, organization_id, student_case_id, responsible_sales_membership_id,
    sales_authority_source, current_curator_membership_id, queue, status, subject, waha_session_name, wazzup_channel_id,
    current_scope_id, current_scope_version, created_from_webhook_event_id, canonical_client_id, canonical_lead_id)
  VALUES (v_conv, p_organization_id, NULL, p_owner, 'platform_intake', NULL, 'sales', 'open',
    'WhatsApp ••••' || right(p_digits, 4), NULL, p_channel_id, v_scope, 1, p_event_id, p_client_id, p_lead_id);
  INSERT INTO platform.conversation_participants (id, organization_id, conversation_id, participant_kind, membership_id,
    external_subject_ref, source_webhook_event_id)
  VALUES (v_customer, p_organization_id, v_conv, 'customer', NULL, 'wazzup-participant:' || v_customer::TEXT, p_event_id),
    (v_sales, p_organization_id, v_conv, 'sales', p_owner, NULL, p_event_id);
  INSERT INTO platform_private.wazzup_chat_bindings (organization_id, channel_id, chat_digits, conversation_id,
    source_webhook_event_id, identity_state)
  VALUES (p_organization_id, p_channel_id, p_digits, v_conv, p_event_id, p_identity_state);
  RETURN QUERY SELECT v_conv, v_customer, v_sales;
END
$$;

-- Строка сообщения и её привязка. Удаление клиентом, пришедшее раньше самого сообщения, ставится сразу.
CREATE FUNCTION platform_private.wazzup_insert_message(p_organization_id UUID, p_channel_id UUID, p_event_id UUID,
  p_message_id TEXT, p_account_ref TEXT, p_occurred_at TIMESTAMPTZ, p_conversation_id UUID, p_participant_id UUID,
  p_echo BOOLEAN, p_body TEXT)
RETURNS UUID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_msg UUID := gen_random_uuid(); v_deleted TIMESTAMPTZ;
BEGIN
  INSERT INTO platform.communication_messages (id, organization_id, conversation_id, student_case_id, sender_participant_id,
    direction, body_text, language, student_visible, message_identity_source, source_webhook_event_id,
    manual_send_authorization_id, created_at)
  VALUES (v_msg, p_organization_id, p_conversation_id, NULL, p_participant_id,
    CASE WHEN p_echo THEN 'outbound' ELSE 'inbound' END::platform.communication_direction, p_body, 'undetermined', FALSE,
    CASE WHEN p_echo THEN 'private_wazzup_echo_binding' ELSE 'private_wazzup_binding' END, p_event_id, NULL, p_occurred_at);
  SELECT min(d.provider_occurred_at) INTO v_deleted FROM platform_private.provider_webhook_events d
  WHERE d.organization_id = p_organization_id AND d.provider = 'wazzup' AND d.event_type = 'message.deleted'
    AND d.provider_account_ref = p_account_ref AND d.payload_id = p_message_id;
  INSERT INTO platform_private.wazzup_message_bindings (organization_id, channel_id, wazzup_message_id,
    communication_message_id, source_webhook_event_id, kind, sender_deleted_at)
  VALUES (p_organization_id, p_channel_id, p_message_id, v_msg, p_event_id,
    CASE WHEN p_echo THEN 'staff_echo' ELSE 'inbound' END, v_deleted);
  RETURN v_msg;
END
$$;

-- Ответ продавца: эхо с непустым authorId или sentFromApp=true. Остальное эхо (автоответ «Нерабочее время», Salesbot,
-- рассылки) в беседу не попадает: иначе ночное обращение выглядело бы отвеченным. Точные признаки уточняет проверка A4.
CREATE FUNCTION platform_private.wazzup_echo_is_staff_reply(p_element JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT COALESCE(jsonb_typeof(p_element -> 'authorId') = 'string' AND btrim(p_element ->> 'authorId') <> '', FALSE)
    OR COALESCE(p_element -> 'sentFromApp' = 'true'::JSONB, FALSE)
$$;

-- Ответы продавца, пришедшие раньше первой беседы чата, догружаются при её создании (последние 200 по порядку).
CREATE FUNCTION platform_private.wazzup_backfill_deferred_echoes(p_organization_id UUID, p_channel_id UUID, p_digits TEXT,
  p_conversation_id UUID, p_sales_participant_id UUID)
RETURNS INTEGER LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r RECORD; v_content JSONB; v_msg UUID; v_projected INTEGER := 0;
BEGIN
  FOR r IN
    SELECT recent.* FROM (
      SELECT e.id, e.payload_id, e.provider_account_ref, e.provider_occurred_at, e.raw_payload
      FROM platform_private.wazzup_event_projections p
      JOIN platform_private.provider_webhook_events e ON e.organization_id = p.organization_id AND e.id = p.event_id
      WHERE p.organization_id = p_organization_id AND p.state = 'deferred' AND e.event_type = 'message'
        AND e.provider_account_ref = 'wazzup:' || p_channel_id::TEXT AND e.raw_payload ->> 'chatId' = p_digits
      ORDER BY e.provider_occurred_at DESC, e.id DESC LIMIT 200) recent
    ORDER BY recent.provider_occurred_at, recent.id
  LOOP
    v_content := platform_private.wazzup_message_content(r.raw_payload);
    SELECT b.communication_message_id INTO v_msg FROM platform_private.wazzup_message_bindings b
    WHERE b.organization_id = p_organization_id AND b.channel_id = p_channel_id AND b.wazzup_message_id = r.payload_id;
    IF v_msg IS NULL THEN
      v_msg := platform_private.wazzup_insert_message(p_organization_id, p_channel_id, r.id, r.payload_id, r.provider_account_ref,
        r.provider_occurred_at, p_conversation_id, p_sales_participant_id, TRUE, v_content ->> 'body');
      v_projected := v_projected + 1;
    END IF;
    PERFORM platform_private.wazzup_projection_set(p_organization_id, r.id, 'projected', 'backfilled', p_conversation_id, v_msg);
  END LOOP;
  RETURN v_projected;
END
$$;

-- Ядро проекции одного события. Идемпотентно по событию. Ошибка выходит наружу: итог `failed` пишет обёртка.
CREATE FUNCTION platform_private.wazzup_project_core(p_organization_id UUID, p_event_id UUID, p_owner UUID, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  e platform_private.provider_webhook_events%ROWTYPE; st platform_private.whatsapp_transport_state%ROWTYPE;
  ch platform_private.wazzup_channels%ROWTYPE; prj platform_private.wazzup_event_projections%ROWTYPE;
  chat platform_private.wazzup_chat_bindings%ROWTYPE; conv platform.communication_conversations%ROWTYPE;
  existing platform_private.wazzup_message_bindings%ROWTYPE; ident RECORD; created RECORD;
  el JSONB; v_digits TEXT; v_echo BOOLEAN; v_content JSONB; v_body TEXT; v_review BOOLEAN; v_customer UUID; v_sales UUID;
  v_msg UUID; v_new BOOLEAN := FALSE; v_created BOOLEAN := FALSE; v_identity TEXT; v_deferred INTEGER := 0;
  v_state TEXT; v_code TEXT; v_n INTEGER;
BEGIN
  SELECT * INTO e FROM platform_private.provider_webhook_events x
  WHERE x.organization_id = p_organization_id AND x.id = p_event_id AND x.provider = 'wazzup';
  IF NOT FOUND OR e.verification_status <> 'verified' THEN
    RAISE EXCEPTION 'wazzup_event_unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO st FROM platform_private.whatsapp_transport_state s WHERE s.organization_id = p_organization_id;
  SELECT * INTO ch FROM platform_private.wazzup_channels c WHERE c.organization_id = p_organization_id;
  IF st.organization_id IS NULL OR st.active_transport <> 'wazzup' OR ch.organization_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'transport_inactive');
  END IF;
  SELECT * INTO prj FROM platform_private.wazzup_event_projections p
  WHERE p.organization_id = p_organization_id AND p.event_id = p_event_id FOR UPDATE;
  IF prj.state IN ('projected', 'ignored', 'ignored_auto_echo', 'needs_review') THEN
    RETURN jsonb_build_object('outcome', prj.state, 'code', prj.last_code, 'conversationId', prj.conversation_id,
      'messageId', prj.message_id, 'newInbound', FALSE, 'deduplicated', TRUE, 'aiTriggerEnabled', st.ai_trigger_enabled);
  END IF;
  el := e.raw_payload;
  IF e.provider_account_ref <> 'wazzup:' || ch.channel_id::TEXT THEN
    PERFORM platform_private.wazzup_projection_set(p_organization_id, p_event_id, 'ignored', 'foreign_channel', NULL, NULL);
    RETURN jsonb_build_object('outcome', 'ignored', 'code', 'foreign_channel', 'newInbound', FALSE,
      'aiTriggerEnabled', st.ai_trigger_enabled);
  END IF;

  IF e.event_type = 'unparsed' THEN
    PERFORM platform_private.wazzup_projection_set(p_organization_id, p_event_id, 'needs_review', 'unparsed', NULL, NULL);
    RETURN jsonb_build_object('outcome', 'needs_review', 'code', 'unparsed', 'newInbound', FALSE,
      'aiTriggerEnabled', st.ai_trigger_enabled);
  ELSIF e.event_type = 'channel.state' THEN
    UPDATE platform_private.wazzup_channels c SET state = el ->> 'state', observed_at = LEAST(e.provider_occurred_at, clock_timestamp())
    WHERE c.organization_id = p_organization_id AND c.channel_id = ch.channel_id
      AND (c.observed_at IS NULL OR c.observed_at <= LEAST(e.provider_occurred_at, clock_timestamp()));
    PERFORM platform_private.wazzup_projection_set(p_organization_id, p_event_id, 'projected', 'channel_state', NULL, NULL);
    RETURN jsonb_build_object('outcome', 'projected', 'code', 'channel_state', 'newInbound', FALSE,
      'aiTriggerEnabled', st.ai_trigger_enabled);
  ELSIF e.event_type = 'message.edited' THEN
    PERFORM platform_private.wazzup_projection_set(p_organization_id, p_event_id, 'ignored', 'edit_not_projected', NULL, NULL);
    RETURN jsonb_build_object('outcome', 'ignored', 'code', 'edit_not_projected', 'newInbound', FALSE,
      'aiTriggerEnabled', st.ai_trigger_enabled);
  ELSIF e.event_type = 'message.deleted' THEN
    UPDATE platform_private.wazzup_message_bindings b SET sender_deleted_at = e.provider_occurred_at
    WHERE b.organization_id = p_organization_id AND b.channel_id = ch.channel_id AND b.wazzup_message_id = e.payload_id
      AND b.sender_deleted_at IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_code := CASE WHEN v_n = 1 THEN 'deleted_marked' ELSE 'deleted_noted' END;
    PERFORM platform_private.wazzup_projection_set(p_organization_id, p_event_id, 'projected', v_code, NULL, NULL);
    RETURN jsonb_build_object('outcome', 'projected', 'code', v_code, 'newInbound', FALSE, 'aiTriggerEnabled', st.ai_trigger_enabled);
  END IF;

  -- Сообщение.
  IF jsonb_typeof(el -> 'isEcho') IS DISTINCT FROM 'boolean' THEN
    PERFORM platform_private.wazzup_projection_set(p_organization_id, p_event_id, 'needs_review', 'direction_unverified', NULL, NULL);
    RETURN jsonb_build_object('outcome', 'needs_review', 'code', 'direction_unverified', 'newInbound', FALSE,
      'aiTriggerEnabled', st.ai_trigger_enabled);
  END IF;
  v_echo := (el ->> 'isEcho')::BOOLEAN;
  v_digits := el ->> 'chatId';
  IF v_digits IS NULL OR v_digits !~ '^[1-9][0-9]{6,14}$' THEN
    PERFORM platform_private.wazzup_projection_set(p_organization_id, p_event_id, 'needs_review', 'chat_id_invalid', NULL, NULL);
    RETURN jsonb_build_object('outcome', 'needs_review', 'code', 'chat_id_invalid', 'newInbound', FALSE,
      'aiTriggerEnabled', st.ai_trigger_enabled);
  END IF;
  v_content := platform_private.wazzup_message_content(el);
  v_body := v_content ->> 'body';
  v_review := (v_content ->> 'review')::BOOLEAN;
  IF v_echo THEN
    IF NOT platform_private.wazzup_echo_is_staff_reply(el) THEN
      PERFORM platform_private.wazzup_count(p_organization_id, 'auto_echo');
      PERFORM platform_private.wazzup_projection_set(p_organization_id, p_event_id, 'ignored_auto_echo', 'auto_echo', NULL, NULL);
      RETURN jsonb_build_object('outcome', 'ignored_auto_echo', 'code', 'auto_echo', 'newInbound', FALSE,
        'aiTriggerEnabled', st.ai_trigger_enabled);
    END IF;
    IF v_review AND NOT (v_content ->> 'has_media')::BOOLEAN THEN
      PERFORM platform_private.wazzup_projection_set(p_organization_id, p_event_id, 'ignored', 'empty_echo', NULL, NULL);
      RETURN jsonb_build_object('outcome', 'ignored', 'code', 'empty_echo', 'newInbound', FALSE,
        'aiTriggerEnabled', st.ai_trigger_enabled);
    END IF;
  END IF;

  -- Один замок на чат: два события одного человека не создадут две беседы.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'evo:wazzup:chat:' || p_organization_id::TEXT || ':' || ch.channel_id::TEXT || ':' || v_digits, 0));
  SELECT * INTO chat FROM platform_private.wazzup_chat_bindings b
  WHERE b.organization_id = p_organization_id AND b.channel_id = ch.channel_id AND b.chat_digits = v_digits;
  IF NOT FOUND THEN
    IF v_echo THEN
      -- Ответ продавца в чат без беседы беседу и клиента не создаёт: ждёт первого входящего.
      PERFORM platform_private.wazzup_projection_set(p_organization_id, p_event_id, 'deferred', 'echo_before_conversation', NULL, NULL);
      RETURN jsonb_build_object('outcome', 'deferred', 'code', 'echo_before_conversation', 'newInbound', FALSE,
        'aiTriggerEnabled', st.ai_trigger_enabled);
    END IF;
    IF p_owner IS NULL OR NOT platform_private.staff_intake_owner_is_eligible(p_organization_id, p_owner) THEN
      RAISE EXCEPTION 'wazzup_intake_owner_ineligible' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO ident FROM platform_private.acquire_wazzup_canonical_identity(p_organization_id, ch.channel_id, v_digits,
      p_event_id, e.provider_occurred_at, platform_private.wazzup_contact_name(el, v_digits));
    SELECT * INTO created FROM platform_private.wazzup_create_conversation(p_organization_id, ch.channel_id, v_digits, p_event_id,
      p_owner, ident.r_state, ident.r_client_id, ident.r_lead_id, p_request_id);
    v_created := TRUE;
    conv.id := created.r_conversation_id;
    conv.responsible_sales_membership_id := p_owner;
    v_customer := created.r_customer_participant_id;
    v_sales := created.r_sales_participant_id;
    v_identity := ident.r_state;
    v_deferred := platform_private.wazzup_backfill_deferred_echoes(p_organization_id, ch.channel_id, v_digits, conv.id, v_sales);
  ELSE
    SELECT * INTO conv FROM platform.communication_conversations c
    WHERE c.organization_id = p_organization_id AND c.id = chat.conversation_id;
    IF conv.id IS NULL OR conv.wazzup_channel_id IS DISTINCT FROM ch.channel_id OR conv.queue <> 'sales'
      OR conv.student_case_id IS NOT NULL OR conv.current_curator_membership_id IS NOT NULL
      OR conv.sales_authority_source <> 'platform_intake' THEN
      -- После передачи в поступление беседа ушла куратору: новое сообщение не открывает новую беседу продаж.
      PERFORM platform_private.wazzup_projection_set(p_organization_id, p_event_id, 'needs_review', 'conversation_not_sales',
        chat.conversation_id, NULL);
      RETURN jsonb_build_object('outcome', 'needs_review', 'code', 'conversation_not_sales', 'newInbound', FALSE,
        'conversationId', chat.conversation_id, 'aiTriggerEnabled', st.ai_trigger_enabled);
    END IF;
    SELECT x.id INTO v_customer FROM platform.conversation_participants x
    WHERE x.organization_id = p_organization_id AND x.conversation_id = conv.id AND x.participant_kind = 'customer'
    ORDER BY x.created_at, x.id LIMIT 1;
    SELECT x.id INTO v_sales FROM platform.conversation_participants x
    WHERE x.organization_id = p_organization_id AND x.conversation_id = conv.id AND x.participant_kind = 'sales'
      AND x.membership_id = conv.responsible_sales_membership_id ORDER BY x.created_at, x.id LIMIT 1;
    IF v_customer IS NULL OR v_sales IS NULL THEN
      RAISE EXCEPTION 'wazzup_conversation_participants_incomplete' USING ERRCODE = '55000';
    END IF;
    v_identity := chat.identity_state;
  END IF;

  SELECT * INTO existing FROM platform_private.wazzup_message_bindings b
  WHERE b.organization_id = p_organization_id AND b.channel_id = ch.channel_id AND b.wazzup_message_id = e.payload_id;
  IF FOUND THEN
    IF existing.kind IS DISTINCT FROM (CASE WHEN v_echo THEN 'staff_echo' ELSE 'inbound' END) THEN
      PERFORM platform_private.wazzup_projection_set(p_organization_id, p_event_id, 'needs_review', 'message_direction_conflict',
        conv.id, existing.communication_message_id);
      RETURN jsonb_build_object('outcome', 'needs_review', 'code', 'message_direction_conflict', 'newInbound', FALSE,
        'conversationId', conv.id, 'aiTriggerEnabled', st.ai_trigger_enabled);
    END IF;
    v_msg := existing.communication_message_id;
  ELSE
    v_msg := platform_private.wazzup_insert_message(p_organization_id, ch.channel_id, p_event_id, e.payload_id, e.provider_account_ref,
      e.provider_occurred_at, conv.id, CASE WHEN v_echo THEN v_sales ELSE v_customer END, v_echo, v_body);
    v_new := NOT v_echo;
    IF v_review AND NOT v_echo THEN
      INSERT INTO platform.conversation_handoff_events (organization_id, conversation_id, previous_student_case_id,
        new_student_case_id, previous_queue, new_queue, previous_owner_membership_id, new_owner_membership_id,
        source_webhook_event_id, student_case_assignment_event_id, reason, request_id)
      VALUES (p_organization_id, conv.id, NULL, NULL, CASE WHEN v_created THEN NULL ELSE 'sales'::platform.communication_queue END,
        'sales', CASE WHEN v_created THEN NULL ELSE conv.responsible_sales_membership_id END, conv.responsible_sales_membership_id,
        p_event_id, NULL, 'Inbound Wazzup content without text requires staff review',
        platform_private.p3c_request_child_id(p_request_id, 'wazzup-handoff:' || p_event_id::TEXT));
    END IF;
  END IF;
  IF v_identity = 'ambiguous' AND NOT v_echo THEN
    v_state := 'needs_review'; v_code := 'identity_ambiguous';
  ELSE
    v_state := 'projected'; v_code := CASE WHEN v_created THEN 'conversation_created' ELSE 'message' END;
  END IF;
  PERFORM platform_private.wazzup_projection_set(p_organization_id, p_event_id, v_state, v_code, conv.id, v_msg);
  RETURN jsonb_build_object('outcome', v_state, 'code', v_code, 'conversationId', conv.id, 'messageId', v_msg,
    'newInbound', v_new, 'conversationCreated', v_created, 'identityState', v_identity, 'deferredEchoes', v_deferred,
    'humanReviewRequired', v_review AND NOT v_echo, 'aiTriggerEnabled', st.ai_trigger_enabled);
END
$$;

-- Проекция одного события (service_role). Ошибка не теряет событие: итог `failed` с кодом и числом попыток, подтранзакция
-- откатывает полузаписанное; в код идёт только SQLSTATE или наше слово `wazzup_*`, никогда текст ошибки.
CREATE FUNCTION platform.wazzup_project_event_v1(p_organization_id UUID, p_event_id UUID, p_intake_sales_membership_id UUID,
  p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_state TEXT; v_message TEXT; v_code TEXT;
BEGIN
  PERFORM platform_private.require_p2g_service();
  IF p_organization_id IS NULL OR p_event_id IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'wazzup_project_invalid_request' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform_private.provider_webhook_events x
    WHERE x.organization_id = p_organization_id AND x.id = p_event_id AND x.provider = 'wazzup') THEN
    RAISE EXCEPTION 'wazzup_event_unavailable' USING ERRCODE = '42501';
  END IF;
  BEGIN
    RETURN platform_private.wazzup_project_core(p_organization_id, p_event_id, p_intake_sales_membership_id, p_request_id);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
    v_code := CASE WHEN v_message ~ '^wazzup_[a-z_]{1,50}$' THEN v_message ELSE v_state END;
    PERFORM platform_private.wazzup_projection_set(p_organization_id, p_event_id, 'failed', v_code, NULL, NULL);
    RETURN jsonb_build_object('outcome', 'failed', 'code', v_code, 'newInbound', FALSE);
  END;
END
$$;

-- Догрузка (service_role): старейшие pending/failed (не больше 8 попыток) по порядку времени сообщения - внутри чата это
-- и есть порядок dateTime. Возраст самого старого необработанного - в ответе (для метрики и «деградации» после 30 минут).
CREATE FUNCTION platform.wazzup_projection_sweep_v1(p_organization_id UUID, p_intake_sales_membership_id UUID,
  p_limit INTEGER DEFAULT 100)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_state platform_private.whatsapp_transport_state; r RECORD; v_one JSONB; v_processed INTEGER := 0; v_new INTEGER := 0;
  v_outcomes JSONB := '{}'::JSONB; v_oldest TIMESTAMPTZ; v_exhausted BIGINT; v_outcome TEXT;
BEGIN
  PERFORM platform_private.require_p2g_service();
  IF p_organization_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'wazzup_sweep_invalid_request' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_state FROM platform_private.whatsapp_transport_state s WHERE s.organization_id = p_organization_id;
  IF v_state.organization_id IS NULL OR v_state.active_transport <> 'wazzup' THEN
    RETURN jsonb_build_object('transportActive', FALSE);
  END IF;
  FOR r IN
    SELECT p.event_id FROM platform_private.wazzup_event_projections p
    JOIN platform_private.provider_webhook_events e ON e.organization_id = p.organization_id AND e.id = p.event_id
    WHERE p.organization_id = p_organization_id AND (p.state = 'pending' OR (p.state = 'failed' AND p.attempts < 8))
    ORDER BY e.provider_occurred_at, e.received_at, e.id
    LIMIT p_limit
  LOOP
    v_one := platform.wazzup_project_event_v1(p_organization_id, r.event_id, p_intake_sales_membership_id, gen_random_uuid());
    v_processed := v_processed + 1;
    v_outcome := v_one ->> 'outcome';
    v_outcomes := jsonb_set(v_outcomes, ARRAY[v_outcome], to_jsonb(COALESCE((v_outcomes ->> v_outcome)::INTEGER, 0) + 1));
    IF (v_one ->> 'newInbound')::BOOLEAN THEN
      v_new := v_new + 1;
    END IF;
  END LOOP;
  SELECT min(p.created_at) INTO v_oldest FROM platform_private.wazzup_event_projections p
  WHERE p.organization_id = p_organization_id AND (p.state = 'pending' OR (p.state = 'failed' AND p.attempts < 8));
  SELECT count(*) INTO v_exhausted FROM platform_private.wazzup_event_projections p
  WHERE p.organization_id = p_organization_id AND p.state = 'failed' AND p.attempts >= 8;
  RETURN jsonb_build_object('transportActive', TRUE, 'processed', v_processed, 'outcomes', v_outcomes, 'newInbound', v_new,
    'oldestPendingSeconds', CASE WHEN v_oldest IS NULL THEN NULL ELSE floor(extract(epoch FROM clock_timestamp() - v_oldest))::BIGINT END,
    'failedExhausted', v_exhausted, 'aiTriggerEnabled', v_state.ai_trigger_enabled);
END
$$;

-- ---------------------------------------------------------------------------
-- 10. Ворота отправки (B.9) в шести путях. Тела меняются заменой проверенных фрагментов (приём 282/320): фрагмент обязан
-- встретиться ровно столько раз, сколько ожидается, иначе миграция падает, ничего не меняя. Права и владельцев
-- CREATE OR REPLACE сохраняет.
-- ---------------------------------------------------------------------------

-- 1) Инструмент send_message (318). Ворота закрыты -> черновик pending с кодом receive_only, никогда прямой отправки
-- (ни «Авто», ни код полномочия). И для WAHA без Wazzup: прямая отправка только при состоянии `connected`; любое другое,
-- включая `unknown` (нет строки здоровья сессии, а у беседы без сессии её и не бывает), - черновик, а не `needs_dispatch`.
SELECT pg_temp.a325_replace('platform.ai_agent_tool_send_message_v1(uuid,text,jsonb)',
  $old$  IF v_direct THEN
    -- Отправитель: инициатор запуска с кодом полномочия, иначе ответственный.
$old$,
  $new$  -- 325: WhatsApp подключён только на чтение (действующий путь Wazzup или беседа пришла через Wazzup): прямой отправки нет
  -- никогда, черновик ждёт сотрудника с кодом receive_only (ворота отправки: одно место на все пути).
  IF v_channel = 'whatsapp' AND NOT platform_private.whatsapp_send_allowed(p_organization_id, v_conv.id) THEN
    v_fail := 'receive_only';
    v_direct := FALSE;
  END IF;

  IF v_direct THEN
    -- Отправитель: инициатор запуска с кодом полномочия, иначе ответственный.
$new$, 1, 'whatsapp_send_allowed');
SELECT pg_temp.a325_replace('platform.ai_agent_tool_send_message_v1(uuid,text,jsonb)',
  $old$      IF v_state = 'disconnected' THEN
        v_fail := 'whatsapp_unavailable';$old$,
  $new$      -- 325: прямая отправка только при подтверждённой связи; «неизвестно» больше не значит «можно».
      IF v_state IS DISTINCT FROM 'connected' THEN
        v_fail := 'whatsapp_unavailable';$new$, 1, NULL);
SELECT pg_temp.a325_replace('platform.ai_agent_tool_send_message_v1(uuid,text,jsonb)',
  $old$        WHEN 'whatsapp_unavailable' THEN 'WhatsApp сейчас не подключён'
$old$,
  $new$        WHEN 'whatsapp_unavailable' THEN 'WhatsApp сейчас не подключён'
        WHEN 'receive_only' THEN 'WhatsApp подключён только на чтение: отправьте сообщение из amoCRM или Wazzup'
$new$, 1, NULL);

-- 2) Авторизация отправки одобренного черновика (317): новой авторизации и работы нет, в том числе повтором начатой
-- отправки; одобренный черновик остаётся ждать сотрудника.
SELECT pg_temp.a325_replace('platform.ai_agent_runtime_whatsapp_authorize_v1(uuid,uuid,uuid,text,uuid)',
  $old$  -- Повтор начатой отправки: прежняя авторизация и работа.
  IF d.status = 'sending' THEN
$old$,
  $new$  -- 325: WhatsApp подключён только на чтение: ни новой авторизации, ни работы в очереди (ворота отправки). Одобренный
  -- черновик остаётся ждать сотрудника (pending, receive_only).
  IF d.channel = 'whatsapp' AND NOT platform_private.whatsapp_send_allowed(p_organization_id, d.conversation_id) THEN
    IF d.status = 'approved' THEN
      UPDATE platform_private.ai_agent_drafts x SET status = 'pending', failure_code = 'receive_only' WHERE x.id = d.id;
    END IF;
    RETURN jsonb_build_object('authorized', FALSE, 'reason', 'receive_only');
  END IF;

  -- Повтор начатой отправки: прежняя авторизация и работа.
  IF d.status = 'sending' THEN
$new$, 1, 'whatsapp_send_allowed');

-- 3) Отметка черновика (317): receive_only - код, оставляющий черновик pending.
SELECT pg_temp.a325_replace('platform.ai_agent_runtime_draft_mark_v1(uuid,uuid,text,text,uuid,jsonb)',
  $old$    AND p_failure_code IN ('whatsapp_unavailable', 'rate_limited', 'staff_active', 'sender_unavailable') THEN$old$,
  $new$    AND p_failure_code IN ('whatsapp_unavailable', 'rate_limited', 'staff_active', 'sender_unavailable', 'receive_only') THEN$new$,
  1, 'receive_only');

-- 4) Ночной автоответчик (276, 320): на всех стадиях (due, commit, authorize), сразу после проверки паузы. Сначала ворота
-- Gemini (чат Wazzup тексты Gemini не отдаёт), затем ворота отправки.
SELECT pg_temp.a325_replace('platform_private.ai_autosend_check(platform_private.ai_autosend_log,text,text,bigint[])',
  $old$  IF v_settings.pause_code IS NOT NULL THEN
    RETURN 'paused';
  END IF;
$old$,
  $new$  IF v_settings.pause_code IS NOT NULL THEN
    RETURN 'paused';
  END IF;
  -- 325: чат Wazzup, а владелец не разрешил передавать такие тексты в Gemini: автоответчик в нём не читает и не отвечает.
  IF NOT platform_private.whatsapp_gemini_allowed(p_log.organization_id, p_log.conversation_id) THEN
    RETURN 'wazzup_ai_off';
  END IF;
  -- 325: WhatsApp подключён только на чтение: автоответчик ничего не отправляет (ворота отправки).
  IF NOT platform_private.whatsapp_send_allowed(p_log.organization_id, p_log.conversation_id) THEN
    RETURN 'receive_only';
  END IF;
$new$, 1, 'whatsapp_send_allowed');
SELECT pg_temp.a325_replace('platform_private.ai_autosend_reason_ru(text)',
  $old$    WHEN 'ai_consent_missing' THEN 'Студент не дал согласия на ИИ-помощников'
$old$,
  $new$    WHEN 'ai_consent_missing' THEN 'Студент не дал согласия на ИИ-помощников'
    WHEN 'receive_only' THEN 'WhatsApp подключён только на чтение'
    WHEN 'wazzup_ai_off' THEN 'Тексты чатов Wazzup не передаются в Gemini'
$new$, 1, 'receive_only');

-- 5) Ручной ответ сотрудника (050): отказ до вставки авторизации. 55000, текст начинается с кода.
SELECT pg_temp.a325_replace('platform.request_manual_whatsapp_send_with_authorization(uuid,uuid,uuid,uuid,text,text,text,uuid)',
  $old$    'communication.manual.send'
  );

  expected_business_key := encode($old$,
  $new$    'communication.manual.send'
  );

  -- 325: WhatsApp подключён только на чтение: ответа из EVO нет, авторизация не создаётся (ворота отправки).
  IF NOT platform_private.whatsapp_send_allowed(p_organization_id, p_conversation_id) THEN
    RAISE EXCEPTION 'receive_only: WhatsApp is connected read-only; send from amoCRM or Wazzup'
      USING ERRCODE = '55000';
  END IF;

  expected_business_key := encode($new$, 1, 'whatsapp_send_allowed');

-- 6) Захват уже авторизованной работы (266): работа, авторизованная до переключения, не захватывается и не уходит в WAHA.
-- Ответ тот же, что «захватывать нечего» (приложение разбирает ровно эти ключи).
SELECT pg_temp.a325_replace('platform.claim_manual_whatsapp_send_item(uuid,uuid,integer,text,uuid)',
  $old$  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:p5b:manual-whatsapp-exact-claim:' || p_organization_id::TEXT,$old$,
  $new$  -- 325: WhatsApp подключён только на чтение: работа остаётся в очереди нетронутой (ворота отправки).
  IF NOT platform_private.whatsapp_send_allowed(
    p_organization_id,
    (
      SELECT gate_authorization.conversation_id
      FROM platform_private.durable_work_items AS gate_item
      JOIN platform.manual_send_authorizations AS gate_authorization
        ON gate_authorization.organization_id = gate_item.organization_id
       AND gate_authorization.id = gate_item.manual_send_authorization_id
      WHERE gate_item.organization_id = p_organization_id
        AND gate_item.id = p_work_item_id
        AND gate_item.kind = 'manual_whatsapp_send'
    )
  ) THEN
    RETURN pg_catalog.jsonb_build_object(
      'claimed', FALSE,
      'queue', 'platform_work_v1',
      'requested_work_item_id', p_work_item_id
    );
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:p5b:manual-whatsapp-exact-claim:' || p_organization_id::TEXT,$new$, 1, 'whatsapp_send_allowed');

-- ---------------------------------------------------------------------------
-- 11. Чтение переписки агентами (B.10): ворота закрыты - `receive_only` и `can_reply = false`; беседа с неопределённым
-- клиентом закрыта; удалённое клиентом сообщение без текста.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a325_replace('platform.ai_agent_tool_get_conversation_v1(uuid,text,jsonb)',
  $old$    RAISE EXCEPTION 'ai_consent_missing' USING ERRCODE = '42501';
  END IF;
  -- 319: аудит чтения в этой же транзакции, до выдачи данных.
$old$,
  $new$    RAISE EXCEPTION 'ai_consent_missing' USING ERRCODE = '42501';
  END IF;
  -- 325: беседа Wazzup, чей клиент не определён (несколько клиентов на одном номере): закрыта целиком, строки чтения нет.
  IF platform_private.wazzup_conversation_unresolved(p_organization_id, cv.id) THEN
    RAISE EXCEPTION 'identity_unresolved' USING ERRCODE = '42501';
  END IF;
  -- 319: аудит чтения в этой же транзакции, до выдачи данных.
$new$, 1, 'wazzup_conversation_unresolved');
SELECT pg_temp.a325_replace('platform.ai_agent_tool_get_conversation_v1(uuid,text,jsonb)',
  $old$      'text', left(COALESCE(platform_private.ai_message_view(m) ->> 'text', ''), 2000),
      'media_kind', (platform_private.ai_message_view(m) -> 'media' -> 0 ->> 'kind'))) ORDER BY m.created_at DESC, m.id DESC)$old$,
  $new$      'text', CASE WHEN platform_private.wazzup_message_deleted(m.organization_id, m.id) THEN NULL
        ELSE left(COALESCE(platform_private.ai_message_view(m) ->> 'text', ''), 2000) END,
      'media_kind', (platform_private.ai_message_view(m) -> 'media' -> 0 ->> 'kind'))
        || CASE WHEN platform_private.wazzup_message_deleted(m.organization_id, m.id) THEN jsonb_build_object('deleted', TRUE)
          ELSE '{}'::JSONB END) ORDER BY m.created_at DESC, m.id DESC)$new$, 1, NULL);
SELECT pg_temp.a325_replace('platform.ai_agent_tool_get_conversation_v1(uuid,text,jsonb)',
  $old$  v_state := platform_private.ai_agent_whatsapp_state(p_organization_id, cv.waha_session_name);
$old$,
  $new$  v_state := CASE WHEN platform_private.whatsapp_send_allowed(p_organization_id, cv.id)
    THEN platform_private.ai_agent_whatsapp_state(p_organization_id, cv.waha_session_name) ELSE 'receive_only' END;
$new$, 1, NULL);
SELECT pg_temp.a325_replace('platform.ai_agent_tool_get_conversation_v1(uuid,text,jsonb)',
  $old$AND v_latest IS NOT NULL AND v_state <> 'disconnected',$old$,
  $new$AND v_latest IS NOT NULL AND v_state NOT IN ('disconnected', 'receive_only'),$new$, 1, NULL);
SELECT pg_temp.a325_replace('platform.ai_agent_tool_list_conversations_v1(uuid,text,jsonb)',
  $old$      'last_text_preview', CASE WHEN platform_private.ai_agent_conversation_ai_allowed(q.organization_id, q.id)
        THEN left(q.last_body, 200) END,$old$,
  $new$      'last_text_preview', CASE WHEN platform_private.ai_agent_conversation_ai_allowed(q.organization_id, q.id)
        AND NOT platform_private.wazzup_conversation_unresolved(q.organization_id, q.id)
        THEN left(q.last_body, 200) END,$new$, 1, 'wazzup_conversation_unresolved');
SELECT pg_temp.a325_replace('platform.ai_agent_tool_list_conversations_v1(uuid,text,jsonb)',
  $old$        ELSE jsonb_build_object('ai_consent_missing', TRUE) END
$old$,
  $new$        ELSE jsonb_build_object('ai_consent_missing', TRUE) END
      || CASE WHEN platform_private.wazzup_conversation_unresolved(q.organization_id, q.id)
        THEN jsonb_build_object('identity_unresolved', TRUE) ELSE '{}'::JSONB END
$new$, 1, NULL);

-- ---------------------------------------------------------------------------
-- 12. Ворота Gemini (B.11): те же места, что у согласия 320. Чат Wazzup тексты Gemini не отдаёт, пока владелец не сказал «да».
-- ---------------------------------------------------------------------------
-- P3: опрос входящих (поллер памяти и ночного автоответчика) не даёт указателей на сообщения чатов Wazzup.
SELECT pg_temp.a325_replace('platform_ai_agent.inbound_since_v1(timestamptz,uuid,integer)',
  $old$    WHERE c.organization_id = ANY (v_orgs) AND c.queue = 'sales'
$old$,
  $new$    WHERE c.organization_id = ANY (v_orgs) AND c.queue = 'sales'
      -- 325: чат Wazzup без разрешения владельца указателей не даёт (ворота Gemini).
      AND (c.wazzup_channel_id IS NULL OR platform_private.whatsapp_gemini_allowed(c.organization_id, c.id))
$new$, 1, 'whatsapp_gemini_allowed');
SELECT pg_temp.a325_replace('platform_private.ai_memory_poke(uuid,boolean,integer)',
  $old$  -- 320: студент чата не разрешил ИИ-помощников: сводка и интерес не собираются.
$old$,
  $new$  -- 325: чат Wazzup, а владелец не разрешил передавать такие тексты в Gemini: сводка и интерес не собираются.
  IF NOT platform_private.whatsapp_gemini_allowed(
      (SELECT c.organization_id FROM platform.communication_conversations c WHERE c.id = p_conversation_id), p_conversation_id) THEN
    RETURN jsonb_build_object('conversationId', p_conversation_id, 'status', 'skipped', 'reason', 'wazzup_ai_off');
  END IF;
  -- 320: студент чата не разрешил ИИ-помощников: сводка и интерес не собираются.
$new$, 1, 'whatsapp_gemini_allowed');
SELECT pg_temp.a325_replace('platform_ai_agent.memory_context_v1(uuid,text,integer)',
  $old$  -- 320: студент чата не разрешил ИИ-помощников: ничего не читается, указатель и аренда снимаются.
$old$,
  $new$  -- 325: чат Wazzup, а владелец не разрешил передавать такие тексты в Gemini: ничего не читается, указатель и аренда снимаются.
  IF NOT platform_private.whatsapp_gemini_allowed(v_org, p_conversation_id) THEN
    UPDATE platform_private.ai_client_memory m SET enqueued_at = NULL, lease_owner = NULL, lease_expires_at = NULL
    WHERE m.conversation_id = p_conversation_id;
    RETURN jsonb_build_object('status', 'none', 'mode', 'none', 'conversationId', p_conversation_id,
      'version', COALESCE((SELECT m.version FROM platform_private.ai_client_memory m WHERE m.conversation_id = p_conversation_id), 0),
      'reason', 'wazzup_ai_off');
  END IF;
  -- 320: студент чата не разрешил ИИ-помощников: ничего не читается, указатель и аренда снимаются.
$new$, 1, 'whatsapp_gemini_allowed');
SELECT pg_temp.a325_replace('platform_ai_agent.autosend_summary_context_v1(uuid,text,integer)',
  $old$    AND platform_private.ai_agent_conversation_ai_allowed(c.organization_id, c.id);$old$,
  $new$    AND platform_private.ai_agent_conversation_ai_allowed(c.organization_id, c.id)
    AND platform_private.whatsapp_gemini_allowed(c.organization_id, c.id);$new$, 1, 'whatsapp_gemini_allowed');
-- U9 (066): устаревшие предложения Gemini. Отказ до всякой работы, как у согласия 320 (там же и повтор сохранённой заявки).
SELECT pg_temp.a325_replace('platform.request_gemini_proposal(uuid,uuid,uuid,uuid,text,integer,text,text)',
  $old$  -- 320: студент чата не разрешил ИИ-помощников.
$old$,
  $new$  -- 325: чат Wazzup, а владелец не разрешил передавать такие тексты в Gemini.
  IF NOT platform_private.whatsapp_gemini_allowed(p_organization_id, p_conversation_id) THEN
    RAISE EXCEPTION 'wazzup_ai_off' USING ERRCODE = '42501';
  END IF;
  -- 320: студент чата не разрешил ИИ-помощников.
$new$, 1, 'whatsapp_gemini_allowed');
SELECT pg_temp.a325_replace('platform.begin_gemini_proposal(uuid,uuid,uuid,uuid,text,integer,text)',
  $old$  -- 320: студент чата не разрешил ИИ-помощников: текст сообщения сервису не отдаётся, повтор тоже.
$old$,
  $new$  -- 325: чат Wazzup, а владелец не разрешил передавать такие тексты в Gemini: текст сообщения сервису не отдаётся, повтор тоже.
  IF NOT platform_private.whatsapp_gemini_allowed(p_organization_id, p_conversation_id) THEN
    RAISE EXCEPTION 'wazzup_ai_off' USING ERRCODE = '42501';
  END IF;
  -- 320: студент чата не разрешил ИИ-помощников: текст сообщения сервису не отдаётся, повтор тоже.
$new$, 1, 'whatsapp_gemini_allowed');
-- P1: окно «Помочь с ответом» в чате продаж и проверка уже выданного билета.
SELECT pg_temp.a325_replace('platform.ai_agent_ticket_v1(uuid,text,uuid,uuid)',
  $old$  PERFORM platform_private.ai_require_consent(platform_private.ai_settings_row(p_organization_id));
$old$,
  $new$  PERFORM platform_private.ai_require_consent(platform_private.ai_settings_row(p_organization_id));
  -- 325: чат Wazzup, а владелец не разрешил передавать такие тексты в Gemini: билет окна не выдаётся.
  IF p_purpose = 'answer' AND NOT platform_private.whatsapp_gemini_allowed(p_organization_id, p_conversation_id) THEN
    RAISE EXCEPTION 'wazzup_ai_off' USING ERRCODE = '42501';
  END IF;
$new$, 1, 'whatsapp_gemini_allowed');
SELECT pg_temp.a325_replace('platform_private.ai_ticket_allowed(platform_private.ai_tickets)',
  $old$      AND platform_private.ai_agent_conversation_ai_allowed(p_ticket.organization_id, p_ticket.conversation_id)
$old$,
  $new$      AND platform_private.ai_agent_conversation_ai_allowed(p_ticket.organization_id, p_ticket.conversation_id)
      -- 325: чат Wazzup без разрешения владельца окну ИИ недоступен.
      AND platform_private.whatsapp_gemini_allowed(p_ticket.organization_id, p_ticket.conversation_id)
$new$, 1, 'whatsapp_gemini_allowed');

-- ---------------------------------------------------------------------------
-- 13. Тревога о связи (321) для Wazzup (§5.4): сессия `wazzup`, вид `gap`, причины `transport_switched` и `counts_match`.
-- Слова статуса Wazzup (active -> WORKING и т. д.) переводит приложение; база хранит слово и решает только дедуп.
-- ---------------------------------------------------------------------------
ALTER TABLE platform_private.whatsapp_health_monitor DROP CONSTRAINT whatsapp_health_monitor_session_check;
ALTER TABLE platform_private.whatsapp_health_monitor ADD CONSTRAINT whatsapp_health_monitor_session_check
  CHECK (session_name IN ('crm_primary', 'wazzup'));
ALTER TABLE platform_private.whatsapp_health_alerts DROP CONSTRAINT whatsapp_health_alerts_session_check;
ALTER TABLE platform_private.whatsapp_health_alerts ADD CONSTRAINT whatsapp_health_alerts_session_check
  CHECK (session_name IN ('crm_primary', 'wazzup'));
ALTER TABLE platform_private.whatsapp_health_alerts DROP CONSTRAINT whatsapp_health_alerts_kind_check;
ALTER TABLE platform_private.whatsapp_health_alerts ADD CONSTRAINT whatsapp_health_alerts_kind_check
  CHECK (kind IN ('disconnected', 'silent', 'gap'));
-- `gap` - суточная сверка количеств, только для Wazzup.
ALTER TABLE platform_private.whatsapp_health_alerts ADD CONSTRAINT whatsapp_health_alerts_gap_session_check
  CHECK (kind <> 'gap' OR session_name = 'wazzup');
ALTER TABLE platform_private.whatsapp_health_alerts DROP CONSTRAINT whatsapp_health_alerts_resolved_check;
ALTER TABLE platform_private.whatsapp_health_alerts ADD CONSTRAINT whatsapp_health_alerts_resolved_check CHECK (
  (resolved_at IS NULL) = (resolved_reason IS NULL)
  AND (resolved_reason IS NULL OR resolved_reason IN
    ('working_again', 'messages_arrived', 'reconnected', 'transport_switched', 'counts_match'))
  AND (resolved_at IS NULL OR resolved_at >= opened_at));

-- Страж: сессия `crm_primary` или `wazzup`.
SELECT pg_temp.a325_replace('platform_private.whatsapp_health_guard(uuid,text)',
  $old$p_session IS DISTINCT FROM 'crm_primary'$old$,
  $new$p_session IS NULL OR p_session NOT IN ('crm_primary', 'wazzup')$new$, 1, 'wazzup');

-- Чтение: для Wazzup последнее входящее клиента - событие `message` с isEcho = false за 30 суток; ответ несёт и тревогу `gap`.
SELECT pg_temp.a325_replace('platform.whatsapp_health_read_v1(uuid,text)',
  $old$  v_last TIMESTAMPTZ; v_has_monitor BOOLEAN; v_has_disconnected BOOLEAN; v_has_silent BOOLEAN;$old$,
  $new$  v_last TIMESTAMPTZ; v_has_monitor BOOLEAN; v_has_disconnected BOOLEAN; v_has_silent BOOLEAN;
  v_gap platform_private.whatsapp_health_alerts%ROWTYPE; v_has_gap BOOLEAN;$new$, 1, 'v_has_gap');
SELECT pg_temp.a325_replace('platform.whatsapp_health_read_v1(uuid,text)',
  $old$  v_has_silent := FOUND;
$old$,
  $new$  v_has_silent := FOUND;
  SELECT * INTO v_gap FROM platform_private.whatsapp_health_alerts a
  WHERE a.organization_id = p_organization_id AND a.session_name = p_session AND a.kind = 'gap'
    AND a.resolved_at IS NULL;
  v_has_gap := FOUND;
$new$, 1, NULL);
SELECT pg_temp.a325_replace('platform.whatsapp_health_read_v1(uuid,text)',
  $old$  SELECT max(e.received_at) INTO v_last FROM platform_private.provider_webhook_events e
  WHERE e.organization_id = p_organization_id AND e.provider = 'waha' AND e.waha_session_name = p_session
    AND e.event_type = 'message.any' AND e.verification_status = 'verified'
    AND e.received_at >= v_now - INTERVAL '30 days'
    AND e.raw_payload #>> '{payload,fromMe}' = 'false';
$old$,
  $new$  IF p_session = 'wazzup' THEN
    SELECT max(e.received_at) INTO v_last FROM platform_private.provider_webhook_events e
    WHERE e.organization_id = p_organization_id AND e.provider = 'wazzup' AND e.event_type = 'message'
      AND e.verification_status = 'verified' AND e.received_at >= v_now - INTERVAL '30 days'
      AND e.raw_payload ->> 'isEcho' = 'false';
  ELSE
    SELECT max(e.received_at) INTO v_last FROM platform_private.provider_webhook_events e
    WHERE e.organization_id = p_organization_id AND e.provider = 'waha' AND e.waha_session_name = p_session
      AND e.event_type = 'message.any' AND e.verification_status = 'verified'
      AND e.received_at >= v_now - INTERVAL '30 days'
      AND e.raw_payload #>> '{payload,fromMe}' = 'false';
  END IF;
$new$, 1, NULL);
SELECT pg_temp.a325_replace('platform.whatsapp_health_read_v1(uuid,text)',
  $old$    'lastInboundAt', v_last);$old$,
  $new$    'gap', CASE WHEN v_has_gap THEN jsonb_build_object('id', v_gap.id, 'openedAt', v_gap.opened_at) END,
    'lastInboundAt', v_last);$new$, 1, NULL);

-- Открытие: вид `gap` (только Wazzup).
SELECT pg_temp.a325_replace('platform.whatsapp_health_open_v1(uuid,text,text,text,uuid)',
  $old$  IF p_kind IS NULL OR p_kind NOT IN ('disconnected', 'silent')
    OR p_status IS NULL$old$,
  $new$  IF p_kind IS NULL OR p_kind NOT IN ('disconnected', 'silent', 'gap') OR (p_kind = 'gap' AND p_session <> 'wazzup')
    OR p_status IS NULL$new$, 1, 'wazzup');
-- Закрытие: вид `gap` и причины `transport_switched`, `counts_match`.
SELECT pg_temp.a325_replace('platform.whatsapp_health_resolve_v1(uuid,text,text,text)',
  $old$  IF p_kind IS NULL OR p_kind NOT IN ('disconnected', 'silent')
    OR p_reason IS NULL OR p_reason NOT IN ('working_again', 'messages_arrived', 'reconnected') THEN$old$,
  $new$  IF p_kind IS NULL OR p_kind NOT IN ('disconnected', 'silent', 'gap')
    OR p_reason IS NULL OR p_reason NOT IN ('working_again', 'messages_arrived', 'reconnected', 'transport_switched', 'counts_match') THEN$new$,
  1, 'transport_switched');

-- Слова задачи для Wazzup. Для `crm_primary` - прежние (title/text 321). Номеров клиентов и телефона продаж в тексте нет.
CREATE FUNCTION platform_private.whatsapp_alert_title_for(p_session TEXT, p_kind TEXT, p_status TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_session IS DISTINCT FROM 'wazzup' THEN platform_private.whatsapp_health_title(p_kind, p_status)
    WHEN p_kind = 'gap' THEN 'В EVO меньше входящих WhatsApp, чем в amoCRM — проверьте приём'
    WHEN p_kind = 'silent' THEN 'WhatsApp через Wazzup молчит 3 часа в рабочее время — проверьте подключение'
    WHEN p_status IN ('KEY_REJECTED', 'UNREACHABLE', 'CHANNEL_MISSING')
      THEN 'WhatsApp через Wazzup не на связи — проверьте подключение и сообщите техническому администратору'
    ELSE 'WhatsApp через Wazzup отключён — проверьте канал'
  END
$$;
CREATE FUNCTION platform_private.whatsapp_alert_text_for(p_session TEXT, p_kind TEXT, p_status TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_session IS DISTINCT FROM 'wazzup' THEN platform_private.whatsapp_health_text(p_kind, p_status)
    WHEN p_kind = 'gap' THEN
      'Суточная сверка: входящих сообщений WhatsApp в EVO за прошлые сутки меньше, чем у Wazzup в amoCRM. Часть сообщений '
      || 'могла не дойти до EVO (выпуск приложения, ошибка у Wazzup). Проверьте «Продажи → WhatsApp» и сообщите техническому '
      || 'администратору. Задача закроется сама, когда следующая сверка сойдётся.'
    WHEN p_kind = 'silent' THEN
      'Канал WhatsApp продаж в Wazzup показывает «работает», но входящих сообщений от клиентов в EVO нет уже 3 рабочих часа '
      || '(рабочее время: пн–сб, 10:00–20:00 по Бишкеку). Проверьте кабинет Wazzup → «Каналы» и напишите на номер отдела '
      || 'продаж с другого телефона: сообщение должно появиться в EVO. Если нет — сообщите техническому администратору '
      || '(возможно, Wazzup перестал присылать сообщения в EVO). Задача закроется сама, когда придёт сообщение.'
    ELSE
      'WhatsApp продаж через Wazzup не работает уже больше 10 минут (' || CASE p_status
        WHEN 'PHONE_UNAVAILABLE' THEN 'телефон продаж не на связи: выключен или без сети'
        WHEN 'SCAN_QR_CODE' THEN 'нужно заново отсканировать QR-код'
        WHEN 'OPEN_ELSEWHERE' THEN 'WhatsApp открыт на другом устройстве'
        WHEN 'NOT_PAID' THEN 'канал не оплачен в Wazzup'
        WHEN 'UNAUTHORIZED' THEN 'WhatsApp отвязан от канала, номер нужно подключить заново'
        WHEN 'DISABLED' THEN 'канал выключен в Wazzup'
        WHEN 'FOREIGN_PHONE' THEN 'подключён другой телефон'
        WHEN 'WAIT_FOR_PASSWORD' THEN 'WhatsApp ждёт пароль двухэтапной проверки'
        WHEN 'BLOCKED' THEN 'канал заблокирован'
        WHEN 'ON_MODERATION' THEN 'канал на модерации'
        WHEN 'REJECTED' THEN 'канал отклонён'
        WHEN 'STARTING' THEN 'канал запускается'
        WHEN 'CHANNEL_MISSING' THEN 'канал не найден в Wazzup'
        WHEN 'KEY_REJECTED' THEN 'Wazzup не принял ключ доступа CRM'
        WHEN 'UNREACHABLE' THEN 'сервис Wazzup не отвечает'
        ELSE 'состояние канала: ' || p_status END
      || '). Пока канал не работает, сообщения клиентов в CRM не приходят. Откройте кабинет Wazzup → «Каналы»: нет связи с '
      || 'телефоном — телефон продаж должен быть включён и в сети; нужен QR — отсканируйте его в кабинете Wazzup телефоном '
      || 'продаж; канал не оплачен — продлите тариф. Если причина в доступе CRM к Wazzup, сообщите техническому '
      || 'администратору. Задача закроется сама, когда канал заработает.'
  END
$$;

-- Задача берёт слова по сессии своей тревоги.
SELECT pg_temp.a325_replace('platform_private.whatsapp_health_make_task(uuid,uuid,uuid,text,text)',
  $old$  v_payload JSONB; v_result JSONB; v_event UUID;
BEGIN$old$,
  $new$  v_payload JSONB; v_result JSONB; v_event UUID; v_session TEXT;
BEGIN$new$, 1, 'v_session');
SELECT pg_temp.a325_replace('platform_private.whatsapp_health_make_task(uuid,uuid,uuid,text,text)',
  $old$  v_req := platform_private.p3c_request_child_id(p_alert_id, 'whatsapp-health-task:' || p_membership_id::TEXT);
$old$,
  $new$  SELECT a.session_name INTO v_session FROM platform_private.whatsapp_health_alerts a WHERE a.id = p_alert_id;
  v_req := platform_private.p3c_request_child_id(p_alert_id, 'whatsapp-health-task:' || p_membership_id::TEXT);
$new$, 1, NULL);
SELECT pg_temp.a325_replace('platform_private.whatsapp_health_make_task(uuid,uuid,uuid,text,text)',
  $old$platform_private.whatsapp_health_title(p_kind, p_status)$old$,
  $new$platform_private.whatsapp_alert_title_for(v_session, p_kind, p_status)$new$, 1, NULL);
SELECT pg_temp.a325_replace('platform_private.whatsapp_health_make_task(uuid,uuid,uuid,text,text)',
  $old$platform_private.whatsapp_health_text(p_kind, p_status)$old$,
  $new$platform_private.whatsapp_alert_text_for(v_session, p_kind, p_status)$new$, 1, NULL);
SELECT pg_temp.a325_replace('platform_private.whatsapp_health_make_task(uuid,uuid,uuid,text,text)',
  $old$CASE WHEN p_kind = 'silent' THEN 'high'::platform.case_task_priority$old$,
  $new$CASE WHEN p_kind IN ('silent', 'gap') THEN 'high'::platform.case_task_priority$new$, 1, NULL);

-- ---------------------------------------------------------------------------
-- 14. Имя и номер в списке чатов (278) для бесед Wazzup: тот же внешний вид и те же права.
-- ---------------------------------------------------------------------------

-- Имя из профиля Wazzup: последнее входящее с подходящим именем среди 20 последних.
CREATE FUNCTION platform_private.wazzup_push_name(p_organization_id UUID, p_conversation_id UUID, p_digits TEXT)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT named.name
  FROM (
    SELECT m.created_at, m.id, e.raw_payload
    FROM platform.communication_messages m
    JOIN platform_private.provider_webhook_events e
      ON e.organization_id = m.organization_id AND e.id = m.source_webhook_event_id
    WHERE m.organization_id = p_organization_id AND m.conversation_id = p_conversation_id AND m.direction = 'inbound'
      AND e.provider = 'wazzup' AND e.verification_status = 'verified' AND e.event_type = 'message'
    ORDER BY m.created_at DESC, m.id DESC LIMIT 20
  ) AS recent
  CROSS JOIN LATERAL (SELECT platform_private.wazzup_contact_name(recent.raw_payload, p_digits) AS name) AS named
  WHERE named.name IS NOT NULL
  ORDER BY recent.created_at DESC, recent.id DESC
  LIMIT 1
$$;

CREATE FUNCTION platform_private.wazzup_conversation_contact(p_organization_id UUID, p_conversation_id UUID)
RETURNS TABLE (contact_name TEXT, contact_phone TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  conversation platform.communication_conversations%ROWTYPE; v_digits TEXT; v_client_name TEXT; v_client_digits TEXT;
BEGIN
  SELECT c.* INTO conversation FROM platform.communication_conversations c
  WHERE c.organization_id = p_organization_id AND c.id = p_conversation_id;
  IF conversation.id IS NULL OR conversation.wazzup_channel_id IS NULL
    OR NOT platform_private.waha_generated_conversation_subject(conversation.subject, conversation.id) THEN
    RETURN;
  END IF;
  SELECT b.chat_digits INTO v_digits FROM platform_private.wazzup_chat_bindings b
  WHERE b.organization_id = p_organization_id AND b.conversation_id = p_conversation_id;
  IF v_digits IS NULL OR (conversation.subject ~ '^WhatsApp ••••[0-9]{4}$' AND right(v_digits, 4) <> right(conversation.subject, 4)) THEN
    RETURN;
  END IF;
  SELECT btrim(cl.display_name), NULLIF(regexp_replace(COALESCE(cl.normalized_phone, ''), '[^0-9]', '', 'g'), '')
  INTO v_client_name, v_client_digits
  FROM platform.clients cl WHERE cl.organization_id = p_organization_id AND cl.id = conversation.canonical_client_id;
  -- Введённое или перенесённое имя клиента - только тому, кто вправе читать клиента; остальные видят имя из профиля.
  IF v_client_name IS NOT NULL
    AND NOT platform_private.waha_generated_client_name(v_client_name, COALESCE(v_client_digits, v_digits), conversation.subject, conversation.id)
    AND COALESCE(private.platform_can_read_canonical_client(p_organization_id, conversation.canonical_client_id), FALSE) THEN
    contact_name := v_client_name;
  ELSE
    contact_name := platform_private.wazzup_push_name(p_organization_id, p_conversation_id, v_digits);
  END IF;
  contact_phone := platform_private.whatsapp_masked_phone(v_digits);
  RETURN NEXT;
END
$$;

SELECT pg_temp.a325_replace('platform_private.waha_conversation_contact(uuid,uuid)',
  $old$  IF conversation.id IS NULL
    OR conversation.waha_session_name IS NULL
    OR NOT platform_private.waha_generated_conversation_subject($old$,
  $new$  -- 325: беседа Wazzup: номер из привязки чата, имя из профиля Wazzup.
  IF conversation.id IS NOT NULL AND conversation.wazzup_channel_id IS NOT NULL THEN
    RETURN QUERY SELECT w.contact_name, w.contact_phone
    FROM platform_private.wazzup_conversation_contact(p_organization_id, p_conversation_id) AS w;
    RETURN;
  END IF;

  IF conversation.id IS NULL
    OR conversation.waha_session_name IS NULL
    OR NOT platform_private.waha_generated_conversation_subject($new$, 1, 'wazzup_conversation_contact');

-- ---------------------------------------------------------------------------
-- 15. Происхождение Wazzup - служебное свидетельство, как у WAHA (085): прямое чтение таблиц и карточки клиента и лида его
-- не показывают.
-- ---------------------------------------------------------------------------
DROP POLICY external_identifiers_read ON platform.external_identifiers;
CREATE POLICY external_identifiers_read
  ON platform.external_identifiers
  FOR SELECT
  TO authenticated
  USING (
    source_system NOT IN ('waha', 'wazzup')
    AND (
      (client_id IS NOT NULL AND private.platform_can_read_canonical_client(organization_id, client_id))
      OR (lead_id IS NOT NULL AND private.platform_can_read_canonical_lead(organization_id, lead_id))
    )
  );
DROP POLICY subject_provenance_read ON platform.subject_provenance;
CREATE POLICY subject_provenance_read
  ON platform.subject_provenance
  FOR SELECT
  TO authenticated
  USING (
    source_system NOT IN ('waha', 'wazzup')
    AND (
      (client_id IS NOT NULL AND private.platform_can_read_canonical_client(organization_id, client_id))
      OR (lead_id IS NOT NULL AND private.platform_can_read_canonical_lead(organization_id, lead_id))
    )
  );
SELECT pg_temp.a325_replace('platform.staff_canonical_client_detail(uuid)',
  $old$.source_system IS DISTINCT FROM 'waha'$old$, $new$.source_system NOT IN ('waha', 'wazzup')$new$, 2, 'wazzup');
SELECT pg_temp.a325_replace('platform.staff_canonical_lead_detail(uuid)',
  $old$.source_system IS DISTINCT FROM 'waha'$old$, $new$.source_system NOT IN ('waha', 'wazzup')$new$, 2, 'wazzup');

-- ---------------------------------------------------------------------------
-- 16. Чтение для сотрудника (communication.read.full): действующий путь, можно ли отвечать, состояние канала.
-- Ключа, адреса вебхука и номера нет.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.staff_whatsapp_transport_v1(p_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_state platform_private.whatsapp_transport_state; v_channel platform_private.wazzup_channels; v_last TIMESTAMPTZ;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'Organization is required' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM platform_private.require_domain_actor_read(p_organization_id, 'communication.read.full');
  SELECT * INTO v_state FROM platform_private.whatsapp_transport_state s WHERE s.organization_id = p_organization_id;
  SELECT * INTO v_channel FROM platform_private.wazzup_channels c WHERE c.organization_id = p_organization_id;
  IF COALESCE(v_state.active_transport, 'none') = 'wazzup' THEN
    SELECT max(e.received_at) INTO v_last FROM platform_private.provider_webhook_events e
    WHERE e.organization_id = p_organization_id AND e.provider = 'wazzup' AND e.event_type = 'message'
      AND e.verification_status = 'verified' AND e.received_at >= clock_timestamp() - INTERVAL '30 days'
      AND e.raw_payload ->> 'isEcho' = 'false';
  END IF;
  RETURN jsonb_build_object(
    'activeTransport', COALESCE(v_state.active_transport, 'none'),
    'canReply', COALESCE(v_state.active_transport, 'none') <> 'wazzup',
    'replyMode', CASE WHEN COALESCE(v_state.active_transport, 'none') = 'wazzup' THEN 'receive_only' ELSE 'waha' END,
    'channel', CASE WHEN v_channel.organization_id IS NULL THEN NULL ELSE jsonb_build_object(
      'transport', v_channel.transport, 'state', v_channel.state, 'observedAt', v_channel.observed_at) END,
    'lastInboundAt', v_last);
END
$$;

DROP FUNCTION pg_temp.a325_replace(TEXT, TEXT, TEXT, INTEGER, TEXT);

-- ---------------------------------------------------------------------------
-- Права: помощники - никому; функции записи, проекции и команд - service_role; чтение для сотрудника - authenticated.
-- Заменённые функции сохраняют прежние права (CREATE OR REPLACE их не меняет).
-- ---------------------------------------------------------------------------
DO $wz325_acl$
DECLARE f REGPROCEDURE;
BEGIN
  FOR f IN SELECT p.oid::REGPROCEDURE FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform_private'
      AND (p.proname LIKE 'wazzup\_%' OR p.proname IN ('whatsapp_send_allowed', 'whatsapp_gemini_allowed',
        'whatsapp_intake_direct_case_match', 'whatsapp_intake_phone_match', 'acquire_wazzup_canonical_identity',
        'require_private_wazzup_message_binding', 'whatsapp_alert_title_for', 'whatsapp_alert_text_for')) LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent', f);
  END LOOP;
  FOR f IN SELECT p.oid::REGPROCEDURE FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform' AND (p.proname LIKE 'wazzup\_%\_v1' OR p.proname = 'whatsapp_transport_configure_v1') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END
$wz325_acl$;
REVOKE ALL ON FUNCTION platform.staff_whatsapp_transport_v1(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
GRANT EXECUTE ON FUNCTION platform.staff_whatsapp_transport_v1(UUID) TO authenticated;

COMMENT ON FUNCTION platform.wazzup_webhook_persist_v1(UUID, TEXT, TEXT, JSONB, JSONB) IS
  '325: service-only; stores up to 100 Wazzup webhook elements, each in its own subtransaction, idempotent by message id (variant = SHA-256 of the element for edits, deletions and channel states); writes nothing unless the active transport is wazzup.';
COMMENT ON FUNCTION platform.wazzup_project_event_v1(UUID, UUID, UUID, UUID) IS
  '325: service-only; projects one stored Wazzup event into the shared conversations (identity: student by rule 316, phone match, new client without a lead); failures are recorded with a code and an attempt count.';
COMMENT ON FUNCTION platform.wazzup_projection_sweep_v1(UUID, UUID, INTEGER) IS
  '325: service-only; projects the oldest pending or failed Wazzup events (at most 8 attempts each) and reports the age of the oldest unprocessed one.';
COMMENT ON FUNCTION platform.whatsapp_transport_configure_v1(UUID, TEXT, BOOLEAN, BOOLEAN, UUID) IS
  '325: service-only; sets the active WhatsApp transport and the AI trigger / Gemini switches without a release; switching to wazzup closes the open crm_primary alerts (transport_switched).';
COMMENT ON FUNCTION platform_private.whatsapp_send_allowed(UUID, UUID) IS
  '325: the one send gate of the six WhatsApp send paths: false while the active transport is wazzup or the conversation came through Wazzup.';
COMMENT ON FUNCTION platform_private.whatsapp_gemini_allowed(UUID, UUID) IS
  '325: the Gemini gate: false for a Wazzup conversation until the owner has allowed Gemini for Wazzup chats.';

-- ---------------------------------------------------------------------------
-- Самопроверка: таблицы закрыты; права и определитель новых функций; заменённые функции сохранили атрибуты и действительно
-- изменились; ворота стоят в шести путях отправки и шести путях Gemini; семейства инструментов не выросли.
-- ---------------------------------------------------------------------------
DO $a325_verify$
DECLARE f REGPROCEDURE; p pg_catalog.pg_proc%ROWTYPE; t REGCLASS; b RECORD;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'platform_private.wazzup_channels'::REGCLASS, 'platform_private.wazzup_chat_bindings'::REGCLASS,
    'platform_private.wazzup_message_bindings'::REGCLASS, 'platform_private.wazzup_event_projections'::REGCLASS,
    'platform_private.wazzup_daily_counters'::REGCLASS, 'platform_private.whatsapp_transport_state'::REGCLASS,
    'platform_private.wazzup_api_key_bindings'::REGCLASS, 'platform_private.wazzup_operator_events'::REGCLASS] LOOP
    IF NOT (SELECT c.relrowsecurity AND c.relforcerowsecurity FROM pg_catalog.pg_class c WHERE c.oid = t)
      OR has_table_privilege('anon', t, 'SELECT,INSERT,UPDATE,DELETE')
      OR has_table_privilege('authenticated', t, 'SELECT,INSERT,UPDATE,DELETE')
      OR has_table_privilege('service_role', t, 'SELECT,INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'a325_verify_table: %', t USING ERRCODE = '55000';
    END IF;
  END LOOP;
  -- Девять функций service_role: определитель, пустой search_path, EXECUTE только у service_role.
  IF (SELECT count(*) FROM pg_catalog.pg_proc x JOIN pg_catalog.pg_namespace n ON n.oid = x.pronamespace
      WHERE n.nspname = 'platform' AND (x.proname LIKE 'wazzup\_%\_v1' OR x.proname = 'whatsapp_transport_configure_v1')) <> 9 THEN
    RAISE EXCEPTION 'a325_verify_service_count' USING ERRCODE = '55000';
  END IF;
  FOR f IN SELECT x.oid::REGPROCEDURE FROM pg_catalog.pg_proc x JOIN pg_catalog.pg_namespace n ON n.oid = x.pronamespace
    WHERE n.nspname = 'platform' AND (x.proname LIKE 'wazzup\_%\_v1' OR x.proname = 'whatsapp_transport_configure_v1') LOOP
    SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid = f;
    IF NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
      OR NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
      OR has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
      OR has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE') OR has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')
      OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) THEN
      RAISE EXCEPTION 'a325_verify_service_function: %', f USING ERRCODE = '55000';
    END IF;
  END LOOP;
  SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid = 'platform.staff_whatsapp_transport_v1(uuid)'::REGPROCEDURE;
  IF NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
    OR NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
    OR has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('service_role', p.oid, 'EXECUTE')
    OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) THEN
    RAISE EXCEPTION 'a325_verify_staff_function' USING ERRCODE = '55000';
  END IF;
  -- Помощники: пустой search_path у всех, никому не доступны.
  FOR f IN SELECT x.oid::REGPROCEDURE FROM pg_catalog.pg_proc x JOIN pg_catalog.pg_namespace n ON n.oid = x.pronamespace
    WHERE n.nspname = 'platform_private'
      AND (x.proname LIKE 'wazzup\_%' OR x.proname IN ('whatsapp_send_allowed', 'whatsapp_gemini_allowed',
        'whatsapp_intake_direct_case_match', 'whatsapp_intake_phone_match', 'acquire_wazzup_canonical_identity',
        'require_private_wazzup_message_binding', 'whatsapp_alert_title_for', 'whatsapp_alert_text_for')) LOOP
    SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid = f;
    IF p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
      OR has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
      OR has_function_privilege('service_role', p.oid, 'EXECUTE') OR has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
      OR has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')
      OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) THEN
      RAISE EXCEPTION 'a325_verify_private_function: %', f USING ERRCODE = '55000';
    END IF;
  END LOOP;
  -- Заменённые функции: права, владелец, определитель, изменчивость и search_path прежние; тело действительно новое.
  FOR b IN SELECT * FROM a325_before LOOP
    SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid = b.oid;
    IF p.prosecdef IS DISTINCT FROM b.prosecdef OR p.provolatile IS DISTINCT FROM b.provolatile
      OR p.proconfig IS DISTINCT FROM b.proconfig OR p.proacl::TEXT IS DISTINCT FROM b.acl OR p.proowner IS DISTINCT FROM b.proowner
      OR p.proleakproof IS DISTINCT FROM b.proleakproof OR p.proparallel IS DISTINCT FROM b.proparallel
      OR p.prorettype IS DISTINCT FROM b.prorettype OR p.proretset IS DISTINCT FROM b.proretset
      OR p.pronargdefaults IS DISTINCT FROM b.pronargdefaults THEN
      RAISE EXCEPTION 'a325_verify_attributes: %', b.sig USING ERRCODE = '55000';
    END IF;
    IF md5(p.prosrc) = (SELECT pin.md5sum FROM a325_pins pin WHERE pin.sig = b.sig) THEN
      RAISE EXCEPTION 'a325_verify_unchanged_body: %', b.sig USING ERRCODE = '55000';
    END IF;
  END LOOP;
  -- Ворота отправки в шести путях (захват, ручной ответ, авторизация, отметка, автоответчик, инструмент) и в чтении агентов.
  IF (SELECT count(*) FROM pg_catalog.pg_proc x WHERE x.oid IN (
        'platform.ai_agent_tool_send_message_v1(uuid,text,jsonb)'::REGPROCEDURE,
        'platform.ai_agent_runtime_whatsapp_authorize_v1(uuid,uuid,uuid,text,uuid)'::REGPROCEDURE,
        'platform_private.ai_autosend_check(platform_private.ai_autosend_log,text,text,bigint[])'::REGPROCEDURE,
        'platform.request_manual_whatsapp_send_with_authorization(uuid,uuid,uuid,uuid,text,text,text,uuid)'::REGPROCEDURE,
        'platform.claim_manual_whatsapp_send_item(uuid,uuid,integer,text,uuid)'::REGPROCEDURE,
        'platform.ai_agent_tool_get_conversation_v1(uuid,text,jsonb)'::REGPROCEDURE)
        AND strpos(x.prosrc, 'whatsapp_send_allowed(') > 0) <> 6
    OR strpos((SELECT x.prosrc FROM pg_catalog.pg_proc x
        WHERE x.oid = 'platform.ai_agent_runtime_draft_mark_v1(uuid,uuid,text,text,uuid,jsonb)'::REGPROCEDURE), '''receive_only''') = 0
    OR (SELECT count(*) FROM pg_catalog.pg_proc x WHERE x.oid IN (
        'platform_ai_agent.inbound_since_v1(timestamptz,uuid,integer)'::REGPROCEDURE,
        'platform_private.ai_memory_poke(uuid,boolean,integer)'::REGPROCEDURE,
        'platform_ai_agent.memory_context_v1(uuid,text,integer)'::REGPROCEDURE,
        'platform_ai_agent.autosend_summary_context_v1(uuid,text,integer)'::REGPROCEDURE,
        'platform.ai_agent_ticket_v1(uuid,text,uuid,uuid)'::REGPROCEDURE,
        'platform_private.ai_ticket_allowed(platform_private.ai_tickets)'::REGPROCEDURE,
        'platform.request_gemini_proposal(uuid,uuid,uuid,uuid,text,integer,text,text)'::REGPROCEDURE,
        'platform.begin_gemini_proposal(uuid,uuid,uuid,uuid,text,integer,text)'::REGPROCEDURE,
        'platform_private.ai_autosend_check(platform_private.ai_autosend_log,text,text,bigint[])'::REGPROCEDURE)
        AND strpos(x.prosrc, 'whatsapp_gemini_allowed(') > 0) <> 9
    OR strpos((SELECT x.prosrc FROM pg_catalog.pg_proc x
        WHERE x.oid = 'platform.ai_agent_tool_list_conversations_v1(uuid,text,jsonb)'::REGPROCEDURE), 'wazzup_conversation_unresolved(') = 0
    OR strpos((SELECT x.prosrc FROM pg_catalog.pg_proc x
        WHERE x.oid = 'platform.ai_agent_tool_get_conversation_v1(uuid,text,jsonb)'::REGPROCEDURE), 'wazzup_message_deleted(') = 0
    OR platform_private.ai_autosend_reason_ru('receive_only') <> 'WhatsApp подключён только на чтение'
  THEN
    RAISE EXCEPTION 'a325_verify_gates' USING ERRCODE = '55000';
  END IF;
  -- Семейство инструментов и MCP не выросло: 24 инструмента, 3 функции MCP (права сохранены).
  IF (SELECT count(*) FROM pg_catalog.pg_proc x WHERE x.pronamespace = 'platform'::REGNAMESPACE AND x.proname LIKE 'ai\_agent\_tool\_%'
        AND x.prosecdef AND has_function_privilege('service_role', x.oid, 'EXECUTE')
        AND NOT has_function_privilege('authenticated', x.oid, 'EXECUTE')) <> 24
    OR (SELECT count(*) FROM pg_catalog.pg_proc x WHERE x.pronamespace = 'platform'::REGNAMESPACE AND x.proname LIKE 'ai\_agent\_mcp\_%'
        AND x.prosecdef AND has_function_privilege('service_role', x.oid, 'EXECUTE')
        AND NOT has_function_privilege('authenticated', x.oid, 'EXECUTE')) <> 3
  THEN
    RAISE EXCEPTION 'a325_verify_counts' USING ERRCODE = '55000';
  END IF;
  -- 321: сессии, вид и причины; происхождение Wazzup скрыто; беседа ровно с одним транспортом.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid = 'platform_private.whatsapp_health_alerts'::REGCLASS
        AND c.conname = 'whatsapp_health_alerts_kind_check' AND pg_get_constraintdef(c.oid) LIKE '%gap%')
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid = 'platform_private.whatsapp_health_alerts'::REGCLASS
        AND c.conname = 'whatsapp_health_alerts_resolved_check' AND pg_get_constraintdef(c.oid) LIKE '%counts_match%')
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy x WHERE x.polrelid = 'platform.subject_provenance'::REGCLASS
        AND pg_get_expr(x.polqual, x.polrelid) LIKE '%wazzup%')
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy x WHERE x.polrelid = 'platform.external_identifiers'::REGCLASS
        AND pg_get_expr(x.polqual, x.polrelid) LIKE '%wazzup%')
    OR EXISTS (SELECT 1 FROM platform.communication_conversations c WHERE c.wazzup_channel_id IS NOT NULL AND c.waha_session_name IS NOT NULL)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid = 'platform.communication_conversations'::REGCLASS
        AND t.tgname = 'communication_conversations_identity_immutable' AND pg_get_triggerdef(t.oid) LIKE '%''wazzup_channel_id''%')
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid = 'platform.communication_messages'::REGCLASS
        AND t.tgname = 'communication_messages_private_wazzup_binding' AND t.tgdeferrable AND t.tginitdeferred)
  THEN
    RAISE EXCEPTION 'a325_verify_health_and_model' USING ERRCODE = '55000';
  END IF;
END
$a325_verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
