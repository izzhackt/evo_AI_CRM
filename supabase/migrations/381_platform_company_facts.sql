-- 381: «ИИ-агенты»: «мозг компании» - проверенные факты со сроком годности отдельно от инструкций
-- (docs/PLAN_CHANGES.md, ночная работа «ИИ-агенты: мозг компании, досье и предохранители», 28.11.2026;
-- решение владельца: перенести данные из инструкций как есть). Дату, цену или срок меняют в одном
-- месте, и все агенты сразу видят новое значение: инструмент `get_company_facts` отдаёт только
-- действующие, непросроченные факты. Тексты инструкций (порядок работы) в этой миграции НЕ меняются:
-- «похудение» промптов - следующий PR по карте переноса docs/design/ai-agents/facts-seed-map.md.
--
-- Forward-only. Новые объекты:
--   * закрытая таблица `platform_private.company_facts` (FORCE RLS без политик и без грантов API, как таблицы 317):
--     тема (`course.sat.group`, `promise.admission`, `calendar.cn.<что>`), текст на русском (+ кыргызский, английский),
--     аудитория (`client` / `internal`), источник, дата проверки, срок годности, версия (`supersedes_id`), статус
--     (`active` / `draft` / `retired`). Одна действующая строка на (организация, тема, аудитория);
--   * три функции сотрудника (EXECUTE только authenticated, SECURITY DEFINER, пустой search_path):
--     `ai_company_facts_list_v1` (право `ai.agent.use`; просроченные показываются с пометкой),
--     `ai_company_facts_save_v1` и `ai_company_facts_retire_v1` (право `ai.agent.manage`; правка создаёт новую версию,
--     прежняя становится `retired`; «Проверено» = сегодня по Бишкеку и сотрудник; запись в журнале платформы без текстов,
--     повтор по `request_id` возвращает прежний итог);
--   * инструмент агента `platform.ai_agent_tool_get_company_facts_v1` (EXECUTE только service_role; начало через
--     `ai_agent_tool_begin`: агент выключен -> `agent_disabled`, аргументы по схеме) и его строка в
--     `platform_private.ai_agent_tool_schemas` (зеркало `AI_AGENT_TOOLS` из `src/lib/ai-agents/contract.ts`);
--   * журнал: действие `ai.fact.change`, тип объекта `ai_company_fact` (rename-and-union, как 317);
--   * посев `platform_private.company_facts_seed(организация)`: 70 фактов из `src/content/ai-agents/<ключ>/*.md`
--     (`source = 'agent_instruction'`, `source_ref` называет файл и раздел), идемпотентно (`ON CONFLICT DO NOTHING`);
--     применён к каждой организации.
--
-- Порядок выката. Миграция идёт ДО приложения: приложение без неё показывает «Раздел готовится» (PGRST202), а агенты
-- без инструмента работают как раньше. Повторный запуск: a381_already_applied (55000).
BEGIN;

-- ---------------------------------------------------------------------------
-- Якоря: объекты 317, на которые опирается миграция, и отказ при повторном применении.
-- ---------------------------------------------------------------------------
DO $a381_anchor$
BEGIN
  IF to_regclass('platform.organizations') IS NULL
    OR to_regclass('platform.audit_events') IS NULL
    OR to_regclass('platform_private.ai_agents') IS NULL
    OR to_regclass('platform_private.ai_agent_tool_schemas') IS NULL
    OR to_regprocedure('platform_private.ai_staff_actor(uuid,text)') IS NULL
    OR to_regprocedure('platform_private.ai_agent_audit(uuid,uuid,text,text,text,uuid,jsonb,jsonb,text,uuid)') IS NULL
    OR to_regprocedure('platform_private.ai_agent_tool_begin(uuid,text,text,jsonb)') IS NULL
    OR to_regprocedure('platform_private.ai_agent_member_name(uuid,uuid)') IS NULL
    OR to_regprocedure('platform_private.ai_agent_clean_text(text)') IS NULL
    OR to_regprocedure('platform_private.ai_agent_text_ok(text,integer)') IS NULL
    OR to_regprocedure('platform_private.ai_agent_sha256(text)') IS NULL
    OR to_regprocedure('platform_private.p7a_safe_audit_actions()') IS NULL
    OR to_regprocedure('platform_private.p7a_safe_audit_resource_types()') IS NULL THEN
    RAISE EXCEPTION 'a381_anchor_drift: the 317 objects this migration builds on are missing' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('platform_private.company_facts') IS NOT NULL
    OR to_regprocedure('platform.ai_company_facts_list_v1(uuid,text,text,text,integer)') IS NOT NULL
    OR to_regprocedure('platform.ai_agent_tool_get_company_facts_v1(uuid,text,jsonb)') IS NOT NULL
    OR to_regprocedure('platform_private.p7a_safe_audit_actions_pre_company_facts()') IS NOT NULL
    OR to_regprocedure('platform_private.p7a_safe_audit_resource_types_pre_company_facts()') IS NOT NULL
    OR 'ai.fact.change' = ANY (platform_private.p7a_safe_audit_actions())
    OR 'ai_company_fact' = ANY (platform_private.p7a_safe_audit_resource_types())
    OR EXISTS (SELECT 1 FROM platform_private.ai_agent_tool_schemas s WHERE s.tool = 'get_company_facts') THEN
    RAISE EXCEPTION 'a381_already_applied' USING ERRCODE = '55000';
  END IF;
END
$a381_anchor$;

-- ---------------------------------------------------------------------------
-- A. Таблица фактов.
-- ---------------------------------------------------------------------------
CREATE TABLE platform_private.company_facts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  topic TEXT NOT NULL,
  statement_ru TEXT NOT NULL,
  statement_ky TEXT,
  statement_en TEXT,
  audience TEXT NOT NULL,
  source TEXT NOT NULL,
  source_ref TEXT,
  verified_at DATE NOT NULL,
  valid_until DATE,
  supersedes_id UUID REFERENCES platform_private.company_facts(id) ON DELETE RESTRICT,
  verified_by_membership_id UUID,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_by_membership_id UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_by_membership_id UUID,
  CONSTRAINT company_facts_topic_check CHECK (char_length(topic) BETWEEN 3 AND 120
    AND topic ~ '^[a-z0-9]+(\.[a-z0-9_-]+)+$'),
  CONSTRAINT company_facts_statement_check CHECK (char_length(statement_ru) BETWEEN 1 AND 1500
    AND (statement_ky IS NULL OR char_length(statement_ky) BETWEEN 1 AND 1500)
    AND (statement_en IS NULL OR char_length(statement_en) BETWEEN 1 AND 1500)),
  CONSTRAINT company_facts_audience_check CHECK (audience IN ('client', 'internal')),
  CONSTRAINT company_facts_source_check CHECK (source IN ('owner', 'agent_instruction', 'kb_node', 'catalog_cost', 'timeline', 'contract')),
  CONSTRAINT company_facts_source_ref_check CHECK (source_ref IS NULL OR char_length(source_ref) BETWEEN 1 AND 300),
  CONSTRAINT company_facts_status_check CHECK (status IN ('active', 'draft', 'retired')),
  CONSTRAINT company_facts_dates_check CHECK (valid_until IS NULL OR valid_until >= verified_at),
  CONSTRAINT company_facts_supersedes_check CHECK (supersedes_id IS NULL OR supersedes_id <> id)
);
-- Одна действующая строка на (организация, тема, аудитория): правка = старая `retired`, новая `active`.
CREATE UNIQUE INDEX company_facts_active_key ON platform_private.company_facts (organization_id, topic, audience)
  WHERE status = 'active';
CREATE INDEX company_facts_org_topic_idx ON platform_private.company_facts (organization_id, status, topic, audience);
CREATE INDEX company_facts_supersedes_idx ON platform_private.company_facts (supersedes_id) WHERE supersedes_id IS NOT NULL;

ALTER TABLE platform_private.company_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.company_facts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE platform_private.company_facts
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;

-- ---------------------------------------------------------------------------
-- B. Помощники (platform_private, без грантов).
-- ---------------------------------------------------------------------------
-- Сегодня по Бишкеку (UTC+6, без перехода на летнее время): по этой дате факт «просрочен» и «Проверено».
CREATE FUNCTION platform_private.company_facts_today()
RETURNS DATE LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (clock_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE
$$;

-- Факт в ответе сотруднику (camelCase). `validity`: unlimited / ok / expiring (до 30 дней) / expired.
CREATE FUNCTION platform_private.company_fact_json(f platform_private.company_facts, p_today DATE)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', f.id, 'topic', f.topic, 'statementRu', f.statement_ru, 'statementKy', f.statement_ky, 'statementEn', f.statement_en,
    'audience', f.audience, 'source', f.source, 'sourceRef', f.source_ref,
    'verifiedAt', f.verified_at, 'validUntil', f.valid_until, 'supersedesId', f.supersedes_id,
    'verifiedByMembershipId', f.verified_by_membership_id,
    'verifiedByName', platform_private.ai_agent_member_name(f.organization_id, f.verified_by_membership_id),
    'status', f.status,
    'validity', CASE WHEN f.valid_until IS NULL THEN 'unlimited' WHEN f.valid_until < p_today THEN 'expired'
      WHEN f.valid_until <= p_today + 30 THEN 'expiring' ELSE 'ok' END,
    'daysLeft', CASE WHEN f.valid_until IS NULL THEN NULL ELSE f.valid_until - p_today END,
    'createdAt', f.created_at, 'updatedAt', f.updated_at)
