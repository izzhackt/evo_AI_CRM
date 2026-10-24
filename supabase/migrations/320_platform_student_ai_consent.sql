-- 320 «Согласие студента на ИИ-помощников» (решение владельца 25.10.2026: «добавь согласие на ИИ, оставь оговорку,
-- номер 0770»; docs/PLAN_CHANGES.md «2026-10-25 · Согласие студента на ИИ-помощников, база данных (миграция 320)»,
-- ADR 0035 «Последствия: Политика и согласие», контракт docs/design/ai-agents/contract.md §A.9). Номер 320: на origin/main
-- последняя 319; хуки набора и журнала привязаны к имени файла, не к номеру.
--
-- Зачем. ИИ-помощники EVO (Claude Managed Agents, Anthropic, США) читают переписку студента и файлы его дела
-- (в том числе сканы паспортов); Gemini-помощник (Google) читает чаты WhatsApp продаж, память и ночной автоответчик
-- берут из них тексты, распознавание документов грузит файлы дела в Google. Правило Apple 5.1.2(i) требует явного
-- разрешения в приложении, прежде чем личные данные уйдут стороннему ИИ. Эта миграция — база данных части
-- «согласие»: решение студента, его чтение в CRM и запрет читать то, чего студент не разрешил, для КАЖДОГО пути ИИ,
-- которым база отдаёт переписку или файлы: обещание студенту «если не разрешите, помощники не будут читать ваши
-- документы и переписку» верно и для Claude, и для Gemini (решение владельца 25.10.2026).
--
-- Что закрыто запретом (все пути к стороннему ИИ, которым база отдаёт переписку или файлы студента):
--   1) инструменты агентов Claude (e);
--   2) Gemini-помощник в чате продаж, P1 (h): билет `ai_agent_ticket_v1` не выдаётся, выданный билет перестаёт
--      погашаться и читать контекст, поиск и ответ идут через тот же билет;
--   3) память Gemini-разговоров, P3 (h): сводка и интерес не ставятся в очередь, взятое в работу снимается без чтения
--      текстов, записанный результат отклоняется; блок «Что ИИ знает о клиенте» говорит причину, записанное раньше
--      остаётся видимым и его можно забыть (ничего не удаляется);
--   4) ночной автоответчик, P4 (h): решение пропускается с причиной `ai_consent_missing` на всех стадиях (due, commit,
--      authorize), тексты чата не отдаются, ночная сводка не берёт такие чаты;
--   5) распознавание документов, очередь 162/163 (h): общая проверка исполнителя `document_recognition_require_actor`
--      отказывает `ai_consent_missing` в постановке, захвате, продлении, выдаче файла, передаче и публикации;
--   6) устаревшие предложения Gemini U9 (066): `request_gemini_proposal` (сотрудник) и `begin_gemini_proposal` (сервис,
--      отдаёт текст сообщения). Вызывающего кода в репозитории нет, права остались: путь закрыт, чтобы не оставлять
--      открытого входа.
-- Не закрыто и не закрывается базой: (а) `send_message` не читает переписку; (б) старый `evo-lead-agent` (Python, свой
-- вызов Gemini по вебхуку WAHA, только при EVO_AGENT_AUTOREPLY_ENABLED=true, по умолчанию выключен; в базу Платформы
-- за согласием не ходит) — см. runbook ai-agents-managed.md §10 «Не закрыто».
--
-- Forward-only, ничего не удаляет. Новое: одна таблица, три функции схемы `platform` (две — кабинет студента и iPhone,
-- одна — сотрудник), шесть помощников `platform_private` без грантов, два действия и один тип объекта журнала платформы.
-- Заменяются (каждая привязана к md5 прежнего определения: чужой дрейф останавливает миграцию, ничего не меняя):
-- четыре функции MCP-инструментов (`get_document_file`, `get_case_chat`, `get_conversation`, `list_conversations`),
-- `ai_agent_mcp_file_resolve_v1` и `account_deletion_closure` (280, одно место: список «своих» таблиц аккаунта);
-- по проверенным фрагментам (приём 282, число вхождений обязано совпасть) — тринадцать функций Gemini и
-- распознавания, список в (h).
--
--  a) Таблица `platform_private.student_ai_consents`: ОДНА текущая строка на студента, ключ - организация и вход
--     в Auth (`auth_user_id`) - ровно та личность, которую берёт удаление аккаунта (280: `account_deletion_subject`,
--     не сотрудник; организация из участия студента, иначе из анкеты, иначе из единственной настройки анкеты).
--     Решение: `granted` | `declined`; нет строки - студента не спрашивали. Версия текста политики и источник
--     (`portal_web` | `ios`) хранятся в строке. История - события журнала платформы (только добавление): одно событие
--     на каждое изменение (`ai.consent.grant` / `ai.consent.decline`), без текстов, только состояние и версия.
--  b) Кабинет студента и iPhone (`authenticated`, только о себе, через auth.uid()):
--     `platform.portal_ai_consent_get_v1()` - состояние и версия действующей политики;
--     `platform.portal_ai_consent_set_v1(статус, версия политики, источник, id запроса)` - решение. Повтор того же
--     запроса идемпотентен (по событию журнала с ключом из id запроса), повтор с другим содержимым - конфликт;
--     тот же статус на той же версии - не изменение и не событие; не больше 20 изменений в час на студента (54000).
--     Предел защиты: запомнены только запросы, которые что-то изменили. Запрос без изменения (то же решение на той же
--     версии) не пишет событие и его id не запоминается: его запоздалый повтор после более позднего решения применится
--     как новое решение (разрешил 5001, разрешил 5002 без изменения, отказал 5003, повтор 5002 - снова «разрешил»).
--     Запоминать такие запросы значило бы писать событие или строку на каждый вызов без изменения, а журнал только
--     добавляется; клиент шлёт новый id на каждое нажатие и повторяет прежний только в пределах одной попытки.
--     Неверный статус, источник, версия - 22023.
--  c) Сотрудник: `platform.staff_student_ai_consent_v1(организация, дело)` - `{status, decidedAt, aiAllowed}` для
--     чипа «ИИ: ...» в Student 360. Право то же, что у чтения дела целиком (`case.read.full` на это дело).
--     `status` - как его видит запрет: `granted` только на действующей версии политики, `declined`, иначе null.
--  d) Запрет `platform_private.ai_agent_student_ai_allowed(организация, дело) -> boolean`: false, если студент дела
--     отказал; false, если у него ЕСТЬ кабинет (действующее участие студента) и он не решил (или решил на прежней
--     версии); true - разрешил на действующей версии, либо кабинета нет (основание - договор и политика, правило Apple
--     не применяется). Отказ действует и при выключенном участии. Нет такого дела - false.
--     `platform_private.ai_agent_conversation_ai_allowed(организация, чат)`: чат WhatsApp, связанный с делом студента
--     (по делу, клиенту или лиду; клиент берётся и из самого чата, и из его лида), разрешён, только если разрешены ВСЕ
--     связанные дела; чат без студента разрешён.
--  e) Инструменты агентов. Всё, что отдаёт переписку или файлы дела, перед данными проверяет запрет и отвечает
--     ошибкой `ai_consent_missing` (SQLSTATE 42501, текст ошибки - код): `get_document_file` (ссылка на файл),
--     `get_case_chat` (чат кабинета), `get_conversation` (чат WhatsApp, связанный со студентом). `list_conversations`
--     не падает целиком: у таких чатов `last_text_preview` пуст и стоит `ai_consent_missing: true`.
--     `ai_agent_mcp_file_resolve_v1`: уже выданная ссылка (10 минут) перестаёт работать, когда студент отказал или
--     отозвал согласие. Данные дела без переписки и файлов (имя, этап, сроки, задачи, документы со статусами,
--     заметки сотрудников) остаются доступны. Сами проверки аудита чтения (319) идут после запрета: отказанное
--     чтение не пишет строку «прочитал».
--  f) Удаление аккаунта (280). Строка согласия - данные аккаунта: она добавлена в список «своих» таблиц замыкания
--     `account_deletion_closure` (иначе простой аккаунт со строкой согласия считался бы «не простым» из-за
--     `other_records`), поэтому автоматическое удаление стирает её вместе с событиями журнала о ней, а внешний ключ
--     на `auth.users` с каскадом стирает её и при ручном удалении входа.
--  g) Журнал платформы: действия `ai.consent.grant`, `ai.consent.decline` и тип объекта `student_ai_consent`
--     добавлены приёмом rename-and-union (255, 291, 302, 311, 315, 317). Поля изменений - ветка `ai.%` (`ai_status`).
--  h) Gemini и распознавание (запрет `ai_agent_conversation_ai_allowed` для чата, `ai_agent_student_ai_allowed` для
--     дела; отказ - код `ai_consent_missing`, SQLSTATE 42501, текст ошибки - код). Одно место на путь:
--       P1  `ai_agent_ticket_v1` (цель `answer`, после согласия организации, до лимита билетов) и
--           `ai_ticket_allowed` (его зовут `redeem_ticket_v1` и `ai_redemption`: погашение, `conversation_context_v1`,
--           `search_v1`, `answer_claim_v1`; отказ там - обычное `ai_ticket_invalid` / `ai_redemption_invalid`).
--           `ai_agent_answer_current_v1` отдаёт `studentAiAllowed` и без согласия прячет сохранённый ответ - окно чата
--           честно говорит причину, не пытаясь получить билет.
--       P3  `ai_memory_poke` (все пути постановки: опрос, «Забыть сводку», включение памяти) пропускает чат со
--           статусом `skipped` и причиной; `memory_context_v1` снимает уже стоящее в очереди без чтения текстов
--           (`status: none`, причина); `memory_put_v1` отклоняет запись `ai_consent_missing`; `ai_agent_memory_v1`
--           отдаёт `studentAiAllowed`, `active` и `summaryDue` / `interestDue` ложны, записанное раньше не скрывает.
--       P4  `ai_autosend_check` (стадии due, commit, authorize) возвращает причину `ai_consent_missing` сразу после
--           паузы; её слова - `ai_autosend_reason_ru`; `autosend_summary_context_v1` не берёт такие чаты в ночную
--           сводку для Gemini. `autosend_context_v1`, `autosend_commit_v1`, `ai_autosend_authorize_v1` проверяют
--           через `ai_autosend_check` и меняться не должны.
--       Распознавание документов: `document_recognition_require_actor` (общая для постановки `enqueue_...`, захвата
--           `claim_...`, продления, `grant_..._source`, `seal_..._preflight`, `begin_..._upload`,
--           `begin_..._generation` и публикации предложений) в конце проверяет дело; в захвате отказ - обычный
--           `access_revoked` задания (его ловит `insufficient_privilege`).
--       U9  `request_gemini_proposal` и `begin_gemini_proposal` (066): отказ `ai_consent_missing` до всякой работы.
--     Студент без кабинета (нет действующего участия) и чат без студента не затронуты; слово «разрешено» остаётся
--     правилом `ai_agent_student_ai_allowed`: одно определение на все пути.
--
-- Порядок выката. Миграция без приложения безвредна: старое приложение не знает кода `ai_consent_missing` и покажет
-- отказ инструмента как `forbidden` с `reason_code: ai_consent_missing`, а окно ИИ в чате продаж - «Помощник недоступен
-- в этом чате» вместо точной причины. Приложение без миграции работает: чип в Student 360 не читается (RPC нет) и не
-- рисуется. ВНИМАНИЕ: с этой миграцией ВСЕ ИИ-помощники (Claude и Gemini) перестают читать документы и переписку
-- студентов, у которых есть кабинет, пока те не разрешат; до выкладки карточки согласия в кабинете и на iPhone это
-- значит «чтение закрыто», а не «открыто»: в первую очередь окно ИИ в чатах продаж с такими студентами.
BEGIN;

