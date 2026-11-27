-- 382 «Досье лида и дела одним вызовом для ИИ-агентов» (план «ИИ-агенты: мозг компании, досье и предохранители»,
-- разбор 27.11.2026: главная поломка «мозга» — агент собирает карточку клиента двадцатью вызовами и теряет нить).
-- Номер 382: 379–381 заняты параллельными PR (предохранители, сторож, факты); хуки набора и журнала привязаны к имени файла, не к номеру.
--
-- Что добавляется (только добавление: ни одна существующая функция не меняется, согласие 320 не трогается):
--   1) platform.ai_agent_tool_get_lead_dossier_v1(org, agent, {lead_id}) — досье лида, потолок 6000 символов JSON:
--      имя, маски контакта, этап продаж СЛОВОМ, «откуда узнал» и основание отдельно от технического source_key, страна
--      интереса, условия продажи «до договора», следующее действие и срок, открытые задачи (<=5), заметки (<=3), последние
--      15 сообщений WhatsApp (только если согласие студента позволяет), звонки за 14 дней без записи, ссылка на дело.
--   2) platform.ai_agent_tool_get_case_dossier_v1(org, agent, {case_id}) — досье дела, потолок 11500 символов в базе
--      (приложение добавляет шаг пути, итог не больше 12000): куратор, страна, степень, ТРИ этапа отдельными подписанными
--      полями, следующий шаг, анкета «со слов студента», слоты документов без файлов, заявки с набором, ДЕНЬГИ ТРЕМЯ БЛОКАМИ,
--      открытые задачи, заметки, 10 реплик чата кабинета (при согласии), короткий источник лида.
--   3) строки platform_private.ai_agent_tool_schemas для обоих инструментов (kind read, audit read): база проверяет аргументы по ним.
--   4) закрытые помощники (platform_private, без грантов): слова словаря, таблица соответствия этапов, форма суммы,
--      два сборщика с «уровнем сжатия».
--
-- Три этапа дела (не склеивать, не считать одним):
--   process_stage  = student_cases.operational_stage — этап процесса по плейбуку приёмной (11 ключей, слова wording.ts
--                    STUDENT_OPERATIONAL_STAGE; пользовательский ключ вне списка получает слово «индивидуальный этап сопровождения»);
--   board_column   = student_cases.pipeline_stage — колонка доски кураторов «Воронка поступления» (9 ключей, ADMISSIONS_PIPELINE_STAGE);
--   timeline_step  = шаг «пути поступления» страны («3 из 7, Малайзия»): пути лежат в src/content/timelines/*.json, база их не видит.
--                    ЧЕСТНЫЙ ВАРИАНТ: база отдаёт timeline_step = null и ключи (keys.country_code, keys.operational_stage,
--                    keys.pipeline_stage); шаг считает обработчик MCP в приложении теми же функциями, что кабинет студента
--                    (timelineStepProgress), и подмешивает объект. Страна вне шести — null и timeline_step_note.
--   stage_mismatch = true, когда процесс и колонка расходятся по смыслу. Таблица соответствия (ai_agent_dossier_expected_boards),
--                    она же обратная к BOARD_TIMELINE_STAGE в country-timeline.ts:
--                      contract_confirmed, admissions_handoff, intake -> new
--                      profile_and_route -> shortlist          documents -> documents
--                      applications -> ready_to_submit         decisions -> awaiting_decision
--                      visa_and_predeparture -> confirmed, visa, predeparture
--                      arrival_and_adaptation, completed -> arrived
--                      closed, пользовательский этап, пустой этап или колонка -> не сравниваются: stage_mismatch = null.
--
-- Деньги тремя блоками, суммы между блоками не складываются и не сверяются:
--   money.sale_conditions — условия продажи лида «до договора» (platform_private.lead_sale_conditions): план, пожелание, не долг;
--   money.contract        — живые платёжные обязательства и платежи договора (platform.payment_obligations / payment_events,
--                           архивные обязательства 189 не считаются и не суммируются); итоги по каждой валюте отдельно;
--   money.catalog         — {"note": "не долг клиента"}: цены каталога вузов справочные.
--
-- Согласие 320 не менялось и применяется так же, как у get_case_chat / get_conversation: переписка WhatsApp лида идёт только при
-- platform_private.ai_agent_conversation_ai_allowed, чат кабинета дела — только при ai_agent_student_ai_allowed; иначе блок
-- `{available:false, reason:'ai_consent_missing'}`, текста нет. Остальное досье (карточка, этапы, слоты, заявки, деньги) читается
-- как у get_case и get_lead. Чтение пишет тот же аудит (platform_private.ai_agent_audit_read) до выдачи данных.
--
-- Потолок размера: сборщик получает «уровень сжатия» 0..4 (меньше записей, короче тексты, затем без чата и заметок); функция
-- берёт первый уровень, при котором JSON не длиннее потолка. Если пришлось сжимать или что-то не поместилось, `truncated = true`,
-- `omitted` называет число пропущенных записей по разделам, `counts` всегда даёт полные числа.
--
-- Порядок выката: сначала миграция, потом приложение (новое приложение просит инструменты, которых старая база не знает).
-- После выката инструкции агентов изменились (prompts.generated.ts): агентов нужно пересинхронизировать, как после любой правки.
-- Forward-only: повтор отказывает a382_already_applied.
BEGIN;

DO $a382_anchor$
BEGIN
  IF to_regprocedure('platform_private.ai_agent_tool_begin(uuid,text,text,jsonb)') IS NULL
    OR to_regprocedure('platform_private.ai_agent_audit_read(uuid,text,text,text,uuid)') IS NULL
    OR to_regprocedure('platform_private.ai_agent_student_ai_allowed(uuid,uuid)') IS NULL
    OR to_regprocedure('platform_private.ai_agent_conversation_ai_allowed(uuid,uuid)') IS NULL
    OR to_regprocedure('platform_private.lead_channels(uuid,uuid[])') IS NULL
    OR to_regprocedure('platform_private.sales_lead_handoffs(uuid,uuid[])') IS NULL
    OR to_regprocedure('platform_private.sales_lead_stage(platform.lead_lifecycle_state,text,boolean)') IS NULL
    OR to_regprocedure('platform_private.study_country_from_text(text)') IS NULL
    OR to_regprocedure('platform_private.wazzup_message_deleted(uuid,uuid)') IS NULL
    OR to_regprocedure('platform_private.wazzup_conversation_unresolved(uuid,uuid)') IS NULL
    OR to_regclass('platform_private.lead_sale_conditions') IS NULL
    OR to_regclass('platform_private.catalog_preparation_bindings') IS NULL
    OR to_regclass('platform_private.student_applications') IS NULL THEN
    RAISE EXCEPTION 'a382_anchor_drift: the 317 / 320 / 214 / 247 / 264 objects this migration builds on are missing' USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('platform.ai_agent_tool_get_lead_dossier_v1(uuid,text,jsonb)') IS NOT NULL
    OR to_regprocedure('platform.ai_agent_tool_get_case_dossier_v1(uuid,text,jsonb)') IS NOT NULL
    OR EXISTS (SELECT 1 FROM platform_private.ai_agent_tool_schemas WHERE tool IN ('get_lead_dossier', 'get_case_dossier')) THEN
    RAISE EXCEPTION 'a382_already_applied' USING ERRCODE = '55000';
  END IF;
END
$a382_anchor$;

-- ---------------------------------------------------------------------------
-- 1. Строки схем входа (зеркало contract.ts; совпадение проверяет tests/ai-agents-db-contract.test.mjs).
-- ---------------------------------------------------------------------------
INSERT INTO platform_private.ai_agent_tool_schemas (tool, kind, audit, input_schema) VALUES
  ('get_lead_dossier', 'read', 'read', $j${"type":"object","properties":{"lead_id":{"type":"string","pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$","description":"Lead id."}},"required":["lead_id"],"additionalProperties":false}$j$::jsonb),
  ('get_case_dossier', 'read', 'read', $j${"type":"object","properties":{"case_id":{"type":"string","pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$","description":"Student case id."}},"required":["case_id"],"additionalProperties":false}$j$::jsonb);

-- ---------------------------------------------------------------------------
-- 2. Закрытые помощники.
-- ---------------------------------------------------------------------------

-- Слова словаря: те же, что на экранах (src/lib/v3/wording.ts, lead-channel-contract.ts); совпадение построчно проверяет
-- tests/ai-agents-dossier.test.mjs. Ключ человеку не показывается: он идёт только во внутреннее поле keys.
CREATE FUNCTION platform_private.ai_agent_dossier_word(p_kind TEXT, p_key TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT w.word FROM (VALUES
    ('sales_stage', 'new', 'Новый'),
    ('sales_stage', 'contacting', 'Связались'),
    ('sales_stage', 'qualified', 'Квалифицирован'),
    ('sales_stage', 'meeting_scheduled', 'Встреча назначена'),
    ('sales_stage', 'meeting_completed', 'Встреча проведена'),
    ('sales_stage', 'potential', 'Потенциальный клиент'),
    ('sales_stage', 'handed_off', 'Переданы'),
    ('sales_stage', 'closed', 'Закрыт'),
    ('process_stage', 'contract_confirmed', 'договор подтверждён'),
    ('process_stage', 'admissions_handoff', 'передано в приёмную'),
    ('process_stage', 'intake', 'приём дела'),
    ('process_stage', 'profile_and_route', 'выбор программы'),
    ('process_stage', 'documents', 'сбор документов'),
    ('process_stage', 'applications', 'подача заявок в университеты'),
    ('process_stage', 'decisions', 'решения университетов'),
    ('process_stage', 'visa_and_predeparture', 'виза и подготовка к отъезду'),
    ('process_stage', 'arrival_and_adaptation', 'поездка и прибытие'),
    ('process_stage', 'completed', 'поступление завершено'),
    ('process_stage', 'closed', 'дело закрыто'),
    ('board_column', 'new', 'Новые'),
    ('board_column', 'shortlist', 'Подбор вузов'),
    ('board_column', 'documents', 'Документы'),
    ('board_column', 'ready_to_submit', 'Готовы к подаче'),
    ('board_column', 'awaiting_decision', 'Ожидаем решения'),
    ('board_column', 'confirmed', 'Поступление подтверждено'),
    ('board_column', 'visa', 'Оформление визы'),
    ('board_column', 'predeparture', 'Подготовка к выезду'),
    ('board_column', 'arrived', 'Прибыл'),
    ('channel', 'instagram_ads', 'Instagram — реклама'),
    ('channel', 'instagram', 'Instagram — посты и профиль'),
    ('channel', 'website_search', 'Сайт и поиск'),
    ('channel', 'referral', 'Рекомендация'),
    ('channel', 'other', 'Другое'),
    ('channel', 'unknown', 'Не известно'),
    ('channel_basis', 'utm', 'по метке'),
    ('channel_basis', 'referrer', 'по ссылке'),
    ('channel_basis', 'staff', 'со слов клиента'),
    ('channel_basis', 'corrected', 'исправлено'),
    ('channel_basis', 'unknown', 'не известно'),
    ('document_status', 'required', 'Не загружен'),
    ('document_status', 'submitted', 'На проверке'),
    ('document_status', 'approved', 'Принят'),
    ('document_status', 'correction_required', 'Нужно исправить'),
    ('document_status', 'rejected', 'Отклонён'),
    ('application_status', 'preparation', 'вариант'),
    ('application_status', 'ready', 'готова к подаче'),
    ('application_status', 'submitted', 'подана'),
    ('application_status', 'under_review', 'на рассмотрении'),
    ('application_status', 'offer', 'получен оффер'),
    ('application_status', 'rejected', 'отказ вуза'),
    ('application_status', 'enrolled', 'зачислен'),
    ('application_status', 'withdrawn', 'отозвана'),
    ('application_status', 'closed', 'закрыта'),
    ('task_status', 'open', 'в работе'),
    ('task_status', 'in_progress', 'в работе'),
    ('task_status', 'blocked', 'заблокирована'),
    ('task_status', 'done', 'выполнена'),
    ('task_status', 'cancelled', 'отменена'),
    ('obligation_status', 'pending', 'ожидает оплаты'),
    ('obligation_status', 'partially_paid', 'оплачено частично'),
    ('obligation_status', 'paid', 'оплачено'),
    ('obligation_status', 'overdue', 'просрочено'),
    ('obligation_category', 'evo_service_fee', 'услуги EVO'),
    ('obligation_category', 'third_party_cost', 'сторонние расходы'),
    ('payment_event', 'payment', 'Оплачено'),
    ('payment_event', 'refund', 'Возврат'),
    ('case_state', 'pending', 'ожидает начала'),
    ('case_state', 'active', 'в работе'),
    ('case_state', 'closed', 'закрыт'),
    ('degree', 'foundation', 'Фаундейшн'),
    ('degree', 'language', 'Языковые курсы'),
    ('degree', 'diploma', 'Диплом'),
    ('degree', 'bachelor', 'Бакалавриат'),
    ('degree', 'master', 'Магистратура'),
    ('degree', 'phd', 'Докторантура'),
    ('task_priority', 'urgent', 'срочно'),
    ('answer', 'CN', 'Китай'),
    ('answer', 'MY', 'Малайзия'),
    ('answer', 'DE', 'Германия'),
    ('answer', 'FR', 'Франция'),
    ('answer', 'ES', 'Испания'),
    ('answer', 'IT', 'Италия'),
    ('answer', 'NL', 'Нидерланды'),
    ('answer', 'PL', 'Польша'),
    ('answer', 'HU', 'Венгрия'),
    ('answer', 'AT', 'Австрия'),
    ('answer', 'CZ', 'Чехия'),
    ('answer', 'GB', 'Великобритания'),
    ('answer', 'CY', 'Кипр'),
    ('answer', 'TR', 'Турция'),
    ('answer', 'AE', 'ОАЭ'),
    ('answer', 'EUROPE', 'Европа'),
    ('answer', 'spring', 'Весна'),
    ('answer', 'summer', 'Лето'),
    ('answer', 'autumn', 'Осень'),
    ('answer', 'winter', 'Зима'),
    ('answer', 'undecided', 'Пока не определился'),
    ('answer', 'secondary', 'Учусь в школе'),
    ('answer', 'high_school', 'Окончил школу'),
    ('answer', 'foundation', 'Подготовительная программа'),
    ('answer', 'diploma', 'Колледж / диплом'),
    ('answer', 'bachelor', 'Бакалавриат'),
    ('answer', 'master', 'Магистратура'),
    ('answer', 'phd', 'Докторантура'),
    ('answer', 'language', 'Языковая программа'),
    ('answer', 'beginner', 'Начальный'),
    ('answer', 'intermediate', 'Средний'),
    ('answer', 'advanced', 'Продвинутый'),
    ('answer', 'fluent', 'Свободное владение'),
    ('answer', 'ielts', 'IELTS'),
    ('answer', 'toefl', 'TOEFL iBT · шкала 1–6'),
    ('answer', 'toefl_120', 'TOEFL iBT · шкала 0–120'),
    ('answer', 'pte', 'PTE Academic'),
    ('answer', 'duolingo', 'Duolingo English Test'),
    ('answer', 'under_5000', 'До 5 000 $'),
    ('answer', '5000_10000', '5 000–10 000 $'),
    ('answer', '10000_20000', '10 000–20 000 $'),
    ('answer', '20000_30000', '20 000–30 000 $'),
    ('answer', 'over_30000', 'Более 30 000 $'),
    ('answer', 'family', 'Семья'),
    ('answer', 'savings', 'Личные накопления'),
    ('answer', 'scholarship', 'Стипендия / грант'),
    ('answer', 'loan', 'Образовательный кредит'),
    ('answer', 'employer', 'Работодатель'),
    ('direction', 'CN', 'Китай'),
    ('direction', 'MY', 'Малайзия'),
    ('direction', 'EUROPE', 'Европа'),
    ('direction', 'EU', 'Европа'),
    ('direction', 'AE', 'ОАЭ'),
    ('direction', 'TR', 'Турция')
  ) AS w(kind, key, word) WHERE w.kind = p_kind AND w.key = p_key
$$;

-- Таблица соответствия «этап процесса -> колонки доски, которые ему не противоречат» (см. шапку). NULL — не сравнивается.
CREATE FUNCTION platform_private.ai_agent_dossier_expected_boards(p_process TEXT)
RETURNS TEXT[] LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE p_process
    WHEN 'contract_confirmed' THEN ARRAY['new']
    WHEN 'admissions_handoff' THEN ARRAY['new']
    WHEN 'intake' THEN ARRAY['new']
    WHEN 'profile_and_route' THEN ARRAY['shortlist']
    WHEN 'documents' THEN ARRAY['documents']
    WHEN 'applications' THEN ARRAY['ready_to_submit']
    WHEN 'decisions' THEN ARRAY['awaiting_decision']
    WHEN 'visa_and_predeparture' THEN ARRAY['confirmed', 'visa', 'predeparture']
    WHEN 'arrival_and_adaptation' THEN ARRAY['arrived']
    WHEN 'completed' THEN ARRAY['arrived']
    ELSE NULL END
$$;

-- Обрезка текста с честной меткой: обрезанная строка кончается на «[…]», по числу меток сборщик ставит в omitted `text_cut`.
-- Строка длиннее предела режется до предела и получает метку; метка в предел не входит.
CREATE FUNCTION platform_private.ai_agent_dossier_cut(p_text TEXT, p_cap INTEGER)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN char_length(p_text) > p_cap THEN left(p_text, p_cap) || '[…]' ELSE p_text END
$$;

-- Имя сотрудника в досье: не длиннее 200 символов.
CREATE FUNCTION platform_private.ai_agent_dossier_name(p_organization_id UUID, p_membership_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT platform_private.ai_agent_dossier_cut(platform_private.ai_agent_member_name(p_organization_id, p_membership_id), 200)
$$;

-- Сумма в досье: валюта всегда рядом с числом; без валюты только «как записано».
CREATE FUNCTION platform_private.ai_agent_dossier_amount(p_minor BIGINT, p_currency TEXT, p_raw TEXT)
RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_minor IS NOT NULL AND NULLIF(btrim(p_currency), '') IS NOT NULL
      THEN jsonb_build_object('amount', platform_private.ai_agent_money(p_minor), 'currency', p_currency)
    WHEN NULLIF(btrim(p_raw), '') IS NOT NULL THEN jsonb_build_object('as_written', platform_private.ai_agent_dossier_cut(btrim(p_raw), 60))
  END
$$;

-- Ответы анкеты словами (те же слова, что у анкеты на экране: APPLICATION_LABELS); неизвестное значение остаётся как написано,
-- но не длиннее 120 символов; числа и логические значения не меняются.
CREATE FUNCTION platform_private.ai_agent_dossier_answer(p_value JSONB)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  RETURN CASE jsonb_typeof(p_value)
    WHEN 'string' THEN to_jsonb(COALESCE(platform_private.ai_agent_dossier_word('answer', p_value #>> '{}'), platform_private.ai_agent_dossier_cut(p_value #>> '{}', 120)))
    WHEN 'array' THEN COALESCE((SELECT jsonb_agg(platform_private.ai_agent_dossier_answer(e.value)) FROM jsonb_array_elements(p_value) e), '[]'::JSONB)
    WHEN 'object' THEN COALESCE((SELECT jsonb_object_agg(j.key, platform_private.ai_agent_dossier_answer(j.value)) FROM jsonb_each(p_value) j), '{}'::JSONB)
    ELSE p_value END;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Сборщик досье лида. p_level 0..4: чем больше, тем короче (потолок проверяет вызывающая функция).
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.ai_agent_lead_dossier_build(p_organization_id UUID, p_lead_id UUID, p_level INTEGER)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  l platform.leads; c platform.clients; v_f JSONB; v_ch RECORD; v_hand RECORD; v_case platform.student_cases;
  v_cv platform.communication_conversations;
  v_msgs INTEGER := (ARRAY[15, 15, 10, 5, 0])[p_level + 1];
  v_msg_chars INTEGER := (ARRAY[220, 120, 100, 80, 0])[p_level + 1];
  v_notes INTEGER := (ARRAY[3, 3, 2, 1, 0])[p_level + 1];
  v_note_chars INTEGER := (ARRAY[300, 160, 120, 100, 0])[p_level + 1];
  v_tasks INTEGER := (ARRAY[5, 5, 4, 3, 2])[p_level + 1];
  v_task_chars INTEGER := (ARRAY[120, 100, 80, 60, 50])[p_level + 1];
  v_wishes BOOLEAN := p_level < 3;
  v_stage TEXT; v_channel JSONB; v_conditions JSONB; v_conversation JSONB; v_tasks_json JSONB;
  v_notes_json JSONB; v_calls JSONB; v_case_json JSONB;
  v_notes_total INTEGER; v_tasks_total INTEGER; v_msgs_total INTEGER := 0; v_shown_msgs INTEGER := 0;
  v_omitted JSONB := '{}'::JSONB; v_res JSONB; v_cut INTEGER;
BEGIN
  SELECT * INTO l FROM platform.leads x WHERE x.organization_id = p_organization_id AND x.id = p_lead_id;
  SELECT * INTO c FROM platform.clients x WHERE x.organization_id = p_organization_id AND x.id = l.client_id;
  SELECT * INTO v_ch FROM platform_private.lead_channels(p_organization_id, ARRAY[l.id]) x LIMIT 1;
  SELECT * INTO v_hand FROM platform_private.sales_lead_handoffs(p_organization_id, ARRAY[l.id]) x LIMIT 1;
  SELECT s.fields INTO v_f FROM platform_private.lead_sale_conditions s WHERE s.organization_id = p_organization_id AND s.lead_id = l.id;

  v_stage := platform_private.sales_lead_stage(l.lifecycle_state, l.stage_key, v_hand.lead_id IS NOT NULL);

  v_channel := jsonb_build_object(
    'label', 'Откуда узнал клиент (не канал связи)',
    'channel', platform_private.ai_agent_dossier_word('channel', COALESCE(v_ch.channel, 'unknown')),
    'basis', platform_private.ai_agent_dossier_word('channel_basis', COALESCE(v_ch.basis, 'unknown')),
    'corrected_by_staff', COALESCE(v_ch.corrected, FALSE), 'at', v_ch.touch_at);

  IF v_f IS NULL THEN
    v_conditions := jsonb_build_object('label', 'До договора: условия продажи и пожелания клиента, не обязательство и не долг',
      'filled', FALSE);
  ELSE
    v_conditions := jsonb_strip_nulls(jsonb_build_object(
      'label', 'До договора: условия продажи и пожелания клиента, не обязательство и не долг',
      'filled', TRUE,
      'service', NULLIF(platform_private.ai_agent_dossier_cut(btrim(COALESCE(v_f ->> 'service_label', '')), 200), ''),
      'planned_service_cost', platform_private.ai_agent_dossier_amount((v_f ->> 'service_cost_minor')::BIGINT,
        v_f ->> 'service_cost_currency', v_f ->> 'service_cost_raw'),
      'paid_at_sale', platform_private.ai_agent_dossier_amount((v_f ->> 'paid_minor')::BIGINT,
        v_f ->> 'paid_currency', v_f ->> 'paid_raw'),
      'client_budget', CASE WHEN platform_private.ai_agent_dossier_amount((v_f ->> 'conditions_budget_minor')::BIGINT,
          v_f ->> 'conditions_budget_currency', v_f ->> 'conditions_budget_raw') IS NULL THEN NULL
        ELSE platform_private.ai_agent_dossier_amount((v_f ->> 'conditions_budget_minor')::BIGINT,
          v_f ->> 'conditions_budget_currency', v_f ->> 'conditions_budget_raw')
          || jsonb_build_object('per', CASE v_f ->> 'conditions_budget_period' WHEN 'year' THEN 'год'
            WHEN 'program' THEN 'вся программа' END) END,
      'signing_date', NULLIF(v_f ->> 'signing_date', ''),
      'payment_note', NULLIF(platform_private.ai_agent_dossier_cut(btrim(COALESCE(v_f ->> 'payment_note', '')), 160), ''),
      'wishes', CASE WHEN v_wishes THEN jsonb_strip_nulls(jsonb_build_object(
          'countries', NULLIF(platform_private.ai_agent_dossier_cut(btrim(COALESCE(v_f ->> 'wishes_countries', '')), 200), ''),
          'study_fields', NULLIF(platform_private.ai_agent_dossier_cut(btrim(COALESCE(v_f ->> 'wishes_study_fields', '')), 200), ''),
          'education_level', NULLIF(platform_private.ai_agent_dossier_cut(btrim(COALESCE(v_f ->> 'wishes_education_level', '')), 100), ''),
          'intake_season', NULLIF(btrim(COALESCE(v_f ->> 'wishes_intake_season', '')), ''),
          'intake_year', NULLIF(btrim(COALESCE(v_f ->> 'wishes_intake_year', '')), ''),
          'universities', NULLIF(platform_private.ai_agent_dossier_cut(btrim(COALESCE(v_f ->> 'wishes_universities', '')), 200), ''))) END));
  END IF;

  -- Открытые задачи лида.
  SELECT count(*) INTO v_tasks_total FROM platform.staff_tasks x
  WHERE x.organization_id = p_organization_id AND x.status IN ('open', 'in_progress', 'blocked')
    AND x.id IN (SELECT k.staff_task_id FROM platform_private.staff_lead_task_links k
      WHERE k.organization_id = p_organization_id AND k.lead_id = l.id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('task_id', t.id, 'title', platform_private.ai_agent_dossier_cut(t.title, v_task_chars),
      'assignee_name', platform_private.ai_agent_dossier_name(t.organization_id, t.assignee_membership_id),
      'status', platform_private.ai_agent_dossier_word('task_status', t.status::TEXT),
      'important', t.priority::TEXT IN ('high', 'urgent'),
      'due_on', COALESCE(t.due_on, (t.due_at AT TIME ZONE 'Asia/Bishkek')::DATE))
      || CASE WHEN platform_private.ai_agent_dossier_word('task_priority', t.priority::TEXT) IS NULL THEN '{}'::JSONB
        ELSE jsonb_build_object('priority', platform_private.ai_agent_dossier_word('task_priority', t.priority::TEXT)) END
      ORDER BY t.created_at DESC), '[]'::JSONB)
  INTO v_tasks_json
  FROM (SELECT x.* FROM platform.staff_tasks x
    WHERE x.organization_id = p_organization_id AND x.status IN ('open', 'in_progress', 'blocked')
      AND x.id IN (SELECT k.staff_task_id FROM platform_private.staff_lead_task_links k
        WHERE k.organization_id = p_organization_id AND k.lead_id = l.id)
    ORDER BY x.created_at DESC LIMIT v_tasks) t;

  -- Заметки лида.
  SELECT count(*) INTO v_notes_total FROM platform.case_notes x WHERE x.organization_id = p_organization_id AND x.lead_id = l.id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('at', n.created_at,
      'author', platform_private.ai_agent_dossier_name(n.organization_id, n.created_by_membership_id),
      'text', platform_private.ai_agent_dossier_cut(n.body, v_note_chars)) ORDER BY n.created_at DESC), '[]'::JSONB)
  INTO v_notes_json
  FROM (SELECT x.* FROM platform.case_notes x WHERE x.organization_id = p_organization_id AND x.lead_id = l.id
    ORDER BY x.created_at DESC LIMIT v_notes) n;

  -- Переписка WhatsApp: самый свежий чат лида, только если согласие студента (если он есть) позволяет.
  SELECT cv.* INTO v_cv FROM platform.communication_conversations cv
  WHERE cv.organization_id = p_organization_id AND cv.canonical_lead_id = l.id
  ORDER BY COALESCE((SELECT max(m.created_at) FROM platform.communication_messages m
    WHERE m.organization_id = cv.organization_id AND m.conversation_id = cv.id), cv.created_at) DESC, cv.id DESC
  LIMIT 1;
  IF NOT FOUND THEN
    v_conversation := jsonb_build_object('available', FALSE, 'reason', 'no_conversation');
  ELSIF platform_private.wazzup_conversation_unresolved(p_organization_id, v_cv.id) THEN
    -- 325: беседа Wazzup с неопределённым клиентом закрыта целиком, и до проверки согласия.
    v_conversation := jsonb_build_object('available', FALSE, 'reason', 'identity_unresolved');
  ELSIF NOT platform_private.ai_agent_conversation_ai_allowed(p_organization_id, v_cv.id) THEN
    v_conversation := jsonb_build_object('available', FALSE, 'reason', 'ai_consent_missing');
  ELSE
    SELECT count(*) INTO v_msgs_total FROM platform.communication_messages x
    WHERE x.organization_id = p_organization_id AND x.conversation_id = v_cv.id;
    -- 325: текст сообщения, которое клиент удалил у себя, не отдаётся (и его медиа тоже): только отметка deleted.
    SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('at', m.created_at,
        'from', platform_private.ai_agent_message_origin(m),
        'text', CASE WHEN platform_private.wazzup_message_deleted(m.organization_id, m.id) THEN NULL
          ELSE platform_private.ai_agent_dossier_cut(COALESCE(platform_private.ai_message_view(m) ->> 'text', ''), v_msg_chars) END,
        'media', CASE WHEN platform_private.wazzup_message_deleted(m.organization_id, m.id) THEN NULL
          ELSE platform_private.ai_message_view(m) -> 'media' -> 0 ->> 'kind' END)
        || CASE WHEN platform_private.wazzup_message_deleted(m.organization_id, m.id) THEN jsonb_build_object('deleted', TRUE)
          ELSE '{}'::JSONB END) ORDER BY m.created_at, m.id), '[]'::JSONB),
      count(*)::INTEGER
    INTO v_conversation, v_shown_msgs
    FROM (SELECT x.* FROM platform.communication_messages x
      WHERE x.organization_id = p_organization_id AND x.conversation_id = v_cv.id
      ORDER BY x.created_at DESC, x.id DESC LIMIT v_msgs) m;
    v_conversation := jsonb_build_object('available', TRUE, 'conversation_id', v_cv.id,
      'status', v_cv.status::TEXT, 'messages_total', v_msgs_total, 'messages', v_conversation,
      'last_is_from_client', COALESCE((SELECT x.direction = 'inbound' FROM platform_private.ai_agent_conv_last(p_organization_id, v_cv.id) x), FALSE));
  END IF;

  -- Звонки за 14 дней: только число и время последнего, без записей и номеров.
  SELECT jsonb_build_object('days', 14, 'count', count(*), 'last_at', max(tc.started_at)) INTO v_calls
  FROM platform_private.telephony_calls tc
  WHERE tc.organization_id = p_organization_id AND tc.lead_id = l.id AND tc.started_at >= clock_timestamp() - INTERVAL '14 days';

  -- Дело: по завершённой передаче или по каноническому лиду.
  SELECT * INTO v_case FROM platform.student_cases s
  WHERE s.organization_id = p_organization_id AND (s.id = v_hand.student_case_id OR s.canonical_lead_id = l.id)
  ORDER BY (s.id = v_hand.student_case_id) DESC NULLS LAST, s.created_at DESC LIMIT 1;
  IF FOUND THEN
    v_case_json := jsonb_build_object('case_id', v_case.id, 'student_name', platform_private.ai_agent_dossier_cut(v_case.student_display_name, 200),
      'process_stage', COALESCE(platform_private.ai_agent_dossier_word('process_stage', v_case.operational_stage),
        CASE WHEN NULLIF(btrim(v_case.operational_stage), '') IS NULL THEN NULL ELSE 'индивидуальный этап сопровождения' END));
  END IF;

  IF v_msgs_total > v_shown_msgs THEN v_omitted := v_omitted || jsonb_build_object('messages', v_msgs_total - v_shown_msgs); END IF;
  IF v_notes_total > jsonb_array_length(v_notes_json) THEN
    v_omitted := v_omitted || jsonb_build_object('notes', v_notes_total - jsonb_array_length(v_notes_json)); END IF;
  IF v_tasks_total > jsonb_array_length(v_tasks_json) THEN
    v_omitted := v_omitted || jsonb_build_object('open_tasks', v_tasks_total - jsonb_array_length(v_tasks_json)); END IF;

  -- Пропущенные на сжатых уровнях разделы называются в omitted (раздел, а не число записей: значение 1).
  IF NOT v_wishes AND v_f IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_each_text(v_f) e
      WHERE e.key LIKE 'wishes\_%' AND NULLIF(btrim(e.value), '') IS NOT NULL) THEN
    v_omitted := v_omitted || jsonb_build_object('wishes', 1);
  END IF;

  v_res := jsonb_build_object(
    'lead', jsonb_build_object('lead_id', l.id, 'client_id', l.client_id, 'name', platform_private.ai_agent_dossier_cut(c.display_name, 200),
      'phone_masked', platform_private.ai_agent_mask_phone(c.phone), 'email_masked', platform_private.ai_agent_mask_email(c.email),
      'sales_stage', platform_private.ai_agent_dossier_word('sales_stage', v_stage),
      'owner_name', platform_private.ai_agent_dossier_name(l.organization_id, l.current_owner_membership_id),
      'created_at', l.created_at, 'updated_at', l.updated_at),
    'keys', jsonb_build_object('sales_stage', v_stage, 'stage_key', l.stage_key, 'source_key', l.source_key,
      'interest_direction', l.interest_direction, 'lifecycle', l.lifecycle_state::TEXT),
    'channel', v_channel,
    'interest', jsonb_strip_nulls(jsonb_build_object('label', 'Страна интереса',
      'direction', platform_private.ai_agent_dossier_word('direction', l.interest_direction),
      'countries_written', CASE WHEN v_f IS NULL THEN NULL
        ELSE NULLIF(platform_private.ai_agent_dossier_cut(btrim(COALESCE(v_f ->> 'wishes_countries', '')), 200), '') END)),
    'sale_conditions', v_conditions,
    'next_action', CASE WHEN NULLIF(btrim(COALESCE(l.next_action_text, '')), '') IS NULL THEN NULL
      ELSE jsonb_build_object('text', platform_private.ai_agent_dossier_cut(btrim(l.next_action_text), 300), 'due_on', l.next_action_due_date) END,
    'open_tasks', v_tasks_json,
    'notes', v_notes_json,
    'conversation', v_conversation,
    'calls', v_calls,
    'case', v_case_json,
    'counts', jsonb_build_object('open_tasks', v_tasks_total, 'notes', v_notes_total));
  -- Каждая обрезанная строка кончается меткой «[…]»: считаем их в готовом ответе, не по разделам.
  v_cut := (char_length(v_res::TEXT) - char_length(replace(v_res::TEXT, '[…]"', ''))) / char_length('[…]"');
  IF v_cut > 0 THEN v_omitted := v_omitted || jsonb_build_object('text_cut', v_cut); END IF;
  RETURN v_res || jsonb_build_object('truncated', v_omitted <> '{}'::JSONB, 'omitted', v_omitted);
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Сборщик досье дела.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.ai_agent_case_dossier_build(p_organization_id UUID, p_case_id UUID, p_level INTEGER)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s platform.student_cases; v_lead platform.leads; v_hand RECORD; v_ch RECORD; v_f JSONB; v_q JSONB; v_qx RECORD;
  v_docs INTEGER := (ARRAY[40, 25, 15, 8, 5])[p_level + 1];
  v_apps INTEGER := (ARRAY[10, 8, 6, 4, 3])[p_level + 1];
  v_tasks INTEGER := (ARRAY[10, 6, 4, 3, 2])[p_level + 1];
  v_notes INTEGER := (ARRAY[3, 3, 2, 1, 0])[p_level + 1];
  v_note_chars INTEGER := (ARRAY[240, 160, 120, 100, 0])[p_level + 1];
  v_chat INTEGER := (ARRAY[10, 10, 6, 3, 0])[p_level + 1];
  v_chat_chars INTEGER := (ARRAY[300, 160, 120, 100, 0])[p_level + 1];
  v_obl INTEGER := (ARRAY[8, 6, 4, 3, 2])[p_level + 1];
  v_pay INTEGER := (ARRAY[3, 3, 2, 1, 0])[p_level + 1];
  v_label_chars INTEGER := (ARRAY[80, 80, 60, 50, 40])[p_level + 1];
  v_with_qa BOOLEAN := p_level < 3;
  v_today DATE := (clock_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE;
  v_country_code TEXT; v_country JSONB; v_expected TEXT[]; v_mismatch BOOLEAN; v_process_word TEXT; v_board_word TEXT;
  v_mismatch_note TEXT; v_next JSONB; v_docs_json JSONB; v_apps_json JSONB; v_tasks_json JSONB; v_notes_json JSONB;
  v_chat_json JSONB; v_money JSONB; v_lead_json JSONB; v_qa JSONB; v_cond JSONB; v_contract JSONB;
  v_docs_total INTEGER; v_apps_total INTEGER; v_tasks_total INTEGER; v_notes_total INTEGER; v_chat_total INTEGER := 0;
  v_docs_counts JSONB; v_obl_total INTEGER; v_archived INTEGER; v_totals JSONB; v_overdue INTEGER; v_pay_json JSONB;
  v_omitted JSONB := '{}'::JSONB; v_obl_json JSONB; v_chat_allowed BOOLEAN; v_shown INTEGER; v_res JSONB; v_cut INTEGER;
BEGIN
  SELECT * INTO s FROM platform.student_cases x WHERE x.organization_id = p_organization_id AND x.id = p_case_id;
  v_country_code := platform_private.study_country_from_text(s.target_country);
  v_country := CASE WHEN NULLIF(btrim(COALESCE(s.target_country, '')), '') IS NULL THEN NULL
    ELSE jsonb_build_object('name', COALESCE((SELECT sc.name_ru FROM platform.study_countries sc WHERE sc.country_code = v_country_code),
      platform_private.ai_agent_dossier_cut(btrim(s.target_country), 80))) END;

  -- Три этапа: процесс, колонка доски, (шаг пути считает приложение).
  v_process_word := CASE WHEN NULLIF(btrim(COALESCE(s.operational_stage, '')), '') IS NULL THEN NULL
    ELSE COALESCE(platform_private.ai_agent_dossier_word('process_stage', btrim(s.operational_stage)), 'индивидуальный этап сопровождения') END;
  v_board_word := platform_private.ai_agent_dossier_word('board_column', s.pipeline_stage);
  v_expected := platform_private.ai_agent_dossier_expected_boards(btrim(COALESCE(s.operational_stage, '')));
  v_mismatch := CASE WHEN v_expected IS NULL OR v_board_word IS NULL THEN NULL ELSE NOT (s.pipeline_stage = ANY (v_expected)) END;
  v_mismatch_note := CASE WHEN v_mismatch IS TRUE THEN format('Процесс говорит «%s», а на доске дело стоит в колонке «%s»: уточните у куратора, что верно, и не называйте один из этапов единственным.',
    v_process_word, v_board_word) END;

  v_next := CASE WHEN NULLIF(btrim(COALESCE(s.next_action, '')), '') IS NULL THEN NULL
    ELSE jsonb_build_object('text', platform_private.ai_agent_dossier_cut(btrim(s.next_action), 300), 'due_on', s.next_action_due_on) END;

  -- Лид дела: короткий источник и условия продажи «до договора».
  SELECT * INTO v_lead FROM platform.leads x WHERE x.organization_id = p_organization_id AND x.id = s.canonical_lead_id;
  IF FOUND THEN
    SELECT * INTO v_ch FROM platform_private.lead_channels(p_organization_id, ARRAY[v_lead.id]) x LIMIT 1;
    SELECT * INTO v_hand FROM platform_private.sales_lead_handoffs(p_organization_id, ARRAY[v_lead.id]) x LIMIT 1;
    v_lead_json := jsonb_build_object('lead_id', v_lead.id,
      'channel', platform_private.ai_agent_dossier_word('channel', COALESCE(v_ch.channel, 'unknown')),
      'basis', platform_private.ai_agent_dossier_word('channel_basis', COALESCE(v_ch.basis, 'unknown')),
      'sales_stage', platform_private.ai_agent_dossier_word('sales_stage',
        platform_private.sales_lead_stage(v_lead.lifecycle_state, v_lead.stage_key, v_hand.lead_id IS NOT NULL)),
      'owner_name', platform_private.ai_agent_dossier_name(v_lead.organization_id, v_lead.current_owner_membership_id));
    SELECT x.fields INTO v_f FROM platform_private.lead_sale_conditions x
    WHERE x.organization_id = p_organization_id AND x.lead_id = v_lead.id;
  END IF;
  v_cond := jsonb_build_object('label', 'До договора: условия продажи и пожелания клиента, не обязательство и не долг',
    'filled', v_f IS NOT NULL);
  IF v_f IS NOT NULL THEN
    v_cond := v_cond || jsonb_strip_nulls(jsonb_build_object(
      'service', NULLIF(platform_private.ai_agent_dossier_cut(btrim(COALESCE(v_f ->> 'service_label', '')), 200), ''),
      'planned_service_cost', platform_private.ai_agent_dossier_amount((v_f ->> 'service_cost_minor')::BIGINT,
        v_f ->> 'service_cost_currency', v_f ->> 'service_cost_raw'),
      'paid_at_sale', platform_private.ai_agent_dossier_amount((v_f ->> 'paid_minor')::BIGINT,
        v_f ->> 'paid_currency', v_f ->> 'paid_raw'),
      'client_budget', CASE WHEN platform_private.ai_agent_dossier_amount((v_f ->> 'conditions_budget_minor')::BIGINT,
          v_f ->> 'conditions_budget_currency', v_f ->> 'conditions_budget_raw') IS NULL THEN NULL
        ELSE platform_private.ai_agent_dossier_amount((v_f ->> 'conditions_budget_minor')::BIGINT,
          v_f ->> 'conditions_budget_currency', v_f ->> 'conditions_budget_raw')
          || jsonb_build_object('per', CASE v_f ->> 'conditions_budget_period' WHEN 'year' THEN 'год'
            WHEN 'program' THEN 'вся программа' END) END,
      'signing_date', NULLIF(v_f ->> 'signing_date', '')));
  END IF;

  -- Анкета студента с сайта: только выбранные ответы, помечено «со слов студента».
  IF v_with_qa THEN
    SELECT x.status, x.submitted_at, x.questionnaire INTO v_qx FROM platform_private.student_applications x
    WHERE x.organization_id = s.organization_id
      AND (x.id = s.public_application_id OR x.student_case_id = s.id OR x.invited_case_id = s.id)
    ORDER BY x.submitted_at DESC NULLS LAST, x.id DESC LIMIT 1;
    IF FOUND THEN
      v_q := v_qx.questionnaire;
      v_qa := jsonb_build_object('source', 'со слов студента (анкета на сайте), EVO не проверял', 'self_reported', TRUE,
        'status', v_qx.status, 'submitted_at', v_qx.submitted_at,
        'answers', platform_private.ai_agent_dossier_answer(jsonb_strip_nulls(jsonb_build_object(
          'destination_countries', v_q -> 'destinationCountries', 'intake_season', v_q -> 'intakeSeason',
          'intake_year', v_q -> 'intakeYear', 'education_level', v_q -> 'educationLevel',
          'average_grade', v_q -> 'averageGrade', 'grade_scale', v_q -> 'gradeScale',
          'study_fields', v_q -> 'studyFields', 'study_levels', v_q -> 'studyLevels', 'english', v_q -> 'english',
          'tuition_budget', v_q -> 'tuitionBudget', 'funding_source', v_q -> 'fundingSource'))));
    END IF;
  END IF;

  -- Слоты документов: сначала то, что требует действия; без файлов, версий и типов.
  SELECT count(*) INTO v_docs_total FROM platform.document_slots d
  WHERE d.organization_id = s.organization_id AND d.student_case_id = s.id AND d.removed_at IS NULL;
  SELECT jsonb_build_object('total', count(*), 'approved', count(*) FILTER (WHERE d.status = 'approved'),
      'not_uploaded', count(*) FILTER (WHERE d.status = 'required'), 'on_review', count(*) FILTER (WHERE d.status = 'submitted'),
      'need_correction', count(*) FILTER (WHERE d.status IN ('correction_required', 'rejected')))
  INTO v_docs_counts
  FROM platform.document_slots d
  WHERE d.organization_id = s.organization_id AND d.student_case_id = s.id AND d.removed_at IS NULL;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('slot_id', q.id, 'name', platform_private.ai_agent_dossier_cut(q.name, v_label_chars),
      'status', platform_private.ai_agent_dossier_word('document_status', q.status),
      'deadline', q.deadline_on) ORDER BY q.sort_rank, q.deadline_on NULLS LAST, q.created_at, q.id), '[]'::JSONB)
  INTO v_docs_json
  FROM (SELECT d.id, COALESCE(d.display_label, r.label, 'Документ') AS name, d.status::TEXT AS status, d.created_at,
      (d.deadline AT TIME ZONE 'Asia/Bishkek')::DATE AS deadline_on,
      CASE d.status::TEXT WHEN 'correction_required' THEN 1 WHEN 'rejected' THEN 2 WHEN 'required' THEN 3
        WHEN 'submitted' THEN 4 ELSE 5 END AS sort_rank
    FROM platform.document_slots d
    LEFT JOIN platform.document_requirements r ON r.organization_id = d.organization_id AND r.id = d.requirement_id
    WHERE d.organization_id = s.organization_id AND d.student_case_id = s.id AND d.removed_at IS NULL
    ORDER BY CASE d.status::TEXT WHEN 'correction_required' THEN 1 WHEN 'rejected' THEN 2 WHEN 'required' THEN 3
        WHEN 'submitted' THEN 4 ELSE 5 END,
      (d.deadline AT TIME ZONE 'Asia/Bishkek')::DATE NULLS LAST, d.created_at, d.id
    LIMIT v_docs) q;

  -- Заявки: вуз, программа, набор-ярлык; набор без постоянного id помечен.
  SELECT count(*) INTO v_apps_total FROM platform.university_applications u
  WHERE u.organization_id = s.organization_id AND u.student_case_id = s.id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('application_id', q.id, 'university', platform_private.ai_agent_dossier_cut(q.institution_name, v_label_chars),
      'program', platform_private.ai_agent_dossier_cut(q.program_name, v_label_chars),
      'intake_label', q.intake_label,
      'intake_identity', CASE WHEN q.has_binding THEN 'stable' ELSE 'missing' END,
      'status', platform_private.ai_agent_dossier_word('application_status', q.status),
      'primary', q.is_primary, 'deadline', q.university_deadline_on) ORDER BY q.created_at, q.id), '[]'::JSONB)
  INTO v_apps_json
  FROM (SELECT u.id, u.institution_name, u.program_name, u.status::TEXT AS status, u.is_primary, u.university_deadline_on,
      u.created_at, b.application_id IS NOT NULL AS has_binding,
      CASE WHEN b.application_id IS NOT NULL
        THEN (SELECT platform_private.ai_agent_dossier_cut(intake.value ->> 'label', 60)
          FROM platform_private.university_catalog_publications p
          CROSS JOIN LATERAL jsonb_array_elements(p.content -> 'programs') program(value)
          CROSS JOIN LATERAL jsonb_array_elements(program.value -> 'intakes') intake(value)
          WHERE p.id = b.publication_id AND program.value ->> 'id' = b.program_id AND intake.value ->> 'id' = b.intake_id::TEXT)
        ELSE NULLIF(platform_private.ai_agent_dossier_cut(btrim(COALESCE(s.intake, '')), 60), '') END AS intake_label
    FROM platform.university_applications u
    LEFT JOIN platform_private.catalog_preparation_bindings b ON b.organization_id = u.organization_id AND b.application_id = u.id
    WHERE u.organization_id = s.organization_id AND u.student_case_id = s.id
    ORDER BY u.created_at, u.id LIMIT v_apps) q;

  -- Деньги, блок «договор»: живые обязательства и платежи; архивные не считаются.
  SELECT count(*) FILTER (WHERE o.archived_at IS NULL), count(*) FILTER (WHERE o.archived_at IS NOT NULL)
  INTO v_obl_total, v_archived
  FROM platform.payment_obligations o WHERE o.organization_id = s.organization_id AND o.student_case_id = s.id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('currency', t.currency, 'planned', platform_private.ai_agent_money(t.planned),
      'paid_net', platform_private.ai_agent_money(t.paid), 'open', platform_private.ai_agent_money(t.open_minor),
      'overdue', platform_private.ai_agent_money(t.overdue_minor)) ORDER BY t.currency), '[]'::JSONB),
    COALESCE(sum(t.overdue_n), 0)::INTEGER
  INTO v_totals, v_overdue
  FROM (SELECT o.currency, sum(o.amount_minor) AS planned, sum(o.total_paid_minor - o.total_refunded_minor) AS paid,
      sum(greatest(o.amount_minor - (o.total_paid_minor - o.total_refunded_minor), 0)) AS open_minor,
      sum(greatest(o.amount_minor - (o.total_paid_minor - o.total_refunded_minor), 0))
        FILTER (WHERE o.due_at IS NOT NULL AND o.due_at < clock_timestamp()) AS overdue_minor,
      count(*) FILTER (WHERE o.due_at IS NOT NULL AND o.due_at < clock_timestamp()
        AND o.total_paid_minor - o.total_refunded_minor < o.amount_minor) AS overdue_n
    FROM platform.payment_obligations o
    WHERE o.organization_id = s.organization_id AND o.student_case_id = s.id AND o.archived_at IS NULL
    GROUP BY o.currency) t;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('obligation_id', q.id, 'label', platform_private.ai_agent_dossier_cut(q.label, v_label_chars),
      'kind', platform_private.ai_agent_dossier_word('obligation_category', q.category),
      'amount', platform_private.ai_agent_money(q.amount_minor), 'currency', q.currency,
      'paid_net', platform_private.ai_agent_money(q.paid), 'due_on', q.due_on,
      'status', platform_private.ai_agent_dossier_word('obligation_status', q.status)) ORDER BY q.sort_rank, q.due_on NULLS LAST, q.created_at, q.id), '[]'::JSONB)
  INTO v_obl_json
  FROM (SELECT o.id, o.label, o.category::TEXT AS category, o.amount_minor, o.currency, o.created_at,
      o.total_paid_minor - o.total_refunded_minor AS paid, (o.due_at AT TIME ZONE 'Asia/Bishkek')::DATE AS due_on,
      CASE WHEN o.total_paid_minor - o.total_refunded_minor >= o.amount_minor THEN 'paid'
        WHEN o.due_at IS NOT NULL AND o.due_at < clock_timestamp() THEN 'overdue'
        WHEN o.total_paid_minor - o.total_refunded_minor > 0 THEN 'partially_paid' ELSE 'pending' END AS status,
      CASE WHEN o.total_paid_minor - o.total_refunded_minor >= o.amount_minor THEN 3
        WHEN o.due_at IS NOT NULL AND o.due_at < clock_timestamp() THEN 1 ELSE 2 END AS sort_rank
    FROM platform.payment_obligations o
    WHERE o.organization_id = s.organization_id AND o.student_case_id = s.id AND o.archived_at IS NULL
    ORDER BY CASE WHEN o.total_paid_minor - o.total_refunded_minor >= o.amount_minor THEN 3
        WHEN o.due_at IS NOT NULL AND o.due_at < clock_timestamp() THEN 1 ELSE 2 END,
      o.due_at NULLS LAST, o.created_at, o.id
    LIMIT v_obl) q;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('on', (e.occurred_at AT TIME ZONE 'Asia/Bishkek')::DATE,
      'kind', platform_private.ai_agent_dossier_word('payment_event', e.event_type::TEXT),
      'amount', platform_private.ai_agent_money(e.amount_minor), 'currency', e.currency,
      'for', platform_private.ai_agent_dossier_cut(e.label, 60)) ORDER BY e.occurred_at DESC, e.id DESC), '[]'::JSONB)
  INTO v_pay_json
  FROM (SELECT pe.id, pe.occurred_at, pe.event_type, pe.amount_minor, pe.currency, o.label
    FROM platform.payment_events pe
    JOIN platform.payment_obligations o ON o.organization_id = pe.organization_id AND o.id = pe.payment_obligation_id
    WHERE pe.organization_id = s.organization_id AND pe.student_case_id = s.id AND o.archived_at IS NULL
    ORDER BY pe.occurred_at DESC, pe.id DESC LIMIT v_pay) e;
  v_contract := jsonb_build_object(
    'label', 'Договор: живые платежи и обязательства студента (архивные не считаются)',
    'totals_by_currency', v_totals, 'overdue_count', v_overdue, 'obligations_total', v_obl_total,
    'archived_excluded', v_archived, 'obligations', v_obl_json, 'last_payments', v_pay_json);
  v_money := jsonb_build_object(
    'rule', 'Три блока не складывать и не сверять между собой: условия продажи до договора, договор и цены каталога разные вещи',
    'sale_conditions', v_cond,
    'contract', v_contract,
    'catalog', jsonb_build_object('note', 'не долг клиента',
      'meaning', 'Цены каталога вузов справочные и в долг клиента не входят'));

  -- Открытые задачи дела.
  SELECT count(*) INTO v_tasks_total FROM platform.case_tasks x
  WHERE x.organization_id = s.organization_id AND x.student_case_id = s.id AND x.status IN ('open', 'in_progress', 'blocked');
  SELECT COALESCE(jsonb_agg(jsonb_build_object('task_id', t.id, 'title', platform_private.ai_agent_dossier_cut(t.title, v_label_chars),
      'assignee_name', platform_private.ai_agent_dossier_name(t.organization_id, t.assignee_membership_id),
      'status', platform_private.ai_agent_dossier_word('task_status', t.status::TEXT),
      'important', t.priority::TEXT IN ('high', 'urgent'),
      'due_on', t.due_on_eff,
      'overdue', t.due_on_eff IS NOT NULL AND t.due_on_eff < v_today)
      || CASE WHEN platform_private.ai_agent_dossier_word('task_priority', t.priority::TEXT) IS NULL THEN '{}'::JSONB
        ELSE jsonb_build_object('priority', platform_private.ai_agent_dossier_word('task_priority', t.priority::TEXT)) END
      ORDER BY t.due_on_eff NULLS LAST, t.created_at DESC), '[]'::JSONB)
  INTO v_tasks_json
  FROM (SELECT x.*, COALESCE(x.due_on, (x.due_at AT TIME ZONE 'Asia/Bishkek')::DATE) AS due_on_eff
    FROM platform.case_tasks x
    WHERE x.organization_id = s.organization_id AND x.student_case_id = s.id AND x.status IN ('open', 'in_progress', 'blocked')
    ORDER BY COALESCE(x.due_on, (x.due_at AT TIME ZONE 'Asia/Bishkek')::DATE) NULLS LAST, x.created_at DESC LIMIT v_tasks) t;

  -- Заметки дела.
  SELECT count(*) INTO v_notes_total FROM platform.case_notes x
  WHERE x.organization_id = s.organization_id AND x.student_case_id = s.id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('at', n.created_at,
      'author', platform_private.ai_agent_dossier_name(n.organization_id, n.created_by_membership_id),
      'text', platform_private.ai_agent_dossier_cut(n.body, v_note_chars)) ORDER BY n.created_at DESC), '[]'::JSONB)
  INTO v_notes_json
  FROM (SELECT x.* FROM platform.case_notes x WHERE x.organization_id = s.organization_id AND x.student_case_id = s.id
    ORDER BY x.created_at DESC LIMIT v_notes) n;

  -- Чат кабинета: только при согласии студента (320).
  v_chat_allowed := platform_private.ai_agent_student_ai_allowed(s.organization_id, s.id);
  IF NOT v_chat_allowed THEN
    v_chat_json := jsonb_build_object('available', FALSE, 'reason', 'ai_consent_missing');
  ELSE
    SELECT count(*) INTO v_chat_total FROM platform.case_chat_messages x
    WHERE x.organization_id = s.organization_id AND x.student_case_id = s.id;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('at', m.created_at,
        'author', CASE WHEN m.author_membership_id IS NOT DISTINCT FROM s.student_membership_id THEN 'student'
          WHEN EXISTS (SELECT 1 FROM platform_private.ai_agent_drafts d WHERE d.organization_id = m.organization_id
            AND d.student_case_id = m.student_case_id AND d.provider ->> 'messageId' = m.id::TEXT) THEN 'ai_agent'
          ELSE 'staff' END,
        'author_name', platform_private.ai_agent_dossier_name(m.organization_id, m.author_membership_id),
        'text', platform_private.ai_agent_dossier_cut(m.body, v_chat_chars)) ORDER BY m.created_at, m.id), '[]'::JSONB), count(*)::INTEGER
    INTO v_chat_json, v_shown
    FROM (SELECT x.* FROM platform.case_chat_messages x
      WHERE x.organization_id = s.organization_id AND x.student_case_id = s.id
      ORDER BY x.created_at DESC, x.id DESC LIMIT v_chat) m;
    v_chat_json := jsonb_build_object('available', TRUE, 'messages_total', v_chat_total, 'messages', v_chat_json);
    IF v_chat_total > v_shown THEN v_omitted := v_omitted || jsonb_build_object('chat_messages', v_chat_total - v_shown); END IF;
  END IF;

  IF v_docs_total > jsonb_array_length(v_docs_json) THEN
    v_omitted := v_omitted || jsonb_build_object('documents', v_docs_total - jsonb_array_length(v_docs_json)); END IF;
  IF v_apps_total > jsonb_array_length(v_apps_json) THEN
    v_omitted := v_omitted || jsonb_build_object('applications', v_apps_total - jsonb_array_length(v_apps_json)); END IF;
  IF v_tasks_total > jsonb_array_length(v_tasks_json) THEN
    v_omitted := v_omitted || jsonb_build_object('open_tasks', v_tasks_total - jsonb_array_length(v_tasks_json)); END IF;
  IF v_notes_total > jsonb_array_length(v_notes_json) THEN
    v_omitted := v_omitted || jsonb_build_object('notes', v_notes_total - jsonb_array_length(v_notes_json)); END IF;
  IF v_obl_total > jsonb_array_length(v_obl_json) THEN
    v_omitted := v_omitted || jsonb_build_object('obligations', v_obl_total - jsonb_array_length(v_obl_json)); END IF;

  IF NOT v_with_qa AND EXISTS (SELECT 1 FROM platform_private.student_applications x
      WHERE x.organization_id = s.organization_id
        AND (x.id = s.public_application_id OR x.student_case_id = s.id OR x.invited_case_id = s.id)) THEN
    v_omitted := v_omitted || jsonb_build_object('questionnaire', 1);
  END IF;

  v_res := jsonb_build_object(
    'case', jsonb_build_object('case_id', s.id, 'student_name', platform_private.ai_agent_dossier_cut(s.student_display_name, 200),
      'state', platform_private.ai_agent_dossier_word('case_state', s.state::TEXT),
      'curator_name', platform_private.ai_agent_dossier_name(s.organization_id, s.current_curator_membership_id),
      'sales_name', platform_private.ai_agent_dossier_name(s.organization_id, s.responsible_sales_membership_id),
      'country', v_country, 'degree', COALESCE(platform_private.ai_agent_dossier_word('degree', lower(btrim(COALESCE(s.target_degree, '')))),
        NULLIF(platform_private.ai_agent_dossier_cut(btrim(COALESCE(s.target_degree, '')), 60), '')),
      'direction', platform_private.ai_agent_dossier_word('direction', s.admissions_direction),
      'intake_written', NULLIF(platform_private.ai_agent_dossier_cut(btrim(COALESCE(s.intake, '')), 60), ''),
      'handed_off_at', s.handoff_at, 'created_at', s.created_at, 'updated_at', s.updated_at),
    'process_stage', jsonb_build_object('label', 'Этап процесса (по плейбуку приёмной)', 'word', v_process_word),
    'board_column', jsonb_build_object('label', 'Колонка доски кураторов «Воронка поступления»', 'word', v_board_word),
    'timeline_step', NULL,
    'stage_mismatch', v_mismatch,
    'stage_mismatch_note', v_mismatch_note,
    'keys', jsonb_build_object('operational_stage', s.operational_stage, 'pipeline_stage', s.pipeline_stage,
      'country_code', v_country_code, 'admissions_direction', s.admissions_direction, 'state', s.state::TEXT),
    'next_step', v_next,
    'questionnaire', v_qa,
    'documents', jsonb_build_object('counts', v_docs_counts, 'slots', v_docs_json),
    'applications', v_apps_json,
    'money', v_money,
    'open_tasks', v_tasks_json,
    'notes', v_notes_json,
    'portal_chat', v_chat_json,
    'lead', v_lead_json,
    'counts', jsonb_build_object('documents', v_docs_total, 'applications', v_apps_total, 'open_tasks', v_tasks_total,
      'notes', v_notes_total));
  v_cut := (char_length(v_res::TEXT) - char_length(replace(v_res::TEXT, '[…]"', ''))) / char_length('[…]"');
  IF v_cut > 0 THEN v_omitted := v_omitted || jsonb_build_object('text_cut', v_cut); END IF;
  RETURN v_res || jsonb_build_object('truncated', v_omitted <> '{}'::JSONB, 'omitted', v_omitted);
END
$$;

-- Аварийная минимальная форма: если даже самый сжатый уровень выше потолка, остаются карточка, этапы, ключи и числа, а
-- в omitted стоит `size_ceiling`. На деле сюда не попадают (имена и подписи ограничены), но потолок обещан безусловно.
CREATE FUNCTION platform_private.ai_agent_dossier_minimal(p_out JSONB, p_kind TEXT)
RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT (CASE p_kind
      WHEN 'lead' THEN jsonb_build_object('lead', p_out -> 'lead', 'keys', p_out -> 'keys', 'case', p_out -> 'case',
        'counts', p_out -> 'counts')
      ELSE jsonb_build_object('case', p_out -> 'case', 'process_stage', p_out -> 'process_stage',
        'board_column', p_out -> 'board_column', 'timeline_step', NULL, 'stage_mismatch', p_out -> 'stage_mismatch',
        'keys', p_out -> 'keys', 'counts', p_out -> 'counts') END)
    || jsonb_build_object('truncated', TRUE,
      'omitted', COALESCE(p_out -> 'omitted', '{}'::JSONB) || jsonb_build_object('size_ceiling', TRUE))
$$;

-- ---------------------------------------------------------------------------
-- 5. Инструменты (service_role).
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.ai_agent_tool_get_lead_dossier_v1(p_organization_id UUID, p_agent_key TEXT, p_args JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a platform_private.ai_agents; l platform.leads; v_out JSONB; v_level INTEGER := 0;
  v_ceiling CONSTANT INTEGER := 6000;
BEGIN
  a := platform_private.ai_agent_tool_begin(p_organization_id, p_agent_key, 'get_lead_dossier', p_args);
  SELECT * INTO l FROM platform.leads x WHERE x.organization_id = p_organization_id AND x.id = (p_args ->> 'lead_id')::UUID;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Аудит чтения в этой же транзакции, до выдачи данных (как у get_lead).
  PERFORM platform_private.ai_agent_audit_read(p_organization_id, p_agent_key, 'get_lead_dossier', 'lead', l.id);
  LOOP
    v_out := platform_private.ai_agent_lead_dossier_build(p_organization_id, l.id, v_level);
    EXIT WHEN char_length(v_out::TEXT) <= v_ceiling OR v_level >= 4;
    v_level := v_level + 1;
  END LOOP;
  IF char_length(v_out::TEXT) > v_ceiling THEN
    v_out := platform_private.ai_agent_dossier_minimal(v_out, 'lead');
  END IF;
  RETURN v_out;
END
$$;

CREATE FUNCTION platform.ai_agent_tool_get_case_dossier_v1(p_organization_id UUID, p_agent_key TEXT, p_args JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a platform_private.ai_agents; s platform.student_cases; v_out JSONB; v_level INTEGER := 0;
  -- 11500, а не 12000: приложение подмешивает объект шага пути (~300 символов), итог остаётся в 12000.
  v_ceiling CONSTANT INTEGER := 11500;
BEGIN
  a := platform_private.ai_agent_tool_begin(p_organization_id, p_agent_key, 'get_case_dossier', p_args);
  SELECT * INTO s FROM platform.student_cases x WHERE x.organization_id = p_organization_id AND x.id = (p_args ->> 'case_id')::UUID;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM platform_private.ai_agent_audit_read(p_organization_id, p_agent_key, 'get_case_dossier', 'student_case', s.id);
  LOOP
    v_out := platform_private.ai_agent_case_dossier_build(p_organization_id, s.id, v_level);
    EXIT WHEN char_length(v_out::TEXT) <= v_ceiling OR v_level >= 4;
    v_level := v_level + 1;
  END LOOP;
  IF char_length(v_out::TEXT) > v_ceiling THEN
    v_out := platform_private.ai_agent_dossier_minimal(v_out, 'case');
  END IF;
  RETURN v_out;
END
$$;

-- ---------------------------------------------------------------------------
-- 6. Права: как у всех инструментов агентов (317 / 319): инструменты только service_role, помощники никому.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  platform.ai_agent_tool_get_lead_dossier_v1(UUID, TEXT, JSONB),
  platform.ai_agent_tool_get_case_dossier_v1(UUID, TEXT, JSONB),
  platform_private.ai_agent_lead_dossier_build(UUID, UUID, INTEGER),
  platform_private.ai_agent_case_dossier_build(UUID, UUID, INTEGER),
  platform_private.ai_agent_dossier_word(TEXT, TEXT),
  platform_private.ai_agent_dossier_expected_boards(TEXT),
  platform_private.ai_agent_dossier_amount(BIGINT, TEXT, TEXT),
  platform_private.ai_agent_dossier_answer(JSONB),
  platform_private.ai_agent_dossier_cut(TEXT, INTEGER),
  platform_private.ai_agent_dossier_name(UUID, UUID),
  platform_private.ai_agent_dossier_minimal(JSONB, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
GRANT EXECUTE ON FUNCTION
  platform.ai_agent_tool_get_lead_dossier_v1(UUID, TEXT, JSONB),
  platform.ai_agent_tool_get_case_dossier_v1(UUID, TEXT, JSONB) TO service_role;

COMMENT ON FUNCTION platform.ai_agent_tool_get_lead_dossier_v1(UUID, TEXT, JSONB) IS
  '382: досье лида одним вызовом (потолок 6000 символов JSON); переписка WhatsApp только при согласии 320.';
COMMENT ON FUNCTION platform.ai_agent_tool_get_case_dossier_v1(UUID, TEXT, JSONB) IS
  '382: досье дела одним вызовом (потолок 11500 символов в базе); три этапа отдельными полями, деньги тремя блоками.';

-- ---------------------------------------------------------------------------
-- Проверка в конце: права, определитель, пустой search_path, строки схем.
-- ---------------------------------------------------------------------------
DO $a382_verify$
DECLARE f REGPROCEDURE;
BEGIN
  -- Только свои строки: параллельные PR добавляют свои инструменты, общее число здесь не проверяется.
  IF (SELECT count(*) FROM platform_private.ai_agent_tool_schemas
        WHERE tool IN ('get_lead_dossier', 'get_case_dossier') AND kind = 'read' AND audit = 'read') <> 2 THEN
    RAISE EXCEPTION 'a382_verify_schema' USING ERRCODE = '55000';
  END IF;
  FOREACH f IN ARRAY ARRAY[
    'platform.ai_agent_tool_get_lead_dossier_v1(uuid,text,jsonb)'::REGPROCEDURE,
    'platform.ai_agent_tool_get_case_dossier_v1(uuid,text,jsonb)'::REGPROCEDURE,
    'platform_private.ai_agent_lead_dossier_build(uuid,uuid,integer)'::REGPROCEDURE,
    'platform_private.ai_agent_case_dossier_build(uuid,uuid,integer)'::REGPROCEDURE] LOOP
    IF (SELECT p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[] OR NOT p.prosecdef
        FROM pg_catalog.pg_proc p WHERE p.oid = f) THEN
      RAISE EXCEPTION 'a382_verify_function: %', f USING ERRCODE = '55000';
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY[
    'platform.ai_agent_tool_get_lead_dossier_v1(uuid,text,jsonb)'::REGPROCEDURE,
    'platform.ai_agent_tool_get_case_dossier_v1(uuid,text,jsonb)'::REGPROCEDURE] LOOP
    IF NOT has_function_privilege('service_role', f::OID, 'EXECUTE')
      OR has_function_privilege('authenticated', f::OID, 'EXECUTE') OR has_function_privilege('anon', f::OID, 'EXECUTE')
      OR has_function_privilege('evo_ai_agent', f::OID, 'EXECUTE') THEN
      RAISE EXCEPTION 'a382_verify_tool_grant: %', f USING ERRCODE = '55000';
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY[
    'platform_private.ai_agent_lead_dossier_build(uuid,uuid,integer)'::REGPROCEDURE,
    'platform_private.ai_agent_case_dossier_build(uuid,uuid,integer)'::REGPROCEDURE,
    'platform_private.ai_agent_dossier_word(text,text)'::REGPROCEDURE,
    'platform_private.ai_agent_dossier_expected_boards(text)'::REGPROCEDURE,
    'platform_private.ai_agent_dossier_amount(bigint,text,text)'::REGPROCEDURE,
    'platform_private.ai_agent_dossier_answer(jsonb)'::REGPROCEDURE,
    'platform_private.ai_agent_dossier_cut(text,integer)'::REGPROCEDURE,
    'platform_private.ai_agent_dossier_name(uuid,uuid)'::REGPROCEDURE,
    'platform_private.ai_agent_dossier_minimal(jsonb,text)'::REGPROCEDURE] LOOP
    IF has_function_privilege('service_role', f::OID, 'EXECUTE') OR has_function_privilege('authenticated', f::OID, 'EXECUTE')
      OR has_function_privilege('anon', f::OID, 'EXECUTE') OR has_function_privilege('evo_ai_agent', f::OID, 'EXECUTE')
      OR has_function_privilege('supabase_auth_admin', f::OID, 'EXECUTE') THEN
      RAISE EXCEPTION 'a382_verify_helper_grant: %', f USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$a382_verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