$$;

-- Посев из инструкций агентов (src/content/ai-agents/<ключ>/*.md): идемпотентно, возвращает число вставленных строк.
-- Карта «файл и раздел -> тема» - docs/design/ai-agents/facts-seed-map.md.
CREATE FUNCTION platform_private.company_facts_seed(p_organization_id UUID)
RETURNS INTEGER LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_inserted INTEGER;
BEGIN
  INSERT INTO platform_private.company_facts (organization_id, topic, statement_ru, audience, source, source_ref,
    verified_at, valid_until, status)
  SELECT p_organization_id, s.topic, s.statement_ru, s.audience, 'agent_instruction', s.source_ref,
    s.verified_at, s.valid_until, 'active'
  FROM jsonb_to_recordset($seed$[
  {"topic":"course.sat.group","audience":"client","source_ref":"src/content/ai-agents/sales/rules.md#Курсы IELTS, SAT и подготовка к CSCA","verified_at":"2026-10-23","valid_until":"2026-12-31","statement_ru":"Групповой курс SAT: 10 недель, 299 долларов США вместо обычных 349. Цены даны в долларах США, в другие валюты не пересчитывать. Данные владельца на 23 октября 2026 года."},
  {"topic":"course.ielts.group","audience":"client","source_ref":"src/content/ai-agents/sales/rules.md#Курсы IELTS, SAT и подготовка к CSCA","verified_at":"2026-10-23","valid_until":"2026-12-31","statement_ru":"Групповой курс IELTS: 8 недель, 249 долларов США вместо обычных 299. Цены даны в долларах США, в другие валюты не пересчитывать. Данные владельца на 23 октября 2026 года."},
  {"topic":"course.group.size","audience":"client","source_ref":"src/content/ai-agents/sales/rules.md#Курсы IELTS, SAT и подготовка к CSCA","verified_at":"2026-10-23","valid_until":"2026-12-31","statement_ru":"В группе курсов SAT и IELTS не больше 12 человек: можно говорить, что группы маленькие."},
  {"topic":"course.discount.last_seats","audience":"client","source_ref":"src/content/ai-agents/sales/rules.md#Курсы IELTS, SAT и подготовка к CSCA","verified_at":"2026-10-23","valid_until":"2026-12-31","statement_ru":"Скидка 50 долларов США на курсы SAT и IELTS действует для тех, кто успеет занять последние места нового потока. Даты окончания скидки и числа свободных мест нет: не называть ни дату, ни цифру, на такой вопрос отвечать «уточню у менеджера». Срочность не придумывать: никаких «осталось два места» и «скидка до пятницы»."},
  {"topic":"course.trial.free","audience":"client","source_ref":"src/content/ai-agents/sales/rules.md#Курсы IELTS, SAT и подготовка к CSCA","verified_at":"2026-10-23","valid_until":"2026-12-31","statement_ru":"Сначала бесплатный пробный урок: на нём клиент видит формат занятий. Приглашение на урок присылает менеджер. Ссылки на урок и времени урока нет: не придумывать их и не пересылать чужие."},
  {"topic":"course.goal.results","audience":"client","source_ref":"src/content/ai-agents/sales/rules.md#Курсы IELTS, SAT и подготовка к CSCA","verified_at":"2026-10-23","valid_until":"2026-12-31","statement_ru":"Цель курса можно назвать так: набрать 1500 и больше по SAT или получить высокий балл по IELTS. Это стремление, а не обещание: балл и результат EVO не гарантирует. Средние баллы и успехи выпускников не приводить: подтверждённых данных нет."},
  {"topic":"course.exams.registration","audience":"client","source_ref":"src/content/ai-agents/sales/rules.md#Курсы IELTS, SAT и подготовка к CSCA","verified_at":"2026-10-23","valid_until":"2026-12-31","statement_ru":"Регистрацию на экзамены, включая CSCA, студент делает сам на официальном сайте экзамена; EVO не регистрирует и не принимает для этого данные. EVO не партнёр, не центр тестирования и не представитель организаторов SAT и IELTS. Даты и места экзаменов клиент проверяет на сайте организатора, даты экзаменов не называть."},
  {"topic":"course.csca.prep","audience":"internal","source_ref":"src/content/ai-agents/sales/rules.md#Курсы IELTS, SAT и подготовка к CSCA","verified_at":"2026-10-23","valid_until":"2026-12-31","statement_ru":"Подготовка к CSCA: цена, длительность и условия группы пока не заданы. Клиенту отвечать «уточню у менеджера и вернусь с точной информацией» и ставить задачу сотруднику."},
  {"topic":"course.schedule.source","audience":"internal","source_ref":"src/content/ai-agents/sales/rules.md#Курсы IELTS, SAT и подготовка к CSCA","verified_at":"2026-10-23","valid_until":"2026-12-31","statement_ru":"Даты старта потока, расписание, формат (онлайн или очно) и язык занятий в карточке курсов не указаны: брать из базы знаний, а если там нет, уточнять у менеджера."},
  {"topic":"promise.admission","audience":"client","source_ref":"src/content/ai-agents/_shared/preamble.md#Нельзя обещать и выдумывать","verified_at":"2026-10-23","valid_until":"2026-12-31","statement_ru":"EVO не гарантирует поступление, визу, стипендию, сроки решений университета, посольства и других третьих сторон и балл на экзамене. Поступление решает университет, визу посольство, стипендию её организатор. EVO отвечает за свою работу: подбор программы, проверку документов, подачу и сопровождение. Условия договора обсуждает менеджер."},
  {"topic":"promise.consultation.free","audience":"client","source_ref":"src/content/ai-agents/sales/rules.md#Что знаешь и чего не знаешь","verified_at":"2026-10-23","valid_until":"2026-12-31","statement_ru":"Первая консультация в EVO бесплатная. Это главный следующий шаг для клиента; формулировку перед ответом сверять с базой знаний."},
  {"topic":"promise.refund_installment","audience":"client","source_ref":"src/content/ai-agents/sales/rules.md#Возражения","verified_at":"2026-10-23","valid_until":"2026-12-31","statement_ru":"Возврат, рассрочку и дополнительные скидки EVO не обещает: это решение менеджера. Реквизиты и ссылки на оплату агент не даёт и оплату не подтверждает."},
  {"topic":"promise.discount_not_scholarship","audience":"client","source_ref":"src/content/ai-agents/_shared/preamble.md#Красные линии","verified_at":"2026-10-23","valid_until":"2026-12-31","statement_ru":"Скидку агента или партнёрскую скидку никогда не называть стипендией. Стипендию и грант решает только их организатор, EVO о них ничего не гарантирует."},
  {"topic":"metric.funnel.stuck_lead","audience":"internal","source_ref":"src/content/ai-agents/director/rules.md#Что смотреть и как читать","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"Застрявший лид: без движения по этапам больше 7 дней. Его долю считать от открытых лидов и показывать самых старых. Выборка меньше 10 наблюдений считается малой: вывод ориентировочный."},
  {"topic":"promise.cn.applications_by_evo","audience":"client","source_ref":"src/content/ai-agents/curator-cn/role.md#Кто ты и зачем","verified_at":"2026-10-23","valid_until":"2026-12-31","statement_ru":"Заявки в вузы Китая и на стипендию CSC подаёт сама EVO: куратор по документам студента, без партнёра и посредника. Решение принимают вуз, CSC и посольство, поэтому зачисление, стипендию и визу EVO не гарантирует."},
  {"topic":"promise.cn.response_times","audience":"client","source_ref":"src/content/ai-agents/curator-cn/rules.md#Общение со студентом","verified_at":"2026-10-23","valid_until":"2026-12-31","statement_ru":"Куратор отвечает в рабочее время в течение 4 часов. Студент в сезон подачи (ноябрь-апрель) отвечает в течение 1 дня и выполняет задачи в согласованные сроки; важные договорённости дублируются письменно."},
  {"topic":"process.cn.application_form","audience":"client","source_ref":"src/content/ai-agents/curator-cn/rules.md#Этапы дела","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"Анкету вуза (Application Form) заполняет куратор по документам студента. Студент сам её не заполняет, но обязан проверить имя, дату рождения и номер документа в готовой анкете."},
  {"topic":"process.cn.universities_count","audience":"client","source_ref":"src/content/ai-agents/curator-cn/rules.md#Частые вопросы студентов (безопасные ответы)","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"Куратор предлагает 2-4 вуза, обычно 3, с разным уровнем конкурса. Студент обсуждает список с родителями и подтверждает письменно. Сам подавать в понравившийся вуз можно только после согласования с куратором."},
  {"topic":"exam.cn.csca","audience":"client","source_ref":"src/content/ai-agents/curator-cn/rules.md#Экзамены","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"На бакалавриат почти наверняка нужен CSCA до подачи заявки, плюс языковой экзамен. Предметы CSCA выбираются по вузу и специальности (китайский язык для гуманитарных или точных наук, математика, физика, химия). Регистрация только на официальном сайте экзамена, студент делает её сам, имя пишет как в загранпаспорте. Расписание сессий и открытие регистрации проверять у сотрудника и в базе знаний: сессии меняются."},
  {"topic":"exam.cn.language_scores","audience":"client","source_ref":"src/content/ai-agents/curator-cn/rules.md#Экзамены","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"Язык: на китайском обычно HSK 4 или HSK 5 (от 180 баллов), устный HSKK требуют некоторые вузы; на английском IELTS не ниже 5.5 или TOEFL iBT не ниже 72. Если китайского пока нет, возможен языковой год (в том числе по стипендии). Стоимость экзаменов, сборов вузов, нотариуса и медкомиссии брать только из базы знаний."},
  {"topic":"calendar.cn.intake_2027.2026_10","audience":"client","source_ref":"src/content/ai-agents/curator-cn/rules.md#Календарь набора на сентябрь 2027","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"Набор на сентябрь 2027, октябрь 2026: встреча с куратором, выбор вузов, начало подготовки к экзаменам, проверка срока загранпаспорта."},
  {"topic":"calendar.cn.intake_2027.2026_11","audience":"client","source_ref":"src/content/ai-agents/curator-cn/rules.md#Календарь набора на сентябрь 2027","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"Набор на сентябрь 2027, ноябрь 2026: регистрация на HSK и CSCA; фото; начало сбора и заверения документов; данные родителей; свидетельство о рождении (для студентов младше 18)."},
  {"topic":"calendar.cn.intake_2027.2026_11_12","audience":"client","source_ref":"src/content/ai-agents/curator-cn/rules.md#Календарь набора на сентябрь 2027","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"Набор на сентябрь 2027, ноябрь-декабрь 2026: медкомиссия, справка о несудимости, нотариальное согласие родителей (для студентов младше 18)."},
  {"topic":"calendar.cn.intake_2027.2026_12","audience":"client","source_ref":"src/content/ai-agents/curator-cn/rules.md#Календарь набора на сентябрь 2027","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"Набор на сентябрь 2027, декабрь 2026: рекомендации учителей, черновик мотивационного письма, видео-резюме."},
  {"topic":"calendar.cn.intake_2027.2027_01","audience":"client","source_ref":"src/content/ai-agents/curator-cn/rules.md#Календарь набора на сентябрь 2027","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"Набор на сентябрь 2027, до января 2027: результаты всех экзаменов (главный срок года), финальные тексты, банковская справка перед подачей, начало подачи заявок. Срок «все результаты к январю» в руководстве от 15 октября 2026 года не сверен с календарём экзамена CSCA."},
  {"topic":"calendar.cn.intake_2027.2027_02_04","audience":"client","source_ref":"src/content/ai-agents/curator-cn/rules.md#Календарь набора на сентябрь 2027","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"Набор на сентябрь 2027, февраль-апрель 2027: подача в оставшиеся вузы, собеседования (пробное собеседование проводит куратор)."},
  {"topic":"calendar.cn.intake_2027.2027_05_07","audience":"client","source_ref":"src/content/ai-agents/curator-cn/rules.md#Календарь набора на сентябрь 2027","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"Набор на сентябрь 2027, май-июль 2027: ответы вузов; результаты стипендии CSC в конце июля."},
  {"topic":"calendar.cn.intake_2027.2027_07_08","audience":"client","source_ref":"src/content/ai-agents/curator-cn/rules.md#Календарь набора на сентябрь 2027","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"Набор на сентябрь 2027, июль-август 2027: выбор вуза, виза X1 после письма о зачислении, билеты."},
  {"topic":"calendar.cn.intake_2027.2027_09","audience":"client","source_ref":"src/content/ai-agents/curator-cn/rules.md#Календарь набора на сентябрь 2027","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"Набор на сентябрь 2027, сентябрь 2027: выезд, регистрация в полиции в течение 24 часов, вид на жительство в течение 30 дней (для визы X1)."},
  {"topic":"calendar.cn.intake_2027.csc_window","audience":"client","source_ref":"src/content/ai-agents/curator-cn/rules.md#Календарь набора на сентябрь 2027","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"Приём заявок на стипендию CSC идёт примерно с декабря 2026 по апрель 2027, результаты CSC объявляются в конце июля 2027. Точные даты экзаменов и дедлайнов куратор вносит в личный план студента."},
  {"topic":"calendar.cn.intake_2027.exam_registration_risk","audience":"internal","source_ref":"src/content/ai-agents/curator-cn/rules.md#Экзамены","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"Главный срок года: к январю набора все результаты экзаменов должны быть готовы. Если у студента нет регистрации или даты экзамена к ноябрю, это риск уровня «сообщить куратору»."},
  {"topic":"calendar.cn.intake_2027.minor_age_cutoff","audience":"client","source_ref":"src/content/ai-agents/curator-cn/rules.md#Календарь набора на сентябрь 2027","verified_at":"2026-10-23","valid_until":"2027-09-01","statement_ru":"Возрастной порог для документов несовершеннолетних считается на 1 сентября 2027 года: младше 18 лет на эту дату нужны нотариальное согласие обоих родителей на выезд и оригинал свидетельства о рождении."},
  {"topic":"docs.cn.package","audience":"client","source_ref":"src/content/ai-agents/curator-cn/rules.md#Документы: 16 пунктов и что проверять","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"Пакет документов состоит из 16 пунктов; часть нужна только студентам младше 18 лет на 1 сентября года набора. Студент присылает скан каждого документа сразу, как он готов, не ждёт полного пакета. Имя и дата рождения везде совпадают с загранпаспортом буква в букву. Документы не на английском или китайском переводятся у нотариуса, перевод прошивается, нумеруется и заверяется печатью."},
  {"topic":"docs.cn.passport","audience":"client","source_ref":"src/content/ai-agents/curator-cn/rules.md#Документы: 16 пунктов и что проверять","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"Загранпаспорт нужен всем и сразу: он действует не менее 12 месяцев от начала учёбы, то есть до сентября следующего года. При смене паспорта сразу сообщить куратору. К выезду срок действия не менее 6 месяцев на момент вылета и не менее 2 чистых страниц."},
  {"topic":"docs.cn.photos","audience":"client","source_ref":"src/content/ai-agents/curator-cn/rules.md#Документы: 16 пунктов и что проверять","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"Фотографии 33x48 мм: 8 печатных и 1 электронная. Белый фон, лицо и уши открыты, без очков и аксессуаров, минимум макияжа. Одно печатное фото понадобится на медкомиссии; входит ли оно в восемь, не подтверждено."},
  {"topic":"docs.cn.medical","audience":"client","source_ref":"src/content/ai-agents/curator-cn/rules.md#Документы: 16 пунктов и что проверять","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"Медицинская справка на бланке Foreigner Physical Examination Form, строго по образцу. Анализы сдаются утром натощак: общий анализ крови, ВИЧ, группа крови, флюорография (снимок хранит студент); врач может назначить дополнительное. На готовой справке: имя латиницей и дата рождения как в паспорте, фото с печатью, заключение «Healthy», подпись врача, дата и печать. Срок действия справки не подтверждён."},
  {"topic":"docs.cn.transcript","audience":"client","source_ref":"src/content/ai-agents/curator-cn/rules.md#Документы: 16 пунктов и что проверять","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"Аттестат, диплом или табель: окончил школу или вуз, нужен аттестат или диплом с оценками; ещё учится, нужен табель за последний год на бланке школы с подписями и печатью. Плюс нотариальный перевод на английский или китайский. Справка с места учёбы нужна только тем, кто сейчас учится (класс или курс, подпись директора или декана, печать), плюс нотариальный перевод."},
  {"topic":"docs.cn.police_certificate","audience":"client","source_ref":"src/content/ai-agents/curator-cn/rules.md#Документы: 16 пунктов и что проверять","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"Справка о несудимости оформляется через государственное приложение за один рабочий день, затем нотариальный перевод. Срок действия справки в источниках не указан, поэтому не подавать её слишком рано без уточнения у сотрудника."},
  {"topic":"docs.cn.recommendation_letters","audience":"client","source_ref":"src/content/ai-agents/curator-cn/rules.md#Документы: 16 пунктов и что проверять","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"Два рекомендательных письма от двух разных учителей на английском, на официальном бланке школы, с исходящим номером и датой. Указаны ФИО учителя, предмет, номер или название школы; подпись учителя и печать. Письма пишут учителя, не студент и не EVO."},
  {"topic":"docs.cn.bank_statement","audience":"client","source_ref":"src/content/ai-agents/curator-cn/rules.md#Документы: 16 пунктов и что проверять","verified_at":"2026-10-18","valid_until":"2026-12-31","statement_ru":"Справка из банка о наличии средств: на английском, из мобильного банка, перед подачей. Минимальная сумма по утверждённой базе знаний на 18 октября 2026 года: не менее 2 500 долларов США или эквивалент. Некоторые вузы требуют больше; точную сумму для вузов студента уточняет сотрудник."},
  {"topic":"docs.cn.parents_data","audience":"client","source_ref":"src/content/ai-agents/curator-cn/rules.md#Документы: 16 пунктов и что проверять","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"Нужны копии паспортов обоих родителей и их полные данные: ФИО как в паспорте, телефон, e-mail, место работы, должность, адрес. Если кто-то из родителей не работает, это указывается, и куратор подсказывает, как заполнить анкету."},
  {"topic":"docs.cn.minor_extra","audience":"client","source_ref":"src/content/ai-agents/curator-cn/rules.md#Документы: 16 пунктов и что проверять","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"Студентам младше 18 лет на 1 сентября года набора дополнительно нужны нотариальное согласие обоих родителей на выезд и оригинал свидетельства о рождении. Для некоторых вузов нужны документы опекуна: как это оформляется и сколько стоит опекунство в Китае, называет только сотрудник."},
  {"topic":"visa.cn.x1_x2","audience":"client","source_ref":"src/content/ai-agents/curator-cn/rules.md#Подача, собеседования, зачисление, виза","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"Виза X1 при обучении дольше 180 дней, X2 при обучении короче. Оформляется после письма о зачислении, ориентировочно в июле-августе года набора. Подаёт студент, решает посольство. Приглашение от вуза (JW202 или JW201, либо DQ): оригиналы нужны к выезду. Полный перечень документов посольства не подтверждён: брать из базы знаний или у сотрудника."},
  {"topic":"visa.cn.preliminary_vs_offer","audience":"client","source_ref":"src/content/ai-agents/curator-cn/rules.md#Подача, собеседования, зачисление, виза","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"Предварительное решение вуза и официальное письмо о зачислении это разные вещи: предварительное решение не называть зачислением. О любом решении вуза сообщать куратору сразу."},
  {"topic":"arrival.cn.checklist","audience":"client","source_ref":"src/content/ai-agents/curator-cn/rules.md#Выезд: чек-листы","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"Все оригиналы документов в ручную кладь, не в багаж. В Китае розетки типов A и I, 220 В. Основной канал связи WeChat; карта UnionPay надёжнее всего, Alipay с привязанной картой. Экстренные номера: 110 полиция, 120 скорая, 119 пожарные. В день вылета приехать за 3 часа до международного рейса, сообщить куратору о вылете."},
  {"topic":"arrival.cn.after_arrival","audience":"client","source_ref":"src/content/ai-agents/curator-cn/rules.md#Выезд: чек-листы","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"По прилёту: регистрация по месту проживания в полиции в течение 24 часов (в общежитии обычно делает университет, при съёмной квартире студент сам в местном участке); для визы X1 в течение 30 дней оформить вид на жительство; получить студенческий билет и карту доступа. Поддержка куратора заканчивается на первом месяце после приезда, если сотрудник не сказал иначе. Правила въезда меняются: актуальное уточнять у сотрудника."},
  {"topic":"promise.my.applications_by_evo","audience":"client","source_ref":"src/content/ai-agents/curator-my/role.md#Кто ты и зачем","verified_at":"2026-10-23","valid_until":"2026-12-31","statement_ru":"Заявки в университеты Малайзии подаёт сама EVO: сотрудник отдела зарубежного образования, без партнёра и посредника. Решение о зачислении принимает университет, визовый процесс ведут EMGS и иммиграционная служба Малайзии, поэтому EVO не гарантирует поступление и визу."},
  {"topic":"docs.my.school_certificate","audience":"client","source_ref":"src/content/ai-agents/curator-my/rules.md#Базовый пакет документов (для всех университетов)","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"Аттестат о среднем образовании: перевод на английский и нотариальное заверение. Апостиль не нужен. Частые ошибки: перевод не от аккредитованного бюро; нет печати нотариуса."},
  {"topic":"docs.my.photo","audience":"client","source_ref":"src/content/ai-agents/curator-my/rules.md#Базовый пакет документов (для всех университетов)","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"Фотография 35x45 мм, белый фон, формат JPG, высокое разрешение, цифровой файл (не скан печатного фото), уши видны, нейтральное выражение лица. Частые ошибки: скан вместо цифрового файла; очки; светлая одежда; обработка в редакторе; уши закрыты волосами, капюшоном или наушниками. Для визовой заявки MMU фото 4.5x3.5 см на белом фоне."},
  {"topic":"docs.my.passport","audience":"client","source_ref":"src/content/ai-agents/curator-my/rules.md#Базовый пакет документов (для всех университетов)","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"Загранпаспорт: цветной скан всего буклета, включая обложки и все пустые страницы, одним PDF-файлом. Срок действия больше 18 месяцев от даты интейка (у одного из университетов рекомендуют не меньше 20 месяцев). Частые ошибки: только главная страница; пропущены пустые страницы; несколько файлов вместо одного."},
  {"topic":"docs.my.hdf","audience":"client","source_ref":"src/content/ai-agents/curator-my/rules.md#Базовый пакет документов (для всех университетов)","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"Health Declaration Form (HDF) это форма университета: подпись, дата, ФИО, номер паспорта. Галочка ставится в колонке YES, если у студента НЕТ перечисленного заболевания: проверять каждый раз. Частые ошибки: нет даты; галочки поставлены неверно; имя не как в паспорте."},
  {"topic":"docs.my.english","audience":"client","source_ref":"src/content/ai-agents/curator-my/rules.md#Базовый пакет документов (для всех университетов)","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"Подтверждение английского: IELTS, TOEFL, Duolingo или Linguaskill либо освобождение (британская программа IGCSE с оценкой не ниже C по английскому; обучение в школе на английском языке, нужен English Verification Letter от школы). Принимается ли конкретный тест или освобождение, определяет университет: Duolingo принимают не все, MMU не принимает. Всегда уточнять у университета до выбора теста."},
  {"topic":"docs.my.minor","audience":"client","source_ref":"src/content/ai-agents/curator-my/rules.md#Базовый пакет документов (для всех университетов)","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"До 18 лет для подачи на SEV подтверждено: дополнительно нужно переведённое свидетельство о рождении. Нужны ли другие документы раньше (нотариальное согласие родителей на выезд, письмо опекуна), не подтверждено: уточнять у сотрудника и университета, студенту не утверждать."},
  {"topic":"docs.my.school_issues","audience":"client","source_ref":"src/content/ai-agents/curator-my/rules.md#Базовый пакет документов (для всех университетов)","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"Типичные вопросы университетов к школьным документам: предмет «Иностранный язык» в аттестате требует explanation letter, что в программе Кыргызстана это английский; несовпадающая система оценок требует письма о системе оценивания (официальная справка школы); год 12 или профессиональный диплом требует полного транскрипта и сертификата об окончании; в одной справке разные шкалы оценок требуют пояснительного письма заранее. Письма не отправлять ссылками на облачные диски: у университетов нет доступа, вложения дробить."},
  {"topic":"uni.my.inti","audience":"internal","source_ref":"src/content/ai-agents/curator-my/rules.md#Каналы подачи по университетам","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"INTI: сначала транскрипт или аттестат, затем Eligibility Letter, структура сборов и брошюра; потом полный пакет (паспорт, фото, заверенные копии аттестата, английский, Application Form от INTI, HDF, платёж сбора за подачу). INTI выдаёт Offer Letter, студент подписывает его и форму политики сборов. После eVAL: авансовый платёж; SEV за 1 месяц до прилёта; отправка SEV в INTI; билет не позже чем за 5 дней до прилёта; номер WhatsApp студента; MDAC за 3 дня до прилёта. Порядок «SEV, затем билет» в регламенте записан наоборот общему порядку: уточнять у сотрудника. Платёж с кодом назначения «услуги образования»: точный код уточнять."},
  {"topic":"uni.my.sunway","audience":"internal","source_ref":"src/content/ai-agents/curator-my/rules.md#Каналы подачи по университетам","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"Sunway: Eligibility Check бесплатный, по письму. Затем Application Form онлайн (отдельные формы для колледжа, университета и магистратуры), HDF, паспорт, фото, аттестат. Offer Letter приходит в течение 3-5 рабочих дней после полного пакета и платежей. Визовая заявка начинается за 3 месяца до интейка, процесс 6-8 недель. Платить только напрямую в университет, переводы третьих лиц запрещены. Общежитие через портал Sunway. Перед вылетом не менее чем за 1 неделю уведомить International Welfare и Residence team. После прилёта явиться в International Office на следующий рабочий день с паспортом."},
  {"topic":"uni.my.taylors","audience":"internal","source_ref":"src/content/ai-agents/curator-my/rules.md#Каналы подачи по университетам","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"Taylor's: документы отправляются куратору по приёму, университет проверяет соответствие. При необходимости английский вступительный тест: слоты ограничены, участие подтвердить минимум за сутки до слота, иначе слот сдвигается на неделю. Сбор оплачивается до зачисления через платёжный сервис университета. Полный пакет, HDF и affidavit загружаются в TOPAS, после чего приходит номер заявки, затем EMGS. MDAC обязательно с PIN. Перед прилётом форма прилёта и письмо в службу встречи в аэропорту."},
  {"topic":"uni.my.mmu","audience":"internal","source_ref":"src/content/ai-agents/curator-my/rules.md#Каналы подачи по университетам","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"MMU: заявку подаёт сотрудник через агентский портал университета. Если студент подал сам до EVO, заявка числится individual: студент пишет в MMU со своей почты и прикладывает скриншот первого сообщения в EVO. В личных данных обязательно заполнить религию, инвалидность и домашний адрес, иначе заявка висит как incomplete. После Offer Letter для визовой заявки: квитанция первоначального платежа, HDF, копия паспорта (все страницы, срок больше 18 месяцев), академические документы, фото 4.5x3.5 см, affidavit только при расхождении имени или даты рождения. Платёж в EMGS отражается через 14 рабочих дней; квитанцию отправить в MMU. Duolingo не принимается: без IELTS или TOEFL может потребоваться подготовительная программа английского (EPP). Статус агентского соглашения и платежи визового этапа не подтверждены."},
  {"topic":"uni.my.ucsi","audience":"internal","source_ref":"src/content/ai-agents/curator-my/rules.md#Каналы подачи по университетам","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"UCSI: первичный пакет (транскрипт, аттестат, паспорт, английский) отправляется куратору университета и дублируется в WhatsApp. UCSI присылает Eligibility Letter и расчёт; возможна заявка на грант университета (Trust Scholarship): условия и процент уточнять в базе знаний, ничего не обещать. Регистрацию студента в портале делает сотрудник через агентский аккаунт (6 вкладок). Только после оплаты выдаётся Offer Letter и начинается визовый процесс на 1-1,5 месяца. Возврат при ситуации «оплатили, а предложения нет» в регламенте не указан: возврат не обещать."},
  {"topic":"uni.my.apu","audience":"internal","source_ref":"src/content/ai-agents/curator-my/rules.md#Каналы подачи по университетам","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"APU: Application Form и заверенные копии аттестата или транскрипта идут на оценку; при соответствии приходит Offer Letter. Первый этап сбора платится вместе с пакетом (цветное фото, паспорт со всеми страницами, HDF). Визу рассматривает EMGS около 3-4 недель, после Student Pass approval letter подаётся SEV. Письменно уведомить APU о вылете не менее чем за 7 дней. Даты интейков и требования к английскому по APU не подтверждены."},
  {"topic":"uni.my.alfa","audience":"internal","source_ref":"src/content/ai-agents/curator-my/rules.md#Каналы подачи по университетам","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"Alfa (AUC): заявка по e-mail, Application Form запрашивается у университета; форма редакции 2018 года требует физических заверенных копий (две копии паспорта и академических документов, две копии свидетельства об окончании школы, 8 фото), для дизайнерских программ рисунок карандашом на листе A4. Первый платёж по телеграфному переводу. Для Foundation сертификат английского не требовался на момент запроса. Условия оплаты и интейки уточнять у сотрудника."},
  {"topic":"uni.my.subject_guide","audience":"internal","source_ref":"src/content/ai-agents/curator-my/rules.md#Каналы подачи по университетам","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"Ориентиры из регламента (проверять в каталоге и базе знаний; подбор делает менеджер): IT: INTI, APU, MMU, UCSI, Sunway, Alfa; инженерия: APU, Taylor's, MMU; биотехнологии и науки о жизни: UCSI; гостеприимство: Sunway, APU; архитектура и дизайн: APU, Alfa, UCSI; психология: APU, MMU; актуарные науки: UCSI, APU; программа 2+2 с переводом в США: INTI. Общежитие университета: Sunway и APU; гибкая дата старта: INTI."},
  {"topic":"visa.my.eval","audience":"client","source_ref":"src/content/ai-agents/curator-my/rules.md#Визовый процесс (EMGS) — общий для всех","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"Университет подаёт заявку в EMGS (у Sunway за 3 месяца до интейка). eVAL (Electronic Visa Approval Letter) идёт 6-8 недель; статус показывается в процентах на сайте EMGS, который не открывается из Малайзии. При прогрессе около 70% и зелёном статусе eVAL считается готовым. eVAL скачивается в мобильном приложении EMGS, печатается и действует 6 месяцев с даты выдачи; при просрочке нужна новая заявка и доплата в EMGS."},
  {"topic":"visa.my.sev","audience":"client","source_ref":"src/content/ai-agents/curator-my/rules.md#Визовый процесс (EMGS) — общий для всех","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"SEV (eVisa) подаётся на портале иммиграции Малайзии (адрес периодически меняется, уточнять каждый раз). Обязательные приложения: готовый eVAL, билет до Куала-Лумпура (купить до подачи SEV, а не после), студентам младше 18 дополнительно переведённое свидетельство о рождении. Ответ обычно около 1 рабочего дня; заявки обрабатываются только в будни. Аккаунт на портале создаёт сам студент на личную почту, пароль и коды хранит он."},
  {"topic":"visa.my.mdac","audience":"client","source_ref":"src/content/ai-agents/curator-my/rules.md#Визовый процесс (EMGS) — общий для всех","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"MDAC (цифровая карта прибытия) заполняется за 3 дня до прилёта; EMGS требует MDAC с PIN."},
  {"topic":"arrival.my.print_list","audience":"client","source_ref":"src/content/ai-agents/curator-my/rules.md#Прилёт и адаптация","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"Распечатать перед вылетом: eVAL, подтверждение одобрения SEV, MDAC с PIN, Offer Letter университета, билет, копию главной страницы паспорта отдельно от оригинала."},
  {"topic":"arrival.my.notice_deadlines","audience":"client","source_ref":"src/content/ai-agents/curator-my/rules.md#Прилёт и адаптация","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"Уведомить университет о прилёте: Sunway (International Welfare и Residence team) не менее чем за 1 неделю; INTI форма и билет не позже чем за 5 дней, MDAC за 3 дня, SEV отправлен в университет; APU письменно не менее чем за 7 дней; Taylor's форма прилёта и письмо в службу встречи; MMU уточнить у сотрудника. Порядок встречи в аэропорту менялся в октябре 2026 года: терминал, стойку и встречающего называть только из базы знаний или от сотрудника."},
  {"topic":"arrival.my.after_arrival","audience":"client","source_ref":"src/content/ai-agents/curator-my/rules.md#Прилёт и адаптация","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"После прилёта: явка в офис университета (у Sunway на следующий рабочий день), заселение, медосмотр в клинике (все университеты), доплата остатка по договору с университетом, визовый стикер в паспорте через 2-3 недели (паспорт на это время забирает университет, учёба идёт)."},
  {"topic":"housing.my.dorms","audience":"client","source_ref":"src/content/ai-agents/curator-my/rules.md#Прилёт и адаптация","verified_at":"2026-10-23","valid_until":"2027-10-31","statement_ru":"Общежитие: у Sunway и APU собственные системы бронирования; у INTI, Taylor's и MMU условия не подтверждены. Частная аренда идёт через риелторов (список контактов ведёт отдел). Цены аренды по памяти не называть."},
  {"topic":"payments.my.rules","audience":"client","source_ref":"src/content/ai-agents/curator-my/rules.md#Платежи и деньги","verified_at":"2026-10-23","valid_until":"2026-12-31","statement_ru":"Часть платежей невозвратная, другая часть возвратный депозит. Университеты принимают оплату по-разному (через платёжный сервис, напрямую, банковским переводом); у Sunway переводы третьих лиц запрещены. Прайсы университетов 2025 и 2026 года могут быть устаревшими для набора 2027: цены университетов по памяти не сравнивать, сравнение делает менеджер по актуальным предложениям."}
]$seed$::JSONB) AS s(topic TEXT, audience TEXT, source_ref TEXT,
    verified_at DATE, valid_until DATE, statement_ru TEXT)
  ON CONFLICT (organization_id, topic, audience) WHERE status = 'active' DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END
$$;

-- ---------------------------------------------------------------------------
-- C. Функции сотрудника.
-- ---------------------------------------------------------------------------
-- Список: право `ai.agent.use`. Фильтры: префикс темы, статус (active по умолчанию / draft / retired / all), аудитория.
-- Просроченные действующие показываются с `validity = 'expired'`; в `counts` - сводка по действующим.
CREATE FUNCTION platform.ai_company_facts_list_v1(p_organization_id UUID, p_topic_prefix TEXT DEFAULT NULL,
  p_status TEXT DEFAULT 'active', p_audience TEXT DEFAULT NULL, p_limit INTEGER DEFAULT 300)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_today DATE; v_rows JSONB; v_total INTEGER;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.use');
  IF p_status IS NULL OR p_status NOT IN ('active', 'draft', 'retired', 'all')
    OR (p_audience IS NOT NULL AND p_audience NOT IN ('client', 'internal'))
    OR (p_topic_prefix IS NOT NULL AND p_topic_prefix !~ '^[a-z0-9][a-z0-9._-]{0,79}$')
    OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'company_fact_invalid_filter' USING ERRCODE = '22023';
  END IF;
  v_today := platform_private.company_facts_today();
  SELECT count(*) INTO v_total FROM platform_private.company_facts f
  WHERE f.organization_id = p_organization_id AND (p_status = 'all' OR f.status = p_status)
    AND (p_audience IS NULL OR f.audience = p_audience)
    AND (p_topic_prefix IS NULL OR left(f.topic, char_length(p_topic_prefix)) = p_topic_prefix);
  SELECT COALESCE(jsonb_agg(platform_private.company_fact_json(x, v_today) ORDER BY x.topic, x.audience, x.created_at DESC), '[]'::JSONB)
  INTO v_rows
  FROM (SELECT f.* FROM platform_private.company_facts f
    WHERE f.organization_id = p_organization_id AND (p_status = 'all' OR f.status = p_status)
      AND (p_audience IS NULL OR f.audience = p_audience)
      AND (p_topic_prefix IS NULL OR left(f.topic, char_length(p_topic_prefix)) = p_topic_prefix)
    ORDER BY f.topic, f.audience, f.created_at DESC LIMIT p_limit) x;
  RETURN jsonb_build_object(
    'facts', v_rows,
    'truncated', v_total > p_limit,
    'today', v_today,
    'counts', jsonb_build_object(
      'active', (SELECT count(*) FROM platform_private.company_facts f WHERE f.organization_id = p_organization_id AND f.status = 'active'),
      'expired', (SELECT count(*) FROM platform_private.company_facts f WHERE f.organization_id = p_organization_id
        AND f.status = 'active' AND f.valid_until < v_today),
      'expiring', (SELECT count(*) FROM platform_private.company_facts f WHERE f.organization_id = p_organization_id
        AND f.status = 'active' AND f.valid_until >= v_today AND f.valid_until <= v_today + 30)),
    'canManage', platform_private.staff_can_access(p_organization_id, v_actor.membership_id, 'ai.agent.manage',
      'organization', p_organization_id));
END
$$;

-- Сохранить: `p_fact_id` NULL - добавить факт (тема и аудитория обязательны), иначе правка действующего факта: старая
-- строка становится `retired`, новая - `active` с `supersedes_id` на неё. Патч (camelCase): topic, audience (только при
-- добавлении), statementRu, statementKy, statementEn (null убирает), source, sourceRef, validUntil (null - без срока),
-- markVerified. Изменение текста без «Проверено» отклоняется (`company_fact_verification_required`): дата проверки не
-- может покрывать текст, которого никто не проверял. «Проверено» = сегодня по Бишкеку и сотрудник. Повтор по
-- `p_request_id` возвращает прежний итог; в журнале нет текстов.
CREATE FUNCTION platform.ai_company_facts_save_v1(p_organization_id UUID, p_fact_id UUID, p_patch JSONB, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor RECORD; v_old platform_private.company_facts; v_new platform_private.company_facts; v_prior platform.audit_events;
  v_today DATE; v_sha TEXT; k TEXT; v JSONB; v_text TEXT; v_date DATE;
  n_topic TEXT; n_audience TEXT; n_ru TEXT; n_ky TEXT; n_en TEXT; n_source TEXT; n_ref TEXT; n_until DATE; n_verify BOOLEAN := FALSE;
  v_changed TEXT[] := ARRAY[]::TEXT[]; v_new_id UUID := gen_random_uuid(); v_before JSONB := '{}'::JSONB;
  n_verified_at DATE; n_verified_by UUID;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.manage');
  IF p_request_id IS NULL OR p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::JSONB THEN
    RAISE EXCEPTION 'company_fact_invalid_patch' USING ERRCODE = '22023';
  END IF;
  v_sha := platform_private.ai_agent_sha256(COALESCE(p_fact_id::TEXT, '') || ':' || p_patch::TEXT);
  SELECT * INTO v_prior FROM platform.audit_events e WHERE e.request_id = p_request_id;
  IF FOUND THEN
    IF v_prior.organization_id = p_organization_id AND v_prior.action = 'ai.fact.change'
      AND v_prior.actor_membership_id IS NOT DISTINCT FROM v_actor.membership_id
      AND v_prior.after_state ->> 'patchSha256' = v_sha THEN
      RETURN jsonb_build_object('factId', v_prior.resource_id, 'status', 'saved', 'changed', v_prior.after_state -> 'changed');
    END IF;
    RAISE EXCEPTION 'company_fact_request_conflict' USING ERRCODE = '40001';
  END IF;
  v_today := platform_private.company_facts_today();

  IF p_fact_id IS NULL THEN
    n_topic := NULL; n_audience := NULL; n_ru := NULL; n_ky := NULL; n_en := NULL; n_source := 'owner'; n_ref := NULL; n_until := NULL;
  ELSE
    SELECT * INTO v_old FROM platform_private.company_facts f
    WHERE f.id = p_fact_id AND f.organization_id = p_organization_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'company_fact_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_old.status <> 'active' THEN
      RAISE EXCEPTION 'company_fact_stale' USING ERRCODE = '40001';
    END IF;
    n_topic := v_old.topic; n_audience := v_old.audience; n_ru := v_old.statement_ru; n_ky := v_old.statement_ky;
    n_en := v_old.statement_en; n_source := v_old.source; n_ref := v_old.source_ref; n_until := v_old.valid_until;
  END IF;

  FOR k, v IN SELECT e.key, e.value FROM jsonb_each(p_patch) e LOOP
    IF k IN ('topic', 'audience') THEN
      IF p_fact_id IS NOT NULL OR jsonb_typeof(v) <> 'string' THEN
        RAISE EXCEPTION 'company_fact_invalid_patch' USING ERRCODE = '22023';
      END IF;
      IF k = 'topic' THEN n_topic := v #>> '{}'; ELSE n_audience := v #>> '{}'; END IF;
    ELSIF k IN ('statementRu', 'statementKy', 'statementEn', 'sourceRef') THEN
      IF jsonb_typeof(v) = 'null' THEN
        v_text := NULL;
      ELSIF jsonb_typeof(v) = 'string' THEN
        v_text := platform_private.ai_agent_clean_text(v #>> '{}');
        IF v_text = '' THEN v_text := NULL; END IF;
        IF v_text IS NOT NULL AND NOT platform_private.ai_agent_text_ok(v_text, CASE k WHEN 'sourceRef' THEN 300 ELSE 1500 END) THEN
          RAISE EXCEPTION 'company_fact_invalid_patch' USING ERRCODE = '22023';
        END IF;
      ELSE
        RAISE EXCEPTION 'company_fact_invalid_patch' USING ERRCODE = '22023';
      END IF;
      IF k = 'statementRu' THEN
        IF v_text IS NULL THEN RAISE EXCEPTION 'company_fact_invalid_patch' USING ERRCODE = '22023'; END IF;
        n_ru := v_text;
      ELSIF k = 'statementKy' THEN n_ky := v_text;
      ELSIF k = 'statementEn' THEN n_en := v_text;
      ELSE n_ref := v_text;
      END IF;
    ELSIF k = 'source' THEN
      IF jsonb_typeof(v) <> 'string' OR (v #>> '{}') NOT IN ('owner', 'agent_instruction', 'kb_node', 'catalog_cost', 'timeline', 'contract') THEN
        RAISE EXCEPTION 'company_fact_invalid_patch' USING ERRCODE = '22023';
      END IF;
      n_source := v #>> '{}';
    ELSIF k = 'validUntil' THEN
      IF jsonb_typeof(v) = 'null' THEN
        n_until := NULL;
      ELSIF jsonb_typeof(v) = 'string' AND (v #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$' THEN
        BEGIN
          v_date := (v #>> '{}')::DATE;
        EXCEPTION WHEN OTHERS THEN
          RAISE EXCEPTION 'company_fact_invalid_patch' USING ERRCODE = '22023';
        END;
        n_until := v_date;
      ELSE
        RAISE EXCEPTION 'company_fact_invalid_patch' USING ERRCODE = '22023';
      END IF;
    ELSIF k = 'markVerified' THEN
      IF jsonb_typeof(v) <> 'boolean' THEN
        RAISE EXCEPTION 'company_fact_invalid_patch' USING ERRCODE = '22023';
      END IF;
      n_verify := (v #>> '{}')::BOOLEAN;
    ELSE
      RAISE EXCEPTION 'company_fact_invalid_patch' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF p_fact_id IS NULL THEN
    IF n_topic IS NULL OR n_topic !~ '^[a-z0-9]+(\.[a-z0-9_-]+)+$' OR char_length(n_topic) > 120
      OR n_audience IS NULL OR n_audience NOT IN ('client', 'internal') OR n_ru IS NULL THEN
      RAISE EXCEPTION 'company_fact_invalid_patch' USING ERRCODE = '22023';
    END IF;
    IF NOT n_verify THEN
      RAISE EXCEPTION 'company_fact_verification_required' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM platform_private.company_facts f WHERE f.organization_id = p_organization_id
        AND f.topic = n_topic AND f.audience = n_audience AND f.status = 'active') THEN
      RAISE EXCEPTION 'company_fact_topic_exists' USING ERRCODE = '23505';
    END IF;
    v_changed := ARRAY['created'];
  ELSE
    IF n_ru IS DISTINCT FROM v_old.statement_ru THEN v_changed := array_append(v_changed, 'statementRu'); END IF;
    IF n_ky IS DISTINCT FROM v_old.statement_ky THEN v_changed := array_append(v_changed, 'statementKy'); END IF;
    IF n_en IS DISTINCT FROM v_old.statement_en THEN v_changed := array_append(v_changed, 'statementEn'); END IF;
    IF n_source IS DISTINCT FROM v_old.source THEN v_changed := array_append(v_changed, 'source'); END IF;
    IF n_ref IS DISTINCT FROM v_old.source_ref THEN v_changed := array_append(v_changed, 'sourceRef'); END IF;
    IF n_until IS DISTINCT FROM v_old.valid_until THEN v_changed := array_append(v_changed, 'validUntil'); END IF;
    IF ('statementRu' = ANY (v_changed) OR 'statementKy' = ANY (v_changed) OR 'statementEn' = ANY (v_changed)) AND NOT n_verify THEN
      RAISE EXCEPTION 'company_fact_verification_required' USING ERRCODE = '22023';
    END IF;
    IF n_verify THEN v_changed := array_append(v_changed, 'verified'); END IF;
    IF cardinality(v_changed) = 0 THEN
      RETURN jsonb_build_object('factId', v_old.id, 'status', 'unchanged', 'changed', '[]'::JSONB);
    END IF;
    v_before := jsonb_build_object('topic', v_old.topic, 'audience', v_old.audience, 'verifiedAt', v_old.verified_at,
      'validUntil', v_old.valid_until);
  END IF;

  n_verified_at := CASE WHEN p_fact_id IS NULL OR n_verify THEN v_today ELSE v_old.verified_at END;
  n_verified_by := CASE WHEN p_fact_id IS NULL OR n_verify THEN v_actor.membership_id ELSE v_old.verified_by_membership_id END;
  IF n_until IS NOT NULL AND n_until < n_verified_at THEN
    RAISE EXCEPTION 'company_fact_invalid_dates' USING ERRCODE = '22023';
  END IF;

  IF p_fact_id IS NOT NULL THEN
    UPDATE platform_private.company_facts f SET status = 'retired', updated_at = clock_timestamp(),
      updated_by_membership_id = v_actor.membership_id WHERE f.id = v_old.id;
  END IF;
  INSERT INTO platform_private.company_facts (id, organization_id, topic, statement_ru, statement_ky, statement_en, audience,
    source, source_ref, verified_at, valid_until, supersedes_id, verified_by_membership_id, status,
    created_by_membership_id, updated_by_membership_id)
  VALUES (v_new_id, p_organization_id, n_topic, n_ru, n_ky, n_en, n_audience, n_source, n_ref, n_verified_at, n_until,
    p_fact_id, n_verified_by, 'active', v_actor.membership_id, v_actor.membership_id)
  RETURNING * INTO v_new;
  PERFORM platform_private.ai_agent_audit(p_organization_id, v_actor.membership_id, NULL, 'ai.fact.change', 'ai_company_fact',
    v_new.id, v_before,
    jsonb_build_object('op', CASE WHEN p_fact_id IS NULL THEN 'create' ELSE 'save' END, 'topic', v_new.topic,
      'audience', v_new.audience, 'changed', to_jsonb(v_changed), 'verifiedAt', v_new.verified_at,
      'validUntil', v_new.valid_until, 'supersedesId', v_new.supersedes_id, 'patchSha256', v_sha),
    'ИИ-агенты: факт компании изменён', p_request_id);
  RETURN jsonb_build_object('factId', v_new.id, 'status', 'saved', 'changed', to_jsonb(v_changed));
END
$$;

-- Снять: действующий факт становится `retired`, агенты его больше не видят. Право `ai.agent.manage`.
CREATE FUNCTION platform.ai_company_facts_retire_v1(p_organization_id UUID, p_fact_id UUID, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; f platform_private.company_facts; v_prior platform.audit_events; v_sha TEXT;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.manage');
  IF p_request_id IS NULL OR p_fact_id IS NULL THEN
    RAISE EXCEPTION 'company_fact_invalid_patch' USING ERRCODE = '22023';
  END IF;
  v_sha := platform_private.ai_agent_sha256('retire:' || p_fact_id::TEXT);
  SELECT * INTO v_prior FROM platform.audit_events e WHERE e.request_id = p_request_id;
  IF FOUND THEN
    IF v_prior.organization_id = p_organization_id AND v_prior.action = 'ai.fact.change' AND v_prior.resource_id = p_fact_id
      AND v_prior.actor_membership_id IS NOT DISTINCT FROM v_actor.membership_id
      AND v_prior.after_state ->> 'patchSha256' = v_sha THEN
      RETURN jsonb_build_object('factId', p_fact_id, 'status', 'retired');
    END IF;
    RAISE EXCEPTION 'company_fact_request_conflict' USING ERRCODE = '40001';
  END IF;
  SELECT * INTO f FROM platform_private.company_facts x WHERE x.id = p_fact_id AND x.organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'company_fact_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF f.status = 'retired' THEN
    RAISE EXCEPTION 'company_fact_stale' USING ERRCODE = '40001';
  END IF;
  UPDATE platform_private.company_facts x SET status = 'retired', updated_at = clock_timestamp(),
    updated_by_membership_id = v_actor.membership_id WHERE x.id = f.id;
  PERFORM platform_private.ai_agent_audit(p_organization_id, v_actor.membership_id, NULL, 'ai.fact.change', 'ai_company_fact',
    f.id, jsonb_build_object('topic', f.topic, 'audience', f.audience, 'status', f.status),
    jsonb_build_object('op', 'retire', 'topic', f.topic, 'audience', f.audience, 'changed', '["status"]'::JSONB,
      'status', 'retired', 'patchSha256', v_sha),
    'ИИ-агенты: факт компании снят', p_request_id);
  RETURN jsonb_build_object('factId', f.id, 'status', 'retired');
END
$$;

-- ---------------------------------------------------------------------------
-- D. Инструмент агента `get_company_facts` и его схема.
-- ---------------------------------------------------------------------------
INSERT INTO platform_private.ai_agent_tool_schemas (tool, kind, audit, input_schema) VALUES
  ('get_company_facts', 'read', 'none', $j${"type":"object","properties":{"topic_prefix":{"type":"string","pattern":"^[a-z0-9][a-z0-9._-]*$","minLength":1,"maxLength":80,"description":"Topic prefix, e.g. course. or calendar.cn."},"audience":{"type":"string","enum":["client","internal","both"],"default":"client","description":"Fact audience: client (default, may be told to clients), internal, or both."},"limit":{"type":"integer","minimum":1,"maximum":50,"default":20,"description":"Max facts."}},"required":[],"additionalProperties":false}$j$::jsonb);

-- Отдаёт ТОЛЬКО действующие факты, у которых нет срока или срок не раньше сегодняшнего дня по Бишкеку.
CREATE FUNCTION platform.ai_agent_tool_get_company_facts_v1(p_organization_id UUID, p_agent_key TEXT, p_args JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a platform_private.ai_agents; v_aud TEXT; v_limit INTEGER; v_prefix TEXT;
  v_today DATE; v_out JSONB; v_total INTEGER;
BEGIN
  a := platform_private.ai_agent_tool_begin(p_organization_id, p_agent_key, 'get_company_facts', p_args);
  -- Аргументы читаются ПОСЛЕ проверки схемы (как в 317): плохой limit - invalid_arguments, а не ошибка приведения.
  -- По умолчанию только клиентские факты; внутренние - по явному internal или both.
  v_aud := COALESCE(p_args ->> 'audience', 'client');
  v_limit := COALESCE((p_args ->> 'limit')::INTEGER, 20);
  v_prefix := p_args ->> 'topic_prefix';
  v_today := platform_private.company_facts_today();
  SELECT count(*) INTO v_total FROM platform_private.company_facts f
  WHERE f.organization_id = p_organization_id AND f.status = 'active' AND (f.valid_until IS NULL OR f.valid_until >= v_today)
    AND (v_aud = 'both' OR f.audience = v_aud)
    AND (v_prefix IS NULL OR left(f.topic, char_length(v_prefix)) = v_prefix);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'fact_id', x.id, 'topic', x.topic,
      'statement', jsonb_strip_nulls(jsonb_build_object('ru', x.statement_ru, 'ky', x.statement_ky, 'en', x.statement_en)),
      'audience', x.audience, 'source', x.source, 'verified_at', x.verified_at, 'valid_until', x.valid_until)
    ORDER BY x.topic, x.audience), '[]'::JSONB)
  INTO v_out
  FROM (SELECT f.* FROM platform_private.company_facts f
    WHERE f.organization_id = p_organization_id AND f.status = 'active' AND (f.valid_until IS NULL OR f.valid_until >= v_today)
      AND (v_aud = 'both' OR f.audience = v_aud)
      AND (v_prefix IS NULL OR left(f.topic, char_length(v_prefix)) = v_prefix)
    ORDER BY f.topic, f.audience LIMIT v_limit) x;
  RETURN jsonb_build_object('facts', v_out, 'today', v_today, 'truncated', v_total > v_limit);
END
$$;

-- ---------------------------------------------------------------------------
-- E. Журнал платформы: действие `ai.fact.change` и тип объекта `ai_company_fact` (rename-and-union, как 317).
-- ---------------------------------------------------------------------------
ALTER FUNCTION platform_private.p7a_safe_audit_actions()
  RENAME TO p7a_safe_audit_actions_pre_company_facts;
CREATE FUNCTION platform_private.p7a_safe_audit_actions()
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.array_agg(DISTINCT allowed.action ORDER BY allowed.action)
  FROM pg_catalog.unnest(
    platform_private.p7a_safe_audit_actions_pre_company_facts()
      || ARRAY[
    'ai.fact.change'
      ]::TEXT[]
  ) AS allowed(action)
$$;

ALTER FUNCTION platform_private.p7a_safe_audit_resource_types()
  RENAME TO p7a_safe_audit_resource_types_pre_company_facts;
CREATE FUNCTION platform_private.p7a_safe_audit_resource_types()
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.array_agg(DISTINCT allowed.resource_type ORDER BY allowed.resource_type)
  FROM pg_catalog.unnest(
    platform_private.p7a_safe_audit_resource_types_pre_company_facts()
      || ARRAY[
    'ai_company_fact'
      ]::TEXT[]
  ) AS allowed(resource_type)
$$;

-- ---------------------------------------------------------------------------
-- F. Права: сотрудник - authenticated; инструмент - service_role; помощники и обёртки журнала - никому.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  platform_private.company_facts_today(),
  platform_private.company_fact_json(platform_private.company_facts, DATE),
  platform_private.company_facts_seed(UUID),
  platform_private.p7a_safe_audit_actions_pre_company_facts(),
  platform_private.p7a_safe_audit_actions(),
  platform_private.p7a_safe_audit_resource_types_pre_company_facts(),
  platform_private.p7a_safe_audit_resource_types()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
REVOKE ALL ON FUNCTION
  platform.ai_company_facts_list_v1(UUID, TEXT, TEXT, TEXT, INTEGER),
  platform.ai_company_facts_save_v1(UUID, UUID, JSONB, UUID),
  platform.ai_company_facts_retire_v1(UUID, UUID, UUID),
  platform.ai_agent_tool_get_company_facts_v1(UUID, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
GRANT EXECUTE ON FUNCTION
  platform.ai_company_facts_list_v1(UUID, TEXT, TEXT, TEXT, INTEGER),
  platform.ai_company_facts_save_v1(UUID, UUID, JSONB, UUID),
  platform.ai_company_facts_retire_v1(UUID, UUID, UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION platform.ai_agent_tool_get_company_facts_v1(UUID, TEXT, JSONB) TO service_role;

-- Посев каждой организации (идемпотентно).
SELECT platform_private.company_facts_seed(o.id) FROM platform.organizations o;

-- ---------------------------------------------------------------------------
-- Проверка в конце: таблица, права, посев, журнал.
-- ---------------------------------------------------------------------------
DO $a381_verify$
DECLARE f RECORD;
BEGIN
  IF NOT (SELECT c.relrowsecurity AND c.relforcerowsecurity FROM pg_catalog.pg_class c
      WHERE c.oid = 'platform_private.company_facts'::REGCLASS)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_policies x WHERE x.schemaname = 'platform_private' AND x.tablename = 'company_facts')
    OR has_table_privilege('anon', 'platform_private.company_facts', 'SELECT')
    OR has_table_privilege('authenticated', 'platform_private.company_facts', 'SELECT')
    OR has_table_privilege('service_role', 'platform_private.company_facts', 'SELECT')
    OR has_table_privilege('authenticated', 'platform_private.company_facts', 'INSERT')
    OR has_table_privilege('service_role', 'platform_private.company_facts', 'INSERT') THEN
    RAISE EXCEPTION 'a381_verify_table' USING ERRCODE = '55000';
  END IF;
  FOR f IN SELECT p.oid, p.proname, p.prosecdef, p.proconfig, n.nspname FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE (n.nspname = 'platform' AND p.proname IN ('ai_company_facts_list_v1', 'ai_company_facts_save_v1',
        'ai_company_facts_retire_v1', 'ai_agent_tool_get_company_facts_v1'))
      OR (n.nspname = 'platform_private' AND p.proname IN ('company_facts_today', 'company_fact_json', 'company_facts_seed')) LOOP
    IF NOT f.prosecdef OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
      OR has_function_privilege('anon', f.oid, 'EXECUTE') OR has_function_privilege('evo_ai_agent', f.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'a381_verify_function: %', f.proname USING ERRCODE = '55000';
    END IF;
    IF (f.nspname = 'platform_private' AND (has_function_privilege('authenticated', f.oid, 'EXECUTE')
        OR has_function_privilege('service_role', f.oid, 'EXECUTE')))
      OR (f.proname LIKE 'ai\_company\_facts\_%' AND (NOT has_function_privilege('authenticated', f.oid, 'EXECUTE')
        OR has_function_privilege('service_role', f.oid, 'EXECUTE')))
      OR (f.proname = 'ai_agent_tool_get_company_facts_v1' AND (has_function_privilege('authenticated', f.oid, 'EXECUTE')
        OR NOT has_function_privilege('service_role', f.oid, 'EXECUTE'))) THEN
      RAISE EXCEPTION 'a381_verify_grant: %', f.proname USING ERRCODE = '55000';
    END IF;
  END LOOP;
  -- Реестр схем и функции инструментов идут парами (24 из 317 и get_company_facts).
  IF NOT EXISTS (SELECT 1 FROM platform_private.ai_agent_tool_schemas s WHERE s.tool = 'get_company_facts')
    OR (SELECT count(*) FROM platform_private.company_facts) <> 70 * (SELECT count(*) FROM platform.organizations)
    OR (SELECT count(*) FROM platform_private.ai_agent_tool_schemas) IS DISTINCT FROM (SELECT count(*) FROM pg_catalog.pg_proc p
        WHERE p.pronamespace = 'platform'::REGNAMESPACE AND p.proname LIKE 'ai\_agent\_tool\_%') THEN
    RAISE EXCEPTION 'a381_verify_seed' USING ERRCODE = '55000';
  END IF;
  IF NOT ('ai.fact.change' = ANY (platform_private.p7a_safe_audit_actions()))
    OR 'ai.fact.change' = ANY (platform_private.p7a_safe_audit_actions_pre_company_facts())
    OR cardinality(platform_private.p7a_safe_audit_actions())
      <> cardinality(platform_private.p7a_safe_audit_actions_pre_company_facts()) + 1
    OR NOT ('ai_company_fact' = ANY (platform_private.p7a_safe_audit_resource_types()))
    OR cardinality(platform_private.p7a_safe_audit_resource_types())
      <> cardinality(platform_private.p7a_safe_audit_resource_types_pre_company_facts()) + 1
    OR has_function_privilege('authenticated', 'platform_private.p7a_safe_audit_actions()'::REGPROCEDURE, 'EXECUTE')
    OR has_function_privilege('service_role',
      'platform_private.p7a_safe_audit_actions_pre_company_facts()'::REGPROCEDURE, 'EXECUTE') THEN
    RAISE EXCEPTION 'a381_verify_allowlist' USING ERRCODE = '55000';
  END IF;
END
$a381_verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