-- ---------------------------------------------------------------------------
-- Якоря: объекты, на которые опирается миграция; новые имена свободны; md5 шести заменяемых тел.
-- ---------------------------------------------------------------------------
DO $a320_anchor$
DECLARE r RECORD;
BEGIN
  IF to_regclass('platform_private.account_deletion_requests') IS NULL
    OR to_regclass('platform_private.ai_agent_file_grants') IS NULL
    OR to_regclass('platform.student_cases') IS NULL
    OR to_regclass('platform.communication_conversations') IS NULL
    OR to_regprocedure('platform_private.account_deletion_subject(uuid)') IS NULL
    OR to_regprocedure('platform_private.account_deletion_is_staff(uuid)') IS NULL
    OR to_regprocedure('platform_private.account_deletion_closure(uuid,uuid)') IS NULL
    OR to_regprocedure('platform_private.ai_agent_tool_begin(uuid,text,text,jsonb)') IS NULL
    OR to_regprocedure('platform_private.ai_agent_audit_read(uuid,text,text,text,uuid)') IS NULL
    OR to_regprocedure('platform_private.ai_agent_conv_last(uuid,uuid)') IS NULL
    OR to_regprocedure('platform_private.u7_require_case_workspace_actor(uuid)') IS NULL
    OR to_regprocedure('platform_private.require_p2g_service()') IS NULL
    OR to_regprocedure('platform_private.p7a_safe_audit_actions()') IS NULL
    OR to_regprocedure('platform_private.p7a_safe_audit_resource_types()') IS NULL
    OR to_regprocedure('public.uuid_generate_v5(uuid,text)') IS NULL
    OR to_regprocedure('platform.current_actor_authority()') IS NULL
  THEN
    RAISE EXCEPTION 'a320_anchor_drift: the 280 / 317 / 319 objects this migration builds on are missing' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('platform_private.student_ai_consents') IS NOT NULL
    OR to_regprocedure('platform.portal_ai_consent_get_v1()') IS NOT NULL
    OR to_regprocedure('platform.portal_ai_consent_set_v1(text,text,text,uuid)') IS NOT NULL
    OR to_regprocedure('platform.staff_student_ai_consent_v1(uuid,uuid)') IS NOT NULL
    OR to_regprocedure('platform_private.ai_agent_student_ai_allowed(uuid,uuid)') IS NOT NULL
    OR to_regprocedure('platform_private.p7a_safe_audit_actions_pre_student_ai_consent()') IS NOT NULL
    OR to_regprocedure('platform_private.p7a_safe_audit_resource_types_pre_student_ai_consent()') IS NOT NULL
    OR 'ai.consent.grant' = ANY (platform_private.p7a_safe_audit_actions())
    OR 'student_ai_consent' = ANY (platform_private.p7a_safe_audit_resource_types())
  THEN
    RAISE EXCEPTION 'a320_already_applied' USING ERRCODE = '55000';
  END IF;
  -- 280 (замыкание аккаунта), 317 (файл-резолвер и список чатов), 319 (три чтения) и Gemini / распознавание (h):
  -- тела ровно такие, какими их оставили.
  FOR r IN SELECT v.sig, v.md5sum FROM (VALUES
    ('platform_private.account_deletion_closure(uuid,uuid)', '29739e052e572596db47fe0e73c56106'),
    ('platform.ai_agent_mcp_file_resolve_v1(text)', 'a49da6fdd3737f24fe999e7af19e3935'),
    ('platform.ai_agent_tool_list_conversations_v1(uuid,text,jsonb)', 'ef6efb9bd4fcd0326b7ba6a6cd8908db'),
    ('platform.ai_agent_tool_get_document_file_v1(uuid,text,jsonb)', '3fb07bdda8d4ba88558f5aaec06a3b5c'),
    ('platform.ai_agent_tool_get_conversation_v1(uuid,text,jsonb)', 'eec1ce2a63439d77f51bde29cb2b1693'),
    ('platform.ai_agent_tool_get_case_chat_v1(uuid,text,jsonb)', '24507a66519b2cebb7f7e2e6218f140f'),
    -- Gemini и распознавание (h): P1 (269 / 273), P3 (274), P4 (275 / 276), распознавание (162), U9 (066).
    ('platform.ai_agent_ticket_v1(uuid,text,uuid,uuid)', '6440b7d31a1cccf2f386000b10912b1d'),
    ('platform_private.ai_ticket_allowed(platform_private.ai_tickets)', 'b6d943b6ccad5a0a8c93fcdaebd1c813'),
    ('platform.ai_agent_answer_current_v1(uuid,uuid,text)', 'eee83f81181f76a3684cda0cb21fa3b9'),
    ('platform_private.ai_memory_poke(uuid,boolean,integer)', 'c7c7b1d5cabd9808acaa822b75d65975'),
    ('platform_ai_agent.memory_context_v1(uuid,text,integer)', 'cd7693625b160a457169a179986fed46'),
    ('platform_ai_agent.memory_put_v1(uuid,text,bigint,text,text,uuid,integer,uuid,text)', '4e977150154700b3d7f41764eca186c9'),
    ('platform.ai_agent_memory_v1(uuid,uuid)', 'd937a8d35e080acadcabf2d7d76b4215'),
    ('platform_private.ai_autosend_check(platform_private.ai_autosend_log,text,text,bigint[])', '123801297e03793ddca77847110b889a'),
    ('platform_private.ai_autosend_reason_ru(text)', '4af8a034a452aff648f7aa6f1b15c216'),
    ('platform_ai_agent.autosend_summary_context_v1(uuid,text,integer)', '7856539235958a3db904c5814fbc065d'),
    ('platform_private.document_recognition_require_actor(uuid,uuid,uuid,uuid)', 'cf04af37b141f97514b20464d83b3ae1'),
    ('platform.begin_gemini_proposal(uuid,uuid,uuid,uuid,text,integer,text)', 'f468c32bd3881d09b46bdac47959d7f3'),
    ('platform.request_gemini_proposal(uuid,uuid,uuid,uuid,text,integer,text,text)', '6e473c941afdc0c02cc6e85bfe49244b')
  ) AS v(sig, md5sum) LOOP
    IF (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure(r.sig)) IS DISTINCT FROM r.md5sum THEN
      RAISE EXCEPTION 'a320_anchor_drift: % is not the expected definition', r.sig USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$a320_anchor$;

-- ---------------------------------------------------------------------------
-- a) Таблица: одна текущая строка на (организация, вход в Auth). Закрытая: никому из API-ролей, только определители.
-- ---------------------------------------------------------------------------
CREATE TABLE platform_private.student_ai_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  auth_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  source TEXT NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT student_ai_consents_subject_key UNIQUE (organization_id, auth_user_id),
  CONSTRAINT student_ai_consents_status_check CHECK (status IN ('granted', 'declined')),
  CONSTRAINT student_ai_consents_source_check CHECK (source IN ('portal_web', 'ios')),
  CONSTRAINT student_ai_consents_version_check CHECK (policy_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
);
COMMENT ON TABLE platform_private.student_ai_consents IS
  '320: current decision of a student on AI helpers (one row per organization and Auth user); history is in platform.audit_events.';
ALTER TABLE platform_private.student_ai_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.student_ai_consents FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE platform_private.student_ai_consents
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;

-- ---------------------------------------------------------------------------
-- Помощники (platform_private, без грантов).
-- ---------------------------------------------------------------------------

-- Версия действующего текста политики. Новая версия - новая миграция с заменой этой функции: у всех студентов
-- карточка согласия появляется снова, а запрет считает решение на прежней версии «не решено».
CREATE FUNCTION platform_private.student_ai_consent_policy_version()
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT '2026-10-25'::TEXT
$$;

-- Состояние для кабинета, iPhone и тестов; поля пустые - студента не спрашивали.
CREATE FUNCTION platform_private.student_ai_consent_state(p_status TEXT, p_policy_version TEXT, p_decided_at TIMESTAMPTZ)
RETURNS JSONB LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('status', p_status, 'policyVersion', p_policy_version, 'decidedAt', p_decided_at,
    'currentPolicyVersion', platform_private.student_ai_consent_policy_version())
$$;

-- Организация студента-субъекта: та же личность, что у удаления аккаунта (280). NULL - сотрудник, нет такого входа
-- или организации.
CREATE FUNCTION platform_private.student_ai_consent_org(p_auth_user_id UUID)
RETURNS UUID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_org UUID;
BEGIN
  IF p_auth_user_id IS NULL OR platform_private.account_deletion_is_staff(p_auth_user_id) THEN
    RETURN NULL;
  END IF;
  SELECT s.organization_id INTO v_org FROM platform_private.account_deletion_subject(p_auth_user_id) s;
  RETURN v_org;
END
$$;

-- Что известно о согласии студента дела: есть ли у него кабинет (действующее участие студента) и его решение.
-- Нет строки - дела нет.
CREATE FUNCTION platform_private.student_case_ai_consent(p_organization_id UUID, p_student_case_id UUID)
RETURNS TABLE (has_portal BOOLEAN, status TEXT, policy_version TEXT, decided_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (m.id IS NOT NULL AND m.status = 'active' AND m."current_role" = 'student') AS has_portal,
    k.status, k.policy_version, k.decided_at
  FROM platform.student_cases s
  LEFT JOIN platform.organization_memberships m ON m.organization_id = s.organization_id AND m.id = s.student_membership_id
  LEFT JOIN platform.profiles p ON p.id = m.profile_id
  LEFT JOIN platform_private.student_ai_consents k ON k.organization_id = s.organization_id AND k.auth_user_id = p.auth_user_id
  WHERE s.organization_id = p_organization_id AND s.id = p_student_case_id
$$;

-- d) Запрет: можно ли агентам читать документы и переписку студента этого дела.
CREATE FUNCTION platform_private.ai_agent_student_ai_allowed(p_organization_id UUID, p_student_case_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((
    SELECT CASE
      WHEN c.status = 'declined' THEN FALSE
      WHEN c.status = 'granted' AND c.policy_version = platform_private.student_ai_consent_policy_version() THEN TRUE
      WHEN c.has_portal THEN FALSE
      ELSE TRUE
    END
    FROM platform_private.student_case_ai_consent(p_organization_id, p_student_case_id) c), FALSE)
$$;

-- d) То же для чата WhatsApp: все связанные со студентами дела (по делу чата, по клиенту, по лиду клиента) разрешены.
-- Клиент чата - и его собственный `canonical_client_id`, и клиент его лида (чат, связанный только с лидом, достаёт
-- дело, которое знает только клиента этого лида). Чат, не связанный ни с одним делом (обычный лид), разрешён.
-- Нет такого чата - тоже true: вызывающий уже проверил его наличие.
CREATE FUNCTION platform_private.ai_agent_conversation_ai_allowed(p_organization_id UUID, p_conversation_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM platform.communication_conversations cv
    LEFT JOIN platform.leads cl ON cl.organization_id = cv.organization_id AND cl.id = cv.canonical_lead_id
    JOIN platform.student_cases s ON s.organization_id = cv.organization_id
      AND (s.id = cv.student_case_id
        OR s.canonical_client_id IN (cv.canonical_client_id, cl.client_id)
        OR (cv.canonical_lead_id IS NOT NULL AND s.canonical_lead_id = cv.canonical_lead_id)
        OR s.canonical_lead_id IN (
          SELECT l.id FROM platform.leads l WHERE l.organization_id = cv.organization_id
            AND l.client_id IN (cv.canonical_client_id, cl.client_id)))
    WHERE cv.organization_id = p_organization_id AND cv.id = p_conversation_id
      AND NOT platform_private.ai_agent_student_ai_allowed(s.organization_id, s.id))
$$;

-- ---------------------------------------------------------------------------
-- b) Кабинет студента и iPhone: чтение и решение (только о себе).
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.portal_ai_consent_get_v1()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE uid UUID := auth.uid(); v_org UUID; cur platform_private.student_ai_consents;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'ai_consent_unavailable' USING ERRCODE = '42501';
  END IF;
  v_org := platform_private.student_ai_consent_org(uid);
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'ai_consent_unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO cur FROM platform_private.student_ai_consents k WHERE k.organization_id = v_org AND k.auth_user_id = uid;
  RETURN platform_private.student_ai_consent_state(cur.status, cur.policy_version, cur.decided_at);
END
$$;

CREATE FUNCTION platform.portal_ai_consent_set_v1(p_status TEXT, p_policy_version TEXT, p_source TEXT, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  uid UUID := auth.uid();
  v_org UUID;
  cur platform_private.student_ai_consents;
  v_before JSONB;
  v_prior JSONB;
  v_event UUID;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'ai_consent_unavailable' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'ai_consent_invalid_request' USING ERRCODE = '22023';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('granted', 'declined') THEN
    RAISE EXCEPTION 'ai_consent_invalid_status' USING ERRCODE = '22023';
  END IF;
  IF p_source IS NULL OR p_source NOT IN ('portal_web', 'ios') THEN
    RAISE EXCEPTION 'ai_consent_invalid_source' USING ERRCODE = '22023';
  END IF;
  IF p_policy_version IS DISTINCT FROM platform_private.student_ai_consent_policy_version() THEN
    RAISE EXCEPTION 'ai_consent_policy_version_mismatch' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('evo:ai-consent-subject:' || uid::TEXT, 0));
  v_org := platform_private.student_ai_consent_org(uid);
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'ai_consent_unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO cur FROM platform_private.student_ai_consents k
  WHERE k.organization_id = v_org AND k.auth_user_id = uid FOR UPDATE;
  IF FOUND THEN
    -- Повтор запроса: событие журнала с ключом из id запроса уже есть. То же содержимое - прежний итог, иное - конфликт.
    v_event := public.uuid_generate_v5(cur.id, 'ai.consent.set:' || p_request_id::TEXT);
    SELECT e.after_state INTO v_prior FROM platform.audit_events e WHERE e.request_id = v_event;
    IF FOUND THEN
      IF v_prior ->> 'status' = p_status AND v_prior ->> 'policy_version' = p_policy_version AND v_prior ->> 'source' = p_source THEN
        RETURN platform_private.student_ai_consent_state(cur.status, cur.policy_version, cur.decided_at);
      END IF;
      RAISE EXCEPTION 'ai_consent_request_conflict' USING ERRCODE = '55000';
    END IF;
    -- Тот же статус на той же версии - не изменение: ни обновления, ни события.
    IF cur.status = p_status AND cur.policy_version = p_policy_version THEN
      RETURN platform_private.student_ai_consent_state(cur.status, cur.policy_version, cur.decided_at);
    END IF;
    -- Журнал только добавляется: не больше 20 изменений решения одного студента в час (иначе вход с чужим аккаунтом
    -- мог бы бесконечно наращивать журнал).
    IF (SELECT count(*) FROM platform.audit_events e WHERE e.organization_id = cur.organization_id AND e.resource_id = cur.id
        AND e.action LIKE 'ai.consent.%' AND e.created_at > clock_timestamp() - INTERVAL '1 hour') >= 20 THEN
      RAISE EXCEPTION 'ai_consent_rate_limited' USING ERRCODE = '54000';
    END IF;
    v_before := jsonb_build_object('status', cur.status, 'policy_version', cur.policy_version);
    UPDATE platform_private.student_ai_consents k
    SET status = p_status, policy_version = p_policy_version, source = p_source, decided_at = clock_timestamp()
    WHERE k.id = cur.id
    RETURNING * INTO cur;
  ELSE
    INSERT INTO platform_private.student_ai_consents (organization_id, auth_user_id, status, policy_version, source)
    VALUES (v_org, uid, p_status, p_policy_version, p_source)
    RETURNING * INTO cur;
    v_event := public.uuid_generate_v5(cur.id, 'ai.consent.set:' || p_request_id::TEXT);
  END IF;

  -- Событие журнала называет вход в Auth только идентификатором (без внешнего ключа на профиль): состояние и версия,
  -- без текстов. Одно на изменение.
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_principal, action, resource_type, resource_id,
    before_state, after_state, reason, request_id
  ) VALUES (
    cur.organization_id, 'system', 'auth:' || uid::TEXT,
    CASE p_status WHEN 'granted' THEN 'ai.consent.grant' ELSE 'ai.consent.decline' END,
    'student_ai_consent', cur.id, v_before,
    jsonb_build_object('status', cur.status, 'policy_version', cur.policy_version, 'source', cur.source),
    'Student decision on AI helpers', v_event);
  RETURN platform_private.student_ai_consent_state(cur.status, cur.policy_version, cur.decided_at);
END
$$;

-- ---------------------------------------------------------------------------
-- c) Сотрудник: чип «ИИ: ...» в Student 360.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.staff_student_ai_consent_v1(p_organization_id UUID, p_student_case_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c RECORD; v_status TEXT;
BEGIN
  IF p_organization_id IS NULL OR p_student_case_id IS NULL THEN
    RAISE EXCEPTION 'Student case is unavailable' USING ERRCODE = '42501';
  END IF;
  -- case.read.full на этом деле; как у чтения закрытия дела (246).
  IF NOT EXISTS (SELECT 1 FROM platform_private.u7_require_case_workspace_actor(p_student_case_id) w
      WHERE w.organization_id = p_organization_id AND w.platform_role IS DISTINCT FROM 'student') THEN
    RAISE EXCEPTION 'Student case is unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM platform_private.student_case_ai_consent(p_organization_id, p_student_case_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student case is unavailable' USING ERRCODE = '42501';
  END IF;
  v_status := CASE WHEN c.status = 'declined' THEN 'declined'
    WHEN c.status = 'granted' AND c.policy_version = platform_private.student_ai_consent_policy_version() THEN 'granted' END;
  RETURN jsonb_build_object('status', v_status, 'decidedAt', CASE WHEN v_status IS NULL THEN NULL ELSE c.decided_at END,
    'aiAllowed', platform_private.ai_agent_student_ai_allowed(p_organization_id, p_student_case_id));
END
$$;

-- ---------------------------------------------------------------------------
-- e) Функции инструментов (service_role): тела 319 / 317 плюс места, помеченные «320:».
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION platform.ai_agent_tool_get_document_file_v1(p_organization_id UUID, p_agent_key TEXT, p_args JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a platform_private.ai_agents; v_version UUID; v platform.document_versions; b platform_private.document_storage_bindings;
  v_token TEXT; v_ttl INTEGER := 600; v_max_bytes CONSTANT BIGINT := 26214400;
BEGIN
  a := platform_private.ai_agent_tool_begin(p_organization_id, p_agent_key, 'get_document_file', p_args);
  IF (p_args ? 'document_version_id')::INTEGER + (p_args ? 'slot_id')::INTEGER <> 1 THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;
  IF p_args ? 'document_version_id' THEN
    v_version := (p_args ->> 'document_version_id')::UUID;
  ELSE
    SELECT s.current_version_id INTO v_version FROM platform.document_slots s
    WHERE s.organization_id = p_organization_id AND s.id = (p_args ->> 'slot_id')::UUID AND s.removed_at IS NULL;
  END IF;
  SELECT * INTO v FROM platform.document_versions x WHERE x.organization_id = p_organization_id AND x.id = v_version;
  IF NOT FOUND OR v.malware_status::TEXT <> 'clean' THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  -- 320: студент дела не разрешил ИИ-помощников (или не решил, имея кабинет): файл не выдаётся, строки чтения нет.
  IF NOT platform_private.ai_agent_student_ai_allowed(p_organization_id, v.student_case_id) THEN
    RAISE EXCEPTION 'ai_consent_missing' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO b FROM platform_private.document_storage_bindings x
  WHERE x.organization_id = p_organization_id AND x.document_version_id = v.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v.byte_size > v_max_bytes THEN
    RAISE EXCEPTION 'too_large' USING ERRCODE = '54001';
  END IF;
  -- 319: аудит открытия документа в этой же транзакции, до выдачи ссылки; объект - дело версии документа.
  PERFORM platform_private.ai_agent_audit_read(p_organization_id, p_agent_key, 'get_document_file', 'student_case', v.student_case_id);
  v_token := translate(encode(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()), 'base64'), E'+/=\n', '-_');
  v_token := left(v_token, 43);
  INSERT INTO platform_private.ai_agent_file_grants (organization_id, agent_key, token_sha256, document_version_id,
    storage_bucket, storage_path, mime_type, byte_size, file_name, expires_at, max_uses)
  VALUES (p_organization_id, p_agent_key, platform_private.ai_agent_sha256(v_token), v.id, b.bucket_id, b.object_name,
    v.declared_mime_type, v.byte_size, left(v.original_filename, 200), clock_timestamp() + make_interval(secs => v_ttl), 3);
  RETURN jsonb_build_object('token', v_token, 'file_name', left(v.original_filename, 200), 'mime_type', v.declared_mime_type,
    'byte_size', v.byte_size, 'expires_in_seconds', v_ttl);
END
$$;

CREATE OR REPLACE FUNCTION platform.ai_agent_tool_get_conversation_v1(p_organization_id UUID, p_agent_key TEXT, p_args JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a platform_private.ai_agents; cv platform.communication_conversations; v_limit INTEGER; v_ct TIMESTAMPTZ; v_cid UUID;
  v_rows JSONB; v_state TEXT; v_latest UUID; v_items JSONB; v_next TEXT; v_n INTEGER;
BEGIN
  a := platform_private.ai_agent_tool_begin(p_organization_id, p_agent_key, 'get_conversation', p_args);
  SELECT * INTO cv FROM platform.communication_conversations x
  WHERE x.organization_id = p_organization_id AND x.id = (p_args ->> 'conversation_id')::UUID;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  -- 320: чат связан со студентом, который не разрешил ИИ-помощников: переписка не выдаётся, строки чтения нет.
  IF NOT platform_private.ai_agent_conversation_ai_allowed(p_organization_id, cv.id) THEN
    RAISE EXCEPTION 'ai_consent_missing' USING ERRCODE = '42501';
  END IF;
  -- 319: аудит чтения в этой же транзакции, до выдачи данных.
  PERFORM platform_private.ai_agent_audit_read(p_organization_id, p_agent_key, 'get_conversation', 'communication_conversation', cv.id);
  v_limit := COALESCE((p_args ->> 'limit')::INTEGER, 30);
  IF p_args ? 'before' THEN
    SELECT d.t, d.id INTO v_ct, v_cid FROM platform_private.ai_agent_cursor_decode(p_args ->> 'before') d;
  END IF;
  SELECT jsonb_agg(jsonb_build_object('t', m.created_at, 'id', m.id, 'item', jsonb_build_object(
      'id', m.id, 'at', m.created_at, 'direction', m.direction::TEXT, 'origin', platform_private.ai_agent_message_origin(m),
      'text', left(COALESCE(platform_private.ai_message_view(m) ->> 'text', ''), 2000),
      'media_kind', (platform_private.ai_message_view(m) -> 'media' -> 0 ->> 'kind'))) ORDER BY m.created_at DESC, m.id DESC)
  INTO v_rows
  FROM (SELECT x.* FROM platform.communication_messages x
    WHERE x.organization_id = p_organization_id AND x.conversation_id = cv.id
      AND (v_ct IS NULL OR (x.created_at, x.id) < (v_ct, v_cid))
    ORDER BY x.created_at DESC, x.id DESC LIMIT v_limit + 1) m;
  v_n := COALESCE(jsonb_array_length(v_rows), 0);
  IF v_n > v_limit THEN
    v_next := platform_private.ai_agent_cursor_encode((v_rows -> (v_limit - 1) ->> 't')::TIMESTAMPTZ,
      (v_rows -> (v_limit - 1) ->> 'id')::UUID);
  END IF;
  -- Новейшие - внизу.
  SELECT COALESCE(jsonb_agg(e.value -> 'item' ORDER BY e.ord DESC), '[]'::JSONB) INTO v_items
  FROM jsonb_array_elements(COALESCE(v_rows, '[]'::JSONB)) WITH ORDINALITY e(value, ord) WHERE e.ord <= v_limit;
  v_state := platform_private.ai_agent_whatsapp_state(p_organization_id, cv.waha_session_name);
  v_latest := platform_private.ai_latest_inbound(p_organization_id, cv.id);
  RETURN jsonb_build_object(
    'conversation', jsonb_build_object('id', cv.id, 'status', cv.status::TEXT,
      'queue', CASE cv.queue::TEXT WHEN 'curator' THEN 'admissions' ELSE cv.queue::TEXT END,
      'lead_id', cv.canonical_lead_id, 'case_id', cv.student_case_id,
      'contact_name', COALESCE((SELECT c.display_name FROM platform.clients c
        WHERE c.organization_id = cv.organization_id AND c.id = cv.canonical_client_id), left(cv.subject, 120)),
      'whatsapp_state', v_state),
    'messages', v_items,
    'can_reply', cv.status = 'open' AND v_latest IS NOT NULL AND v_state <> 'disconnected',
    'latest_inbound_message_id', v_latest,
    'next_cursor', v_next);
END
$$;

CREATE OR REPLACE FUNCTION platform.ai_agent_tool_get_case_chat_v1(p_organization_id UUID, p_agent_key TEXT, p_args JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a platform_private.ai_agents; s platform.student_cases; v_limit INTEGER; v_ct TIMESTAMPTZ; v_cid UUID;
  v_rows JSONB; v_items JSONB; v_next TEXT; v_n INTEGER;
BEGIN
  a := platform_private.ai_agent_tool_begin(p_organization_id, p_agent_key, 'get_case_chat', p_args);
  SELECT * INTO s FROM platform.student_cases x WHERE x.organization_id = p_organization_id AND x.id = (p_args ->> 'case_id')::UUID;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  -- 320: студент дела не разрешил ИИ-помощников (или не решил, имея кабинет): чат не выдаётся, строки чтения нет.
  IF NOT platform_private.ai_agent_student_ai_allowed(p_organization_id, s.id) THEN
    RAISE EXCEPTION 'ai_consent_missing' USING ERRCODE = '42501';
  END IF;
  -- 319: аудит чтения в этой же транзакции, до выдачи данных.
  PERFORM platform_private.ai_agent_audit_read(p_organization_id, p_agent_key, 'get_case_chat', 'student_case', s.id);
  v_limit := COALESCE((p_args ->> 'limit')::INTEGER, 30);
  IF p_args ? 'before' THEN
    SELECT d.t, d.id INTO v_ct, v_cid FROM platform_private.ai_agent_cursor_decode(p_args ->> 'before') d;
  END IF;
  SELECT jsonb_agg(jsonb_build_object('t', m.created_at, 'id', m.id, 'item', jsonb_build_object(
      'id', m.id, 'at', m.created_at,
      'author', CASE WHEN m.author_membership_id IS NOT DISTINCT FROM s.student_membership_id THEN 'student'
        WHEN EXISTS (SELECT 1 FROM platform_private.ai_agent_drafts d WHERE d.organization_id = m.organization_id
          AND d.student_case_id = m.student_case_id AND d.provider ->> 'messageId' = m.id::TEXT) THEN 'ai_agent'
        ELSE 'staff' END,
      'author_name', platform_private.ai_agent_member_name(m.organization_id, m.author_membership_id),
      'text', left(m.body, 2000))) ORDER BY m.created_at DESC, m.id DESC)
  INTO v_rows
  FROM (SELECT x.* FROM platform.case_chat_messages x
    WHERE x.organization_id = p_organization_id AND x.student_case_id = s.id
      AND (v_ct IS NULL OR (x.created_at, x.id) < (v_ct, v_cid))
    ORDER BY x.created_at DESC, x.id DESC LIMIT v_limit + 1) m;
  v_n := COALESCE(jsonb_array_length(v_rows), 0);
  IF v_n > v_limit THEN
    v_next := platform_private.ai_agent_cursor_encode((v_rows -> (v_limit - 1) ->> 't')::TIMESTAMPTZ,
      (v_rows -> (v_limit - 1) ->> 'id')::UUID);
  END IF;
  SELECT COALESCE(jsonb_agg(e.value -> 'item' ORDER BY e.ord DESC), '[]'::JSONB) INTO v_items
  FROM jsonb_array_elements(COALESCE(v_rows, '[]'::JSONB)) WITH ORDINALITY e(value, ord) WHERE e.ord <= v_limit;
  RETURN jsonb_build_object('messages', v_items, 'next_cursor', v_next);
END
$$;

-- 320: список чатов не падает целиком. У чата студента, не разрешившего ИИ-помощников, нет предпросмотра текста
-- последнего сообщения, а в элементе стоит `ai_consent_missing: true`; остальные поля (время, направление, статус) те же.
CREATE OR REPLACE FUNCTION platform.ai_agent_tool_list_conversations_v1(p_organization_id UUID, p_agent_key TEXT, p_args JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a platform_private.ai_agents; v_limit INTEGER; v_ct TIMESTAMPTZ; v_cid UUID; v_rows JSONB;
  v_filter TEXT := COALESCE(p_args ->> 'filter', 'unanswered'); v_queue TEXT := COALESCE(p_args ->> 'queue', 'sales');
  v_queue_enum TEXT;
BEGIN
  a := platform_private.ai_agent_tool_begin(p_organization_id, p_agent_key, 'list_conversations', p_args);
  v_limit := COALESCE((p_args ->> 'limit')::INTEGER, 20);
  v_queue_enum := CASE v_queue WHEN 'sales' THEN 'sales' WHEN 'admissions' THEN 'curator' ELSE NULL END;
  IF p_args ? 'cursor' THEN
    SELECT d.t, d.id INTO v_ct, v_cid FROM platform_private.ai_agent_cursor_decode(p_args ->> 'cursor') d;
  END IF;
  SELECT jsonb_agg(jsonb_build_object('t', q.last_at, 'id', q.id, 'item', jsonb_build_object(
      'conversation_id', q.id, 'lead_id', q.canonical_lead_id, 'case_id', q.student_case_id,
      'contact_name', COALESCE((SELECT c.display_name FROM platform.clients c
        WHERE c.organization_id = q.organization_id AND c.id = q.canonical_client_id), left(q.subject, 120)),
      'status', q.status::TEXT, 'queue', CASE q.queue::TEXT WHEN 'curator' THEN 'admissions' ELSE q.queue::TEXT END,
      'last_message_at', q.last_at, 'last_direction', q.last_dir,
      'last_text_preview', CASE WHEN platform_private.ai_agent_conversation_ai_allowed(q.organization_id, q.id)
        THEN left(q.last_body, 200) END,
      'unanswered_minutes', CASE WHEN q.last_dir = 'inbound' THEN floor(extract(epoch FROM clock_timestamp() - q.last_at) / 60)::INTEGER END,
      'staff_last_replied_at', (SELECT max(m.created_at) FROM platform.communication_messages m
        WHERE m.organization_id = q.organization_id AND m.conversation_id = q.id AND m.direction = 'outbound'))
      || CASE WHEN platform_private.ai_agent_conversation_ai_allowed(q.organization_id, q.id) THEN '{}'::JSONB
        ELSE jsonb_build_object('ai_consent_missing', TRUE) END
    ) ORDER BY q.last_at DESC, q.id DESC)
  INTO v_rows
  FROM (SELECT cv.*, lm.at AS last_at, lm.direction AS last_dir, lm.body AS last_body
    FROM platform.communication_conversations cv
    CROSS JOIN LATERAL platform_private.ai_agent_conv_last(cv.organization_id, cv.id) lm
    WHERE cv.organization_id = p_organization_id
      AND (v_queue_enum IS NULL OR cv.queue::TEXT = v_queue_enum)
      AND (v_filter = 'all'
        OR (v_filter = 'unanswered' AND cv.status = 'open' AND lm.direction = 'inbound')
        OR (v_filter = 'recent' AND lm.at >= clock_timestamp() - INTERVAL '7 days'))
      AND (v_ct IS NULL OR (lm.at, cv.id) < (v_ct, v_cid))
    ORDER BY lm.at DESC, cv.id DESC LIMIT v_limit + 1) q;
  RETURN platform_private.ai_agent_page_result(v_rows, v_limit);
END
$$;

-- 320: ссылка на файл, выданная до отказа студента, перестаёт работать (10 минут жизни ссылки, 3 скачивания).
-- Отказ откатывает и счётчик использований.
CREATE OR REPLACE FUNCTION platform.ai_agent_mcp_file_resolve_v1(p_token_sha256 TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE g platform_private.ai_agent_file_grants;
BEGIN
  PERFORM platform_private.require_p2g_service();
  IF p_token_sha256 IS NULL OR p_token_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  UPDATE platform_private.ai_agent_file_grants x SET used_count = x.used_count + 1
  WHERE x.token_sha256 = p_token_sha256 AND x.expires_at > clock_timestamp() AND x.used_count < x.max_uses
  RETURNING * INTO g;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT platform_private.ai_agent_student_ai_allowed(g.organization_id, (SELECT v.student_case_id
      FROM platform.document_versions v WHERE v.organization_id = g.organization_id AND v.id = g.document_version_id)) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object('bucket', g.storage_bucket, 'path', g.storage_path, 'mimeType', g.mime_type,
    'byteSize', g.byte_size, 'fileName', g.file_name);
END
$$;

-- ---------------------------------------------------------------------------
-- f) Удаление аккаунта: строка согласия - «своя» таблица замыкания (одно место в списке `own` тела 280).
-- ---------------------------------------------------------------------------
DO $a320_closure$
DECLARE
  v_def TEXT := pg_catalog.pg_get_functiondef('platform_private.account_deletion_closure(uuid,uuid)'::regprocedure);
  v_from CONSTANT TEXT := E'''platform.audit_events''];';
  v_to CONSTANT TEXT := E'''platform.audit_events'',\n    ''platform_private.student_ai_consents''];';
BEGIN
  IF (length(v_def) - length(replace(v_def, v_from, ''))) / length(v_from) <> 1
    OR strpos(v_def, 'student_ai_consents') <> 0 THEN
    RAISE EXCEPTION 'a320_anchor_drift: the own-table list of account_deletion_closure is not the 280 one' USING ERRCODE = '55000';
  END IF;
  EXECUTE replace(v_def, v_from, v_to);
END
$a320_closure$;

-- ---------------------------------------------------------------------------
-- h) Gemini и распознавание документов: тот же запрет на каждом пути, которым база отдаёт переписку или файлы студента.
-- Тела меняются заменой проверенных фрагментов (приём 282): каждый фрагмент обязан встретиться ровно столько раз,
-- сколько ожидается, иначе миграция падает, ничего не меняя. CREATE OR REPLACE сохраняет владельца и права
-- (платформенные функции сервиса агента по-прежнему доступны только evo_ai_agent, инструменты - service_role).
-- Отказ везде один: `ai_consent_missing`, SQLSTATE 42501, текст ошибки - код.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.a320_replace(p_signature TEXT, p_old TEXT, p_new TEXT, p_count INTEGER)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE body TEXT; matches INTEGER;
BEGIN
  body := pg_get_functiondef(to_regprocedure(p_signature));
  matches := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  IF body IS NULL OR matches IS DISTINCT FROM p_count OR strpos(body, 'ai_agent_conversation_ai_allowed') <> 0
    OR strpos(body, 'ai_agent_student_ai_allowed') <> 0 THEN
    RAISE EXCEPTION 'a320_replace_drift: % expected %, found %', p_signature, p_count, matches USING ERRCODE = '55000';
  END IF;
  EXECUTE replace(body, p_old, p_new);
END $$;
-- Вторая правка той же функции: исходное определение уже несёт запрет (первая правка), поэтому без проверки на него.
CREATE FUNCTION pg_temp.a320_replace_more(p_signature TEXT, p_old TEXT, p_new TEXT, p_count INTEGER)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE body TEXT; matches INTEGER;
BEGIN
  body := pg_get_functiondef(to_regprocedure(p_signature));
  matches := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  IF body IS NULL OR matches IS DISTINCT FROM p_count THEN
    RAISE EXCEPTION 'a320_replace_drift: % expected %, found %', p_signature, p_count, matches USING ERRCODE = '55000';
  END IF;
  EXECUTE replace(body, p_old, p_new);
END $$;

-- P1. Билет окна «Помочь с ответом» не выдаётся: после проверки согласия организации (PT412, общее состояние
-- важнее) и до лимита билетов (отказ не тратит квоту).
SELECT pg_temp.a320_replace('platform.ai_agent_ticket_v1(uuid,text,uuid,uuid)',
  $old$  PERFORM platform_private.ai_require_consent(platform_private.ai_settings_row(p_organization_id));
$old$,
  $new$  PERFORM platform_private.ai_require_consent(platform_private.ai_settings_row(p_organization_id));
  -- 320: чат связан со студентом, который не разрешил ИИ-помощников: Gemini переписку не получает.
  IF p_purpose = 'answer' AND NOT platform_private.ai_agent_conversation_ai_allowed(p_organization_id, p_conversation_id) THEN
    RAISE EXCEPTION 'ai_consent_missing' USING ERRCODE = '42501';
  END IF;
$new$, 1);

-- P1. Выданный билет (60 секунд до погашения, 5 минут после) перестаёт работать, как только студент отказал:
-- погашение, контекст диалога, поиск и ответ проверяют билет этой функцией.
SELECT pg_temp.a320_replace('platform_private.ai_ticket_allowed(platform_private.ai_tickets)',
  $old$    WHEN 'answer' THEN platform_private.ai_conversation_allowed(p_ticket.organization_id, p_ticket.membership_id,
      p_ticket.conversation_id)
$old$,
  $new$    WHEN 'answer' THEN platform_private.ai_conversation_allowed(p_ticket.organization_id, p_ticket.membership_id,
      p_ticket.conversation_id)
      -- 320: студент чата не разрешил ИИ-помощников.
      AND platform_private.ai_agent_conversation_ai_allowed(p_ticket.organization_id, p_ticket.conversation_id)
$new$, 1);

-- P1. Окно чата узнаёт причину сразу, не пытаясь получить билет: `studentAiAllowed`; сохранённый ответ о чате такого
-- студента окну не отдаётся (его не показывают и не вставляют в поле ответа).
SELECT pg_temp.a320_replace('platform.ai_agent_answer_current_v1(uuid,uuid,text)',
  $old$'consentRecorded', v_settings.gemini_consent_at IS NOT NULL);$old$,
  $new$'consentRecorded', v_settings.gemini_consent_at IS NOT NULL, 'studentAiAllowed', TRUE);$new$, 2);
SELECT pg_temp.a320_replace_more('platform.ai_agent_answer_current_v1(uuid,uuid,text)',
  $old$  SELECT * INTO v_answer FROM platform_private.ai_answers a
$old$,
  $new$  -- 320: студент чата не разрешил ИИ-помощников: ответа в окне нет, причина названа.
  IF NOT platform_private.ai_agent_conversation_ai_allowed(p_organization_id, p_conversation_id) THEN
    RETURN jsonb_build_object('answer', NULL, 'latestInboundMessageId', v_latest, 'lastMessageDirection', v_last_direction,
      'consentRecorded', v_settings.gemini_consent_at IS NOT NULL, 'studentAiAllowed', FALSE);
  END IF;
  SELECT * INTO v_answer FROM platform_private.ai_answers a
$new$, 1);

-- P3. Память: чат студента без согласия не ставится в очередь (опрос, «Забыть сводку» и включение памяти идут через
-- эту функцию), уже стоящее в очереди снимается без чтения текстов, а запись результата отклоняется.
SELECT pg_temp.a320_replace('platform_private.ai_memory_poke(uuid,boolean,integer)',
  $old$    RETURN jsonb_build_object('conversationId', p_conversation_id, 'status', 'skipped');
  END IF;
$old$,
  $new$    RETURN jsonb_build_object('conversationId', p_conversation_id, 'status', 'skipped');
  END IF;
  -- 320: студент чата не разрешил ИИ-помощников: сводка и интерес не собираются.
  IF NOT platform_private.ai_agent_conversation_ai_allowed(
      (SELECT c.organization_id FROM platform.communication_conversations c WHERE c.id = p_conversation_id), p_conversation_id) THEN
    RETURN jsonb_build_object('conversationId', p_conversation_id, 'status', 'skipped', 'reason', 'ai_consent_missing');
  END IF;
$new$, 1);
SELECT pg_temp.a320_replace('platform_ai_agent.memory_context_v1(uuid,text,integer)',
  $old$  IF v_queue <> 'sales' THEN
    RAISE EXCEPTION 'ai_memory_not_sales' USING ERRCODE = '42501';
  END IF;
$old$,
  $new$  IF v_queue <> 'sales' THEN
    RAISE EXCEPTION 'ai_memory_not_sales' USING ERRCODE = '42501';
  END IF;
  -- 320: студент чата не разрешил ИИ-помощников: ничего не читается, указатель и аренда снимаются.
  IF NOT platform_private.ai_agent_conversation_ai_allowed(v_org, p_conversation_id) THEN
    UPDATE platform_private.ai_client_memory m SET enqueued_at = NULL, lease_owner = NULL, lease_expires_at = NULL
    WHERE m.conversation_id = p_conversation_id;
    -- Форма та же, что у «ничего не пора» (status none): рабочий цикл агента её уже знает; причина - сверх неё.
    RETURN jsonb_build_object('status', 'none', 'mode', 'none', 'conversationId', p_conversation_id,
      'version', COALESCE((SELECT m.version FROM platform_private.ai_client_memory m WHERE m.conversation_id = p_conversation_id), 0),
      'reason', 'ai_consent_missing');
  END IF;
$new$, 1);
SELECT pg_temp.a320_replace('platform_ai_agent.memory_put_v1(uuid,text,bigint,text,text,uuid,integer,uuid,text)',
  $old$  IF v_queue IS DISTINCT FROM 'sales' THEN
    RAISE EXCEPTION 'ai_memory_not_sales' USING ERRCODE = '42501';
  END IF;
$old$,
  $new$  IF v_queue IS DISTINCT FROM 'sales' THEN
    RAISE EXCEPTION 'ai_memory_not_sales' USING ERRCODE = '42501';
  END IF;
  -- 320: студент отказал, пока шла сборка: результат не записывается.
  IF NOT platform_private.ai_agent_conversation_ai_allowed(v_memory.organization_id, p_conversation_id) THEN
    RAISE EXCEPTION 'ai_consent_missing' USING ERRCODE = '42501';
  END IF;
$new$, 1);

-- P3. Блок «Что ИИ знает о клиенте»: причина названа (`studentAiAllowed`), память не работает (`active` ложно, сводку
-- не ждут), записанное раньше остаётся видимым и его можно забыть.
SELECT pg_temp.a320_replace('platform.ai_agent_memory_v1(uuid,uuid)',
  $old$DECLARE v_actor RECORD; v_settings platform_private.ai_settings; v_gate BOOLEAN; v_state JSONB;$old$,
  $new$DECLARE v_actor RECORD; v_settings platform_private.ai_settings; v_gate BOOLEAN; v_state JSONB; v_allowed BOOLEAN;$new$, 1);
SELECT pg_temp.a320_replace_more('platform.ai_agent_memory_v1(uuid,uuid)',
  $old$  v_gate := platform_private.ai_memory_gate(p_organization_id);
$old$,
  $new$  v_gate := platform_private.ai_memory_gate(p_organization_id);
  -- 320: студент чата не разрешил ИИ-помощников.
  v_allowed := platform_private.ai_agent_conversation_ai_allowed(p_organization_id, p_conversation_id);
$new$, 1);
SELECT pg_temp.a320_replace_more('platform.ai_agent_memory_v1(uuid,uuid)',
  $old$'consentRecorded', v_settings.gemini_consent_at IS NOT NULL, 'active', v_gate,$old$,
  $new$'consentRecorded', v_settings.gemini_consent_at IS NOT NULL, 'active', v_gate AND v_allowed,
    'studentAiAllowed', v_allowed,$new$, 1);
SELECT pg_temp.a320_replace_more('platform.ai_agent_memory_v1(uuid,uuid)',
  $old$'summaryDue', v_gate AND (v_state ->> 'summaryDue')::BOOLEAN,$old$,
  $new$'summaryDue', v_gate AND v_allowed AND (v_state ->> 'summaryDue')::BOOLEAN,$new$, 1);
SELECT pg_temp.a320_replace_more('platform.ai_agent_memory_v1(uuid,uuid)',
  $old$'interestDue', v_gate AND (v_state ->> 'interestDue')::BOOLEAN,$old$,
  $new$'interestDue', v_gate AND v_allowed AND (v_state ->> 'interestDue')::BOOLEAN,$new$, 1);

-- P4. Ночной автоответчик: причина `ai_consent_missing` на всех стадиях (due, commit, authorize) - после паузы, до
-- чтения чата и текстов; ночная сводка для Gemini не берёт такие чаты. Слова причины - для журнала автоответчика.
SELECT pg_temp.a320_replace('platform_private.ai_autosend_check(platform_private.ai_autosend_log,text,text,bigint[])',
  $old$  IF v_settings.pause_code IS NOT NULL THEN
    RETURN 'paused';
  END IF;
$old$,
  $new$  IF v_settings.pause_code IS NOT NULL THEN
    RETURN 'paused';
  END IF;
  -- 320: студент чата не разрешил ИИ-помощников: автоответчик в этом чате молчит.
  IF NOT platform_private.ai_agent_conversation_ai_allowed(p_log.organization_id, p_log.conversation_id) THEN
    RETURN 'ai_consent_missing';
  END IF;
$new$, 1);
SELECT pg_temp.a320_replace_more('platform_private.ai_autosend_reason_ru(text)',
  $old$    WHEN 'no_consent' THEN 'Нет согласия на передачу текстов в Gemini'
$old$,
  $new$    WHEN 'no_consent' THEN 'Нет согласия на передачу текстов в Gemini'
    WHEN 'ai_consent_missing' THEN 'Студент не дал согласия на ИИ-помощников'
$new$, 1);
SELECT pg_temp.a320_replace('platform_ai_agent.autosend_summary_context_v1(uuid,text,integer)',
  $old$    AND c.id = (e ->> 'conversationId')::UUID AND c.queue = 'sales';$old$,
  $new$    AND c.id = (e ->> 'conversationId')::UUID AND c.queue = 'sales'
    AND platform_private.ai_agent_conversation_ai_allowed(c.organization_id, c.id);$new$, 1);

-- Распознавание документов (162/163): общая проверка исполнителя вызывается при постановке, захвате (отказ там -
-- `access_revoked` задания), продлении аренды, выдаче файла, передаче, подсчёте и публикации предложений. Проверка
-- студента - последняя, после прав сотрудника: тот, у кого прав нет, состояния согласия не узнаёт.
SELECT pg_temp.a320_replace('platform_private.document_recognition_require_actor(uuid,uuid,uuid,uuid)',
  $old$  END LOOP;
END $function$$old$,
  $new$  END LOOP;
  -- 320: студент дела не разрешил ИИ-помощников: файлы дела в Google не уходят.
  IF NOT platform_private.ai_agent_student_ai_allowed(p_org, p_case) THEN
    RAISE EXCEPTION 'ai_consent_missing' USING ERRCODE = '42501';
  END IF;
END $function$$new$, 1);

-- U9 (066): устаревшие предложения Gemini. Отказ до всякой работы, в том числе до повтора сохранённой заявки.
SELECT pg_temp.a320_replace('platform.request_gemini_proposal(uuid,uuid,uuid,uuid,text,integer,text,text)',
  $old$    'ai.draft.request'
  );
$old$,
  $new$    'ai.draft.request'
  );
  -- 320: студент чата не разрешил ИИ-помощников.
  IF NOT platform_private.ai_agent_conversation_ai_allowed(p_organization_id, p_conversation_id) THEN
    RAISE EXCEPTION 'ai_consent_missing' USING ERRCODE = '42501';
  END IF;
$new$, 1);
SELECT pg_temp.a320_replace('platform.begin_gemini_proposal(uuid,uuid,uuid,uuid,text,integer,text)',
  $old$  request_fingerprint := platform_private.ai_memory_json_sha256($old$,
  $new$  -- 320: студент чата не разрешил ИИ-помощников: текст сообщения сервису не отдаётся, повтор тоже.
  IF NOT platform_private.ai_agent_conversation_ai_allowed(p_organization_id, p_conversation_id) THEN
    RAISE EXCEPTION 'ai_consent_missing' USING ERRCODE = '42501';
  END IF;

  request_fingerprint := platform_private.ai_memory_json_sha256($new$, 1);

DROP FUNCTION pg_temp.a320_replace(TEXT, TEXT, TEXT, INTEGER);
DROP FUNCTION pg_temp.a320_replace_more(TEXT, TEXT, TEXT, INTEGER);

-- ---------------------------------------------------------------------------
-- g) Журнал платформы: два действия и один тип объекта (rename-and-union, как 311, 315 и 317).
-- ---------------------------------------------------------------------------
ALTER FUNCTION platform_private.p7a_safe_audit_actions()
  RENAME TO p7a_safe_audit_actions_pre_student_ai_consent;
CREATE FUNCTION platform_private.p7a_safe_audit_actions()
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.array_agg(DISTINCT allowed.action ORDER BY allowed.action)
  FROM pg_catalog.unnest(
    platform_private.p7a_safe_audit_actions_pre_student_ai_consent()
      || ARRAY[
    'ai.consent.decline',
    'ai.consent.grant'
      ]::TEXT[]
  ) AS allowed(action)
$$;

ALTER FUNCTION platform_private.p7a_safe_audit_resource_types()
  RENAME TO p7a_safe_audit_resource_types_pre_student_ai_consent;
CREATE FUNCTION platform_private.p7a_safe_audit_resource_types()
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.array_agg(DISTINCT allowed.resource_type ORDER BY allowed.resource_type)
  FROM pg_catalog.unnest(
    platform_private.p7a_safe_audit_resource_types_pre_student_ai_consent()
      || ARRAY[
    'student_ai_consent'
      ]::TEXT[]
  ) AS allowed(resource_type)
$$;

REVOKE ALL ON FUNCTION
  platform_private.p7a_safe_audit_actions_pre_student_ai_consent(),
  platform_private.p7a_safe_audit_actions(),
  platform_private.p7a_safe_audit_resource_types_pre_student_ai_consent(),
  platform_private.p7a_safe_audit_resource_types()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- Права: кабинет студента и сотрудник - authenticated; помощники - никому; инструменты и файл-резолвер
-- сохраняют права (CREATE OR REPLACE их не меняет: service_role).
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  platform_private.student_ai_consent_policy_version(),
  platform_private.student_ai_consent_state(TEXT, TEXT, TIMESTAMPTZ),
  platform_private.student_ai_consent_org(UUID),
  platform_private.student_case_ai_consent(UUID, UUID),
  platform_private.ai_agent_student_ai_allowed(UUID, UUID),
  platform_private.ai_agent_conversation_ai_allowed(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
REVOKE ALL ON FUNCTION
  platform.portal_ai_consent_get_v1(),
  platform.portal_ai_consent_set_v1(TEXT, TEXT, TEXT, UUID),
  platform.staff_student_ai_consent_v1(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
GRANT EXECUTE ON FUNCTION
  platform.portal_ai_consent_get_v1(),
  platform.portal_ai_consent_set_v1(TEXT, TEXT, TEXT, UUID),
  platform.staff_student_ai_consent_v1(UUID, UUID)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- Проверка в конце: что создано и заменено, права, определитель, пустой search_path, число функций семейства.
-- ---------------------------------------------------------------------------
DO $a320_verify$
DECLARE f RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid = 'platform_private.student_ai_consents'::REGCLASS
      AND c.relrowsecurity AND c.relforcerowsecurity)
    OR has_table_privilege('authenticated', 'platform_private.student_ai_consents', 'SELECT')
    OR has_table_privilege('service_role', 'platform_private.student_ai_consents', 'SELECT')
    OR has_table_privilege('anon', 'platform_private.student_ai_consents', 'SELECT')
  THEN
    RAISE EXCEPTION 'a320_verify_table' USING ERRCODE = '55000';
  END IF;
  FOR f IN SELECT p.oid, p.proname, n.nspname, p.prosecdef, p.proconfig FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE (n.nspname = 'platform' AND p.proname IN ('portal_ai_consent_get_v1', 'portal_ai_consent_set_v1', 'staff_student_ai_consent_v1'))
      OR (n.nspname = 'platform_private' AND p.proname IN ('student_ai_consent_policy_version', 'student_ai_consent_state',
        'student_ai_consent_org', 'student_case_ai_consent', 'ai_agent_student_ai_allowed', 'ai_agent_conversation_ai_allowed')) LOOP
    IF f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
      OR has_function_privilege('anon', f.oid, 'EXECUTE') OR has_function_privilege('service_role', f.oid, 'EXECUTE')
      OR has_function_privilege('supabase_auth_admin', f.oid, 'EXECUTE') OR has_function_privilege('evo_ai_agent', f.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'a320_verify_function: %', f.proname USING ERRCODE = '55000';
    END IF;
    IF f.nspname = 'platform' AND (NOT f.prosecdef OR NOT has_function_privilege('authenticated', f.oid, 'EXECUTE')) THEN
      RAISE EXCEPTION 'a320_verify_portal_grant: %', f.proname USING ERRCODE = '55000';
    END IF;
    IF f.nspname = 'platform_private' AND has_function_privilege('authenticated', f.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'a320_verify_helper_grant: %', f.proname USING ERRCODE = '55000';
    END IF;
  END LOOP;
  -- Семейство инструментов и MCP не выросло: 24 инструмента, 3 функции MCP; права сохранены.
  IF (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE AND p.proname LIKE 'ai\_agent\_tool\_%'
        AND p.prosecdef AND has_function_privilege('service_role', p.oid, 'EXECUTE')
        AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')) <> 24
    OR (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE AND p.proname LIKE 'ai\_agent\_mcp\_%'
        AND p.prosecdef AND has_function_privilege('service_role', p.oid, 'EXECUTE')
        AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')) <> 3
  THEN
    RAISE EXCEPTION 'a320_verify_counts' USING ERRCODE = '55000';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE
        AND p.proname IN ('ai_agent_tool_get_document_file_v1', 'ai_agent_tool_get_case_chat_v1', 'ai_agent_mcp_file_resolve_v1')
        AND strpos(p.prosrc, 'ai_agent_student_ai_allowed(') > 0) <> 3
    OR (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE
        AND p.proname IN ('ai_agent_tool_get_conversation_v1', 'ai_agent_tool_list_conversations_v1')
        AND strpos(p.prosrc, 'ai_agent_conversation_ai_allowed(') > 0) <> 2
    OR (SELECT strpos(p.prosrc, 'platform_private.student_ai_consents') = 0 FROM pg_catalog.pg_proc p
        WHERE p.oid = 'platform_private.account_deletion_closure(uuid,uuid)'::REGPROCEDURE)
  THEN
    RAISE EXCEPTION 'a320_verify_bodies' USING ERRCODE = '55000';
  END IF;
  -- (h) Gemini и распознавание: запрет в тринадцати заменённых функциях, слова причины автоответчика, права прежние.
  IF (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.oid IN (
        'platform.ai_agent_ticket_v1(uuid,text,uuid,uuid)'::REGPROCEDURE,
        'platform_private.ai_ticket_allowed(platform_private.ai_tickets)'::REGPROCEDURE,
        'platform.ai_agent_answer_current_v1(uuid,uuid,text)'::REGPROCEDURE,
        'platform_private.ai_memory_poke(uuid,boolean,integer)'::REGPROCEDURE,
        'platform_ai_agent.memory_context_v1(uuid,text,integer)'::REGPROCEDURE,
        'platform_ai_agent.memory_put_v1(uuid,text,bigint,text,text,uuid,integer,uuid,text)'::REGPROCEDURE,
        'platform.ai_agent_memory_v1(uuid,uuid)'::REGPROCEDURE,
        'platform_private.ai_autosend_check(platform_private.ai_autosend_log,text,text,bigint[])'::REGPROCEDURE,
        'platform_ai_agent.autosend_summary_context_v1(uuid,text,integer)'::REGPROCEDURE,
        'platform.begin_gemini_proposal(uuid,uuid,uuid,uuid,text,integer,text)'::REGPROCEDURE,
        'platform.request_gemini_proposal(uuid,uuid,uuid,uuid,text,integer,text,text)'::REGPROCEDURE)
        AND strpos(p.prosrc, 'ai_agent_conversation_ai_allowed(') > 0) <> 11
    OR NOT (SELECT strpos(p.prosrc, 'ai_agent_student_ai_allowed(') > 0 FROM pg_catalog.pg_proc p
        WHERE p.oid = 'platform_private.document_recognition_require_actor(uuid,uuid,uuid,uuid)'::REGPROCEDURE)
    OR platform_private.ai_autosend_reason_ru('ai_consent_missing') <> 'Студент не дал согласия на ИИ-помощников'
    OR NOT has_function_privilege('evo_ai_agent', 'platform_ai_agent.memory_context_v1(uuid,text,integer)'::REGPROCEDURE, 'EXECUTE')
    OR NOT has_function_privilege('evo_ai_agent', 'platform_ai_agent.autosend_summary_context_v1(uuid,text,integer)'::REGPROCEDURE, 'EXECUTE')
    OR has_function_privilege('authenticated', 'platform_ai_agent.memory_put_v1(uuid,text,bigint,text,text,uuid,integer,uuid,text)'::REGPROCEDURE, 'EXECUTE')
    OR has_function_privilege('service_role', 'platform_ai_agent.memory_put_v1(uuid,text,bigint,text,text,uuid,integer,uuid,text)'::REGPROCEDURE, 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'platform.begin_gemini_proposal(uuid,uuid,uuid,uuid,text,integer,text)'::REGPROCEDURE, 'EXECUTE')
    OR has_function_privilege('authenticated', 'platform.begin_gemini_proposal(uuid,uuid,uuid,uuid,text,integer,text)'::REGPROCEDURE, 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'platform.request_gemini_proposal(uuid,uuid,uuid,uuid,text,integer,text,text)'::REGPROCEDURE, 'EXECUTE')
    OR has_function_privilege('service_role', 'platform.request_gemini_proposal(uuid,uuid,uuid,uuid,text,integer,text,text)'::REGPROCEDURE, 'EXECUTE')
    OR has_function_privilege('authenticated', 'platform_private.document_recognition_require_actor(uuid,uuid,uuid,uuid)'::REGPROCEDURE, 'EXECUTE')
    OR has_function_privilege('service_role', 'platform_private.ai_autosend_check(platform_private.ai_autosend_log,text,text,bigint[])'::REGPROCEDURE, 'EXECUTE')
  THEN
    RAISE EXCEPTION 'a320_verify_gemini' USING ERRCODE = '55000';
  END IF;
  IF NOT ('ai.consent.grant' = ANY (platform_private.p7a_safe_audit_actions()))
    OR NOT ('ai.consent.decline' = ANY (platform_private.p7a_safe_audit_actions()))
    OR 'ai.consent.grant' = ANY (platform_private.p7a_safe_audit_actions_pre_student_ai_consent())
    OR cardinality(platform_private.p7a_safe_audit_actions())
      <> cardinality(platform_private.p7a_safe_audit_actions_pre_student_ai_consent()) + 2
    OR NOT ('student_ai_consent' = ANY (platform_private.p7a_safe_audit_resource_types()))
    OR 'student_ai_consent' = ANY (platform_private.p7a_safe_audit_resource_types_pre_student_ai_consent())
    OR cardinality(platform_private.p7a_safe_audit_resource_types())
      <> cardinality(platform_private.p7a_safe_audit_resource_types_pre_student_ai_consent()) + 1
  THEN
    RAISE EXCEPTION 'a320_verify_journal' USING ERRCODE = '55000';
  END IF;
END
$a320_verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
