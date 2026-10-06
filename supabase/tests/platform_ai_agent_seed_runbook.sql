\set ON_ERROR_STOP on
-- ИИ-агент P1, срез 6: точные SQL-блоки docs/runbooks/ai-agent-seed.md на
-- последней цепочке миграций (docs/EVO_AI_AGENT_PLAN_2026-10-06.md §13–§14).
-- Одна транзакция, которая откатывается; синтетическая организация и
-- синтетическая «База знаний» в форме production (папка «ИИ-ассистент» с
-- подпапками, «Компания», «Страны и поступление», рабочие материалы, файл,
-- «Панель управления», область raw, удалённая и архивная страницы). Ни
-- одного действия в production.
--
-- Блоки runbook вставлены дословно; заглушки <ORGANIZATION_ID>,
-- <ADMIN_AUTH_USER_ID>, <REQUEST_ID>, <EXPECTED_COUNT> заменены переменными
-- psql :'org', :'admin_uid', :'req', :'expected'. Тело блока между BEGIN и
-- COMMIT идёт внутри SAVEPOINT (ROLLBACK TO — репетиция, RELEASE — запись).
-- tests/ai-agent-p1-seed-cleanup.test.mjs проверяет, что каждый блок runbook
-- присутствует здесь без изменений.
--
-- Доказывает:
--  1. предпросмотр делит закрытый список так же, как шаги 2–4 (клиентские
--     страницы, внутренние, две страницы правил, README не копируется);
--  2. репетиция (ROLLBACK) не оставляет документов, очереди, квитанции и аудита;
--  3. шаг 2 от имени admin копирует только клиентские страницы закрытого
--     списка (в «ИИ-ассистенте» — только «Вопросы и ответы») с аудиторией
--     «Для клиентов», ставит указатели seed и пишет аудит этого admin;
--     повтор с тем же request id ничего не добавляет;
--  4. шаг 3 копирует только внутренние страницы «Компании» и «Стран и
--     поступления»; рабочие материалы, файл, «Панель управления», raw,
--     удалённая и архивная страницы не попадают;
--  5. шаг 4 делает текущую неподтверждённую версию правил source seed в
--     порядке «Правила ответов», «Продажи и ответы»;
--  6. проверка (шаг 5) видит ровно эти числа; охрана блока останавливает
--     вызов при неверном числе страниц и при claims не-admin;
--  7. корзина папки «ИИ-ассистент» (kb_command_v1 trash — то, что делает
--     кнопка «В корзину») кладёт все узлы одним batch, копии остаются,
--     повторное копирование из корзины отклоняется, «Восстановить»
--     возвращает весь batch.
BEGIN;

DO $rb_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$rb_auth_role$;

CREATE FUNCTION pg_temp.rb_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('26960000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.rb_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'SEED-RUNBOOK: %', message; END IF;
END
$$;
CREATE FUNCTION pg_temp.rb_err(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ':' || SQLERRM;
END
$$;
CREATE FUNCTION pg_temp.rb_claims(n INTEGER) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.rb_id(n),
    'claims', jsonb_build_object('sub', pg_temp.rb_id(n), 'role', 'authenticated'))) -> 'claims')::TEXT
$$;
GRANT EXECUTE ON FUNCTION pg_temp.rb_id(INTEGER), pg_temp.rb_assert(BOOLEAN, TEXT), pg_temp.rb_err(TEXT)
  TO authenticated;

SELECT 'AI_SEED_RUNBOOK_SUITE_START' AS rb_suite_marker;

-- ---------------------------------------------------------------------------
-- Fixture: one organization, its system Admin (101/201/301) and an invited
-- staff member without admin (102/202/302).
-- ---------------------------------------------------------------------------
INSERT INTO platform.organizations(id, name) VALUES (pg_temp.rb_id(1), 'Seed runbook fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES
  (pg_temp.rb_id(101), 'seed-runbook-admin@example.invalid', '{}'::JSONB),
  (pg_temp.rb_id(102), 'seed-runbook-staff@example.invalid', '{}'::JSONB);
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version) VALUES
  (pg_temp.rb_id(201), pg_temp.rb_id(101), 'Seed runbook Admin', 'active', 1),
  (pg_temp.rb_id(202), pg_temp.rb_id(102), 'Seed runbook Staff', 'active', 1);
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
VALUES (pg_temp.rb_id(301), pg_temp.rb_id(1), pg_temp.rb_id(201), 'active', 'admin',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'admin' AND status = 'published' ORDER BY version DESC LIMIT 1)),
  (pg_temp.rb_id(302), pg_temp.rb_id(1), pg_temp.rb_id(202), 'active', NULL, NULL);
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id = pg_temp.rb_id(301);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
VALUES (pg_temp.rb_id(401), pg_temp.rb_id(1), 'organization', pg_temp.rb_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
VALUES (pg_temp.rb_id(1), pg_temp.rb_id(301), pg_temp.rb_id(401), 1, 1, TRUE, 'system', 'Seed runbook synthetic scope',
  pg_temp.rb_id(601));

-- The knowledge base in the production shape (synthetic titles and texts).
INSERT INTO platform_private.kb_nodes(id, organization_id, area, parent_id, kind, title, body, source, updated_by,
  archived_at, deleted_at) VALUES
 (pg_temp.rb_id(801), pg_temp.rb_id(1), 'internal', NULL, 'folder', 'ИИ-ассистент', '', '{}', pg_temp.rb_id(301), NULL, NULL),
 (pg_temp.rb_id(802), pg_temp.rb_id(1), 'internal', pg_temp.rb_id(801), 'folder', 'Вопросы и ответы', '', '{}', pg_temp.rb_id(301), NULL, NULL),
 (pg_temp.rb_id(803), pg_temp.rb_id(1), 'internal', pg_temp.rb_id(801), 'folder', 'Правила ответов', '', '{}', pg_temp.rb_id(301), NULL, NULL),
 (pg_temp.rb_id(804), pg_temp.rb_id(1), 'internal', pg_temp.rb_id(801), 'folder', 'Правила базы', '', '{}', pg_temp.rb_id(301), NULL, NULL),
 (pg_temp.rb_id(805), pg_temp.rb_id(1), 'internal', pg_temp.rb_id(801), 'folder', 'Продажи и ответы', '', '{}', pg_temp.rb_id(301), NULL, NULL),
 (pg_temp.rb_id(806), pg_temp.rb_id(1), 'internal', pg_temp.rb_id(801), 'folder', 'Промпты', '', '{}', pg_temp.rb_id(301), NULL, NULL),
 (pg_temp.rb_id(811), pg_temp.rb_id(1), 'internal', pg_temp.rb_id(802), 'page', 'Синтетический вопрос А', 'Ответ А.',
   '{"classification":"historically_approved_general_client_knowledge"}', pg_temp.rb_id(301), NULL, NULL),
 (pg_temp.rb_id(812), pg_temp.rb_id(1), 'internal', pg_temp.rb_id(802), 'page', 'Синтетический вопрос Б', 'Ответ Б.',
   '{"classification":"historically_approved_general_client_knowledge"}', pg_temp.rb_id(301), NULL, NULL),
 (pg_temp.rb_id(813), pg_temp.rb_id(1), 'internal', pg_temp.rb_id(802), 'page', 'Синтетический вопрос В', 'Ответ В.',
   '{"classification":"historically_approved_general_client_knowledge"}', pg_temp.rb_id(301), NULL, NULL),
 (pg_temp.rb_id(814), pg_temp.rb_id(1), 'internal', pg_temp.rb_id(803), 'page', 'Утверждено для ИИ',
   'Отвечайте вежливо и кратко.', '{"classification":"historically_approved_general_client_knowledge"}',
   pg_temp.rb_id(301), NULL, NULL),
 (pg_temp.rb_id(815), pg_temp.rb_id(1), 'internal', pg_temp.rb_id(804), 'page', 'Клиентская база знаний ЭВО',
   'Описание самой базы.', '{"classification":"historically_approved_general_client_knowledge"}', pg_temp.rb_id(301), NULL, NULL),
 (pg_temp.rb_id(816), pg_temp.rb_id(1), 'internal', pg_temp.rb_id(805), 'page', 'FAQ по обучению и визе',
   'Сначала уточните страну, уровень и бюджет.', '{"classification":"historically_approved_internal_knowledge"}',
   pg_temp.rb_id(301), NULL, NULL),
 (pg_temp.rb_id(820), pg_temp.rb_id(1), 'internal', NULL, 'folder', 'Компания', '', '{}', pg_temp.rb_id(301), NULL, NULL),
 (pg_temp.rb_id(821), pg_temp.rb_id(1), 'internal', pg_temp.rb_id(820), 'folder', 'Услуги и условия EVO', '', '{}', pg_temp.rb_id(301), NULL, NULL),
 (pg_temp.rb_id(822), pg_temp.rb_id(1), 'internal', pg_temp.rb_id(820), 'folder', 'Услуги', '', '{}', pg_temp.rb_id(301), NULL, NULL),
 (pg_temp.rb_id(823), pg_temp.rb_id(1), 'internal', pg_temp.rb_id(820), 'folder', 'Компания ЭВО', '', '{}', pg_temp.rb_id(301), NULL, NULL),
 (pg_temp.rb_id(824), pg_temp.rb_id(1), 'internal', pg_temp.rb_id(820), 'folder', 'Старое', '', '{}', pg_temp.rb_id(301), clock_timestamp(), NULL),
 (pg_temp.rb_id(831), pg_temp.rb_id(1), 'internal', pg_temp.rb_id(821), 'page', 'Условия А', 'Условия А.',
   '{"classification":"historically_approved_general_client_knowledge"}', pg_temp.rb_id(301), NULL, NULL),
 (pg_temp.rb_id(832), pg_temp.rb_id(1), 'internal', pg_temp.rb_id(821), 'page', 'Условия Б', 'Условия Б.',
   '{"classification":"historically_approved_general_client_knowledge"}', pg_temp.rb_id(301), NULL, NULL),
 (pg_temp.rb_id(833), pg_temp.rb_id(1), 'internal', pg_temp.rb_id(822), 'page', 'Услуга А', 'Услуга А.',
   '{"classification":"historically_approved_internal_knowledge"}', pg_temp.rb_id(301), NULL, NULL),
 (pg_temp.rb_id(834), pg_temp.rb_id(1), 'internal', pg_temp.rb_id(822), 'page', 'Услуга Б', 'Услуга Б.',
   '{"classification":"historically_approved_internal_knowledge"}', pg_temp.rb_id(301), NULL, NULL),
 (pg_temp.rb_id(835), pg_temp.rb_id(1), 'internal', pg_temp.rb_id(823), 'page', 'Рабочая страница', 'Черновик.',
   '{"classification":"internal_working_material"}', pg_temp.rb_id(301), NULL, NULL),
 (pg_temp.rb_id(836), pg_temp.rb_id(1), 'internal', pg_temp.rb_id(822), 'page', 'Удалённая услуга', 'Удалено.',
   '{"classification":"historically_approved_internal_knowledge"}', pg_temp.rb_id(301), NULL, clock_timestamp()),
 (pg_temp.rb_id(837), pg_temp.rb_id(1), 'internal', pg_temp.rb_id(824), 'page', 'В архивной папке', 'Старое.',
   '{"classification":"historically_approved_internal_knowledge"}', pg_temp.rb_id(301), NULL, NULL),
 (pg_temp.rb_id(840), pg_temp.rb_id(1), 'internal', NULL, 'folder', 'Страны и поступление', '', '{}', pg_temp.rb_id(301), NULL, NULL),
 (pg_temp.rb_id(841), pg_temp.rb_id(1), 'internal', pg_temp.rb_id(840), 'page', 'Обзор стран', 'Обзор.',
   '{"classification":"historically_approved_general_client_knowledge"}', pg_temp.rb_id(301), NULL, NULL),
 (pg_temp.rb_id(842), pg_temp.rb_id(1), 'internal', pg_temp.rb_id(840), 'folder', 'Синтетическая страна', '', '{}', pg_temp.rb_id(301), NULL, NULL),
 (pg_temp.rb_id(843), pg_temp.rb_id(1), 'internal', pg_temp.rb_id(842), 'page', 'Поступление', 'Поступление.',
   '{"classification":"historically_approved_general_client_knowledge"}', pg_temp.rb_id(301), NULL, NULL),
 (pg_temp.rb_id(844), pg_temp.rb_id(1), 'internal', pg_temp.rb_id(842), 'page', 'Вузы', 'Вузы.',
   '{"classification":"historically_approved_internal_knowledge"}', pg_temp.rb_id(301), NULL, NULL),
 (pg_temp.rb_id(845), pg_temp.rb_id(1), 'internal', pg_temp.rb_id(842), 'page', 'Виза', 'Виза.',
   '{"classification":"historically_approved_internal_knowledge"}', pg_temp.rb_id(301), NULL, NULL),
 (pg_temp.rb_id(846), pg_temp.rb_id(1), 'internal', pg_temp.rb_id(842), 'page', 'Заметки', 'Черновик.',
   '{"classification":"internal_working_material"}', pg_temp.rb_id(301), NULL, NULL),
 (pg_temp.rb_id(847), pg_temp.rb_id(1), 'internal', pg_temp.rb_id(842), 'file', 'Прайс.pdf', '',
   '{"classification":"historically_approved_internal_knowledge"}', pg_temp.rb_id(301), NULL, NULL),
 (pg_temp.rb_id(848), pg_temp.rb_id(1), 'internal', pg_temp.rb_id(842), 'page', 'Пустая', '   ',
   '{"classification":"historically_approved_internal_knowledge"}', pg_temp.rb_id(301), NULL, NULL),
 (pg_temp.rb_id(850), pg_temp.rb_id(1), 'internal', NULL, 'folder', 'Панель управления', '', '{}', pg_temp.rb_id(301), NULL, NULL),
 (pg_temp.rb_id(851), pg_temp.rb_id(1), 'internal', pg_temp.rb_id(850), 'page', 'Панель', 'Служебное.',
   '{"classification":"historically_approved_internal_knowledge"}', pg_temp.rb_id(301), NULL, NULL),
 (pg_temp.rb_id(860), pg_temp.rb_id(1), 'raw', NULL, 'folder', 'Страны и поступление', '', '{}', pg_temp.rb_id(301), NULL, NULL),
 (pg_temp.rb_id(861), pg_temp.rb_id(1), 'raw', pg_temp.rb_id(860), 'page', 'Сырой экспорт', 'Сырое.',
   '{"classification":"historically_approved_general_client_knowledge"}', pg_temp.rb_id(301), NULL, NULL);

\set org '26960000-0000-4000-8000-000000000001'
\set admin_uid '26960000-0000-4000-8000-000000000101'
SELECT pg_temp.rb_assert(:'org'::UUID = pg_temp.rb_id(1) AND :'admin_uid'::UUID = pg_temp.rb_id(101),
  'psql variables name the fixture organization and its Admin');
CREATE TEMP TABLE rb_queue_before AS SELECT queue_length FROM pgmq.metrics('ai_agent_work_v1');

-- ---------------------------------------------------------------------------
-- Step 1. Preview (read-only blocks of the runbook).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE rb_preview AS
WITH RECURSIVE tree AS (
  SELECT n.id, n.title AS root, NULL::TEXT AS sub
  FROM platform_private.kb_nodes n
  WHERE n.organization_id = :'org' AND n.area = 'internal' AND n.kind = 'folder'
    AND n.parent_id IS NULL AND n.deleted_at IS NULL AND n.archived_at IS NULL
    AND n.title IN ('ИИ-ассистент', 'Компания', 'Страны и поступление')
  UNION ALL
  SELECT c.id, t.root, COALESCE(t.sub, c.title)
  FROM platform_private.kb_nodes c JOIN tree t ON c.parent_id = t.id
  WHERE c.organization_id = :'org' AND c.area = 'internal'
    AND c.deleted_at IS NULL AND c.archived_at IS NULL
), allow AS (
  SELECT n.id, n.title, t.root, t.sub, n.source ->> 'classification' AS classification
  FROM tree t JOIN platform_private.kb_nodes n ON n.id = t.id
  WHERE n.kind = 'page' AND btrim(n.body) <> ''
    AND n.source ->> 'classification' IN ('historically_approved_general_client_knowledge',
      'historically_approved_internal_knowledge')
)
SELECT CASE
    WHEN classification = 'historically_approved_general_client_knowledge'
      AND (root <> 'ИИ-ассистент' OR sub = 'Вопросы и ответы') THEN '2. Для клиентов'
    WHEN classification = 'historically_approved_internal_knowledge'
      AND root <> 'ИИ-ассистент' THEN '3. Внутреннее'
    WHEN root = 'ИИ-ассистент' AND sub IN ('Правила ответов', 'Продажи и ответы') THEN '4. Правила общения'
    ELSE '-. не копируется' END AS step,
  count(*) AS pages
FROM allow GROUP BY 1 ORDER BY 1;
SELECT pg_temp.rb_assert((SELECT jsonb_object_agg(step, pages) FROM rb_preview)
  = '{"2. Для клиентов": 7, "3. Внутреннее": 4, "4. Правила общения": 2, "-. не копируется": 1}'::JSONB,
  'the preview splits the allowlist like steps 2–4: 7 client, 4 internal, 2 rules pages, the README is not copied');
CREATE TEMP TABLE rb_folder_before AS
WITH RECURSIVE folder AS (
  SELECT n.id, n.kind, n.title::TEXT AS path, n.deleted_at, n.delete_batch
  FROM platform_private.kb_nodes n
  WHERE n.organization_id = :'org' AND n.area = 'internal' AND n.kind = 'folder'
    AND n.parent_id IS NULL AND n.title = 'ИИ-ассистент'
  UNION ALL
  SELECT c.id, c.kind, f.path || ' / ' || c.title, c.deleted_at, c.delete_batch
  FROM platform_private.kb_nodes c JOIN folder f ON c.parent_id = f.id
  WHERE c.organization_id = :'org'
)
SELECT count(*) AS nodes, count(*) FILTER (WHERE kind = 'folder') AS folders,
  count(*) FILTER (WHERE kind = 'page') AS pages, count(*) FILTER (WHERE kind = 'file') AS files,
  count(*) FILTER (WHERE deleted_at IS NOT NULL) AS in_trash, count(DISTINCT delete_batch) AS trash_batches
FROM folder;
SELECT pg_temp.rb_assert((SELECT nodes = 12 AND folders = 6 AND pages = 6 AND files = 0 AND in_trash = 0
    AND trash_batches = 0 FROM rb_folder_before), 'the folder holds 12 nodes (6 folders, 6 pages), none in the trash');

-- ---------------------------------------------------------------------------
-- Step 2 rehearsal: the same block ending in ROLLBACK leaves nothing.
-- ---------------------------------------------------------------------------
\set req '26960000-0000-4000-8000-000000003001'
\set expected '7'
SAVEPOINT rb_rehearsal;
SELECT set_config('request.jwt.claims', (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', :'admin_uid'::UUID,
  'claims', jsonb_build_object('sub', :'admin_uid', 'role', 'authenticated'))) -> 'claims')::TEXT, TRUE);
SELECT set_config('evo.seed_nodes', (
WITH RECURSIVE tree AS (
  SELECT n.id, n.title AS root, NULL::TEXT AS sub
  FROM platform_private.kb_nodes n
  WHERE n.organization_id = :'org' AND n.area = 'internal' AND n.kind = 'folder'
    AND n.parent_id IS NULL AND n.deleted_at IS NULL AND n.archived_at IS NULL
    AND n.title IN ('ИИ-ассистент', 'Компания', 'Страны и поступление')
  UNION ALL
  SELECT c.id, t.root, COALESCE(t.sub, c.title)
  FROM platform_private.kb_nodes c JOIN tree t ON c.parent_id = t.id
  WHERE c.organization_id = :'org' AND c.area = 'internal'
    AND c.deleted_at IS NULL AND c.archived_at IS NULL
), allow AS (
  SELECT n.id, n.title, t.root, t.sub, n.source ->> 'classification' AS classification
  FROM tree t JOIN platform_private.kb_nodes n ON n.id = t.id
  WHERE n.kind = 'page' AND btrim(n.body) <> ''
    AND n.source ->> 'classification' IN ('historically_approved_general_client_knowledge',
      'historically_approved_internal_knowledge')
)
SELECT COALESCE(array_agg(id ORDER BY root, sub, title, id), '{}')::TEXT FROM allow
WHERE classification = 'historically_approved_general_client_knowledge'
  AND (root <> 'ИИ-ассистент' OR sub = 'Вопросы и ответы')
), TRUE);
SELECT set_config('evo.seed_expected', :'expected', TRUE);
DO $guard$
BEGIN
  IF (current_setting('request.jwt.claims')::JSONB ->> 'platform_role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'seed stopped: the claims are not an EVO admin';
  END IF;
  IF cardinality(current_setting('evo.seed_nodes')::UUID[]) IS DISTINCT FROM current_setting('evo.seed_expected')::INTEGER THEN
    RAISE EXCEPTION 'seed stopped: % pages selected, % expected',
      cardinality(current_setting('evo.seed_nodes')::UUID[]), current_setting('evo.seed_expected');
  END IF;
END
$guard$;
SET LOCAL ROLE authenticated;
SELECT platform.ai_agent_seed_from_kb_v1(:'org'::UUID,
  current_setting('evo.seed_nodes')::UUID[], 'document', :'req'::UUID) AS receipt;
ROLLBACK TO SAVEPOINT rb_rehearsal;
RESET ROLE;
SELECT pg_temp.rb_assert(NOT EXISTS (SELECT 1 FROM platform_private.ai_documents d WHERE d.organization_id = :'org')
  AND NOT EXISTS (SELECT 1 FROM platform_private.ai_requests r WHERE r.organization_id = :'org')
  AND NOT EXISTS (SELECT 1 FROM platform.audit_events e WHERE e.organization_id = :'org' AND e.action = 'ai.agent.seed')
  AND (SELECT queue_length FROM pgmq.metrics('ai_agent_work_v1')) = (SELECT queue_length FROM rb_queue_before),
  'the rehearsal leaves no document, receipt, audit event or queue message');

-- ---------------------------------------------------------------------------
-- Step 2: «Для клиентов».
-- ---------------------------------------------------------------------------
SAVEPOINT rb_step2;
SELECT set_config('request.jwt.claims', (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', :'admin_uid'::UUID,
  'claims', jsonb_build_object('sub', :'admin_uid', 'role', 'authenticated'))) -> 'claims')::TEXT, TRUE);
SELECT set_config('evo.seed_nodes', (
WITH RECURSIVE tree AS (
  SELECT n.id, n.title AS root, NULL::TEXT AS sub
  FROM platform_private.kb_nodes n
  WHERE n.organization_id = :'org' AND n.area = 'internal' AND n.kind = 'folder'
    AND n.parent_id IS NULL AND n.deleted_at IS NULL AND n.archived_at IS NULL
    AND n.title IN ('ИИ-ассистент', 'Компания', 'Страны и поступление')
  UNION ALL
  SELECT c.id, t.root, COALESCE(t.sub, c.title)
  FROM platform_private.kb_nodes c JOIN tree t ON c.parent_id = t.id
  WHERE c.organization_id = :'org' AND c.area = 'internal'
    AND c.deleted_at IS NULL AND c.archived_at IS NULL
), allow AS (
  SELECT n.id, n.title, t.root, t.sub, n.source ->> 'classification' AS classification
  FROM tree t JOIN platform_private.kb_nodes n ON n.id = t.id
  WHERE n.kind = 'page' AND btrim(n.body) <> ''
    AND n.source ->> 'classification' IN ('historically_approved_general_client_knowledge',
      'historically_approved_internal_knowledge')
)
SELECT COALESCE(array_agg(id ORDER BY root, sub, title, id), '{}')::TEXT FROM allow
WHERE classification = 'historically_approved_general_client_knowledge'
  AND (root <> 'ИИ-ассистент' OR sub = 'Вопросы и ответы')
), TRUE);
SELECT set_config('evo.seed_expected', :'expected', TRUE);
DO $guard$
BEGIN
  IF (current_setting('request.jwt.claims')::JSONB ->> 'platform_role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'seed stopped: the claims are not an EVO admin';
  END IF;
  IF cardinality(current_setting('evo.seed_nodes')::UUID[]) IS DISTINCT FROM current_setting('evo.seed_expected')::INTEGER THEN
    RAISE EXCEPTION 'seed stopped: % pages selected, % expected',
      cardinality(current_setting('evo.seed_nodes')::UUID[]), current_setting('evo.seed_expected');
  END IF;
END
$guard$;
SET LOCAL ROLE authenticated;
SELECT platform.ai_agent_seed_from_kb_v1(:'org'::UUID,
  current_setting('evo.seed_nodes')::UUID[], 'document', :'req'::UUID) AS receipt;
RELEASE SAVEPOINT rb_step2;
RESET ROLE;
SELECT pg_temp.rb_assert((SELECT array_agg((d.source_ref ->> 'nodeId')::UUID ORDER BY d.source_ref ->> 'nodeId')
    FROM platform_private.ai_documents d WHERE d.organization_id = :'org')
  = (SELECT array_agg(pg_temp.rb_id(n) ORDER BY pg_temp.rb_id(n)::TEXT) FROM unnest(ARRAY[811, 812, 813, 831, 832, 841, 843]) n),
  'step 2 copies the client pages only: «Вопросы и ответы», «Услуги и условия EVO», «Страны и поступление»');
SELECT pg_temp.rb_assert((SELECT bool_and(d.audience = 'client' AND d.status = 'queued' AND d.kind = 'knowledge'
    AND d.source = 'seed_kb' AND NOT d.autosend_allowed AND d.created_by = pg_temp.rb_id(301)
    AND d.content_md = n.body AND d.title = n.title AND d.source_ref ->> 'nodeVersion' = n.version::TEXT)
  FROM platform_private.ai_documents d JOIN platform_private.kb_nodes n ON n.id = (d.source_ref ->> 'nodeId')::UUID
  WHERE d.organization_id = :'org'), 'client audience from the import mark, queued, a copy of the current version by the Admin');
SELECT pg_temp.rb_assert((SELECT queue_length FROM pgmq.metrics('ai_agent_work_v1')) = (SELECT queue_length FROM rb_queue_before) + 7
  AND (SELECT count(*) = 7 FROM pgmq.q_ai_agent_work_v1 q JOIN platform_private.ai_documents d ON d.id = (q.message ->> 'ref_id')::UUID
    WHERE d.organization_id = :'org' AND q.message ->> 'kind' = 'seed' AND q.message - ARRAY['v', 'kind', 'ref_id'] = '{}'::JSONB),
  'one pointer-only seed message per copied page');
SELECT pg_temp.rb_assert((SELECT count(*) = 1 FROM platform.audit_events e WHERE e.organization_id = :'org'
    AND e.action = 'ai.agent.seed' AND e.actor_principal = 'auth:' || :'admin_uid'),
  'the seed is audited in the name of the Admin');
SAVEPOINT rb_step2_again;
SELECT set_config('request.jwt.claims', (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', :'admin_uid'::UUID,
  'claims', jsonb_build_object('sub', :'admin_uid', 'role', 'authenticated'))) -> 'claims')::TEXT, TRUE);
SELECT set_config('evo.seed_nodes', (
WITH RECURSIVE tree AS (
  SELECT n.id, n.title AS root, NULL::TEXT AS sub
  FROM platform_private.kb_nodes n
  WHERE n.organization_id = :'org' AND n.area = 'internal' AND n.kind = 'folder'
    AND n.parent_id IS NULL AND n.deleted_at IS NULL AND n.archived_at IS NULL
    AND n.title IN ('ИИ-ассистент', 'Компания', 'Страны и поступление')
  UNION ALL
  SELECT c.id, t.root, COALESCE(t.sub, c.title)
  FROM platform_private.kb_nodes c JOIN tree t ON c.parent_id = t.id
  WHERE c.organization_id = :'org' AND c.area = 'internal'
    AND c.deleted_at IS NULL AND c.archived_at IS NULL
), allow AS (
  SELECT n.id, n.title, t.root, t.sub, n.source ->> 'classification' AS classification
  FROM tree t JOIN platform_private.kb_nodes n ON n.id = t.id
  WHERE n.kind = 'page' AND btrim(n.body) <> ''
    AND n.source ->> 'classification' IN ('historically_approved_general_client_knowledge',
      'historically_approved_internal_knowledge')
)
SELECT COALESCE(array_agg(id ORDER BY root, sub, title, id), '{}')::TEXT FROM allow
WHERE classification = 'historically_approved_general_client_knowledge'
  AND (root <> 'ИИ-ассистент' OR sub = 'Вопросы и ответы')
), TRUE);
SELECT set_config('evo.seed_expected', :'expected', TRUE);
DO $guard$
BEGIN
  IF (current_setting('request.jwt.claims')::JSONB ->> 'platform_role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'seed stopped: the claims are not an EVO admin';
  END IF;
  IF cardinality(current_setting('evo.seed_nodes')::UUID[]) IS DISTINCT FROM current_setting('evo.seed_expected')::INTEGER THEN
    RAISE EXCEPTION 'seed stopped: % pages selected, % expected',
      cardinality(current_setting('evo.seed_nodes')::UUID[]), current_setting('evo.seed_expected');
  END IF;
END
$guard$;
SET LOCAL ROLE authenticated;
SELECT platform.ai_agent_seed_from_kb_v1(:'org'::UUID,
  current_setting('evo.seed_nodes')::UUID[], 'document', :'req'::UUID) AS receipt;
RELEASE SAVEPOINT rb_step2_again;
RESET ROLE;
SELECT pg_temp.rb_assert((SELECT count(*) = 7 FROM platform_private.ai_documents d WHERE d.organization_id = :'org')
  AND (SELECT count(*) = 1 FROM platform_private.ai_requests r WHERE r.organization_id = :'org')
  AND (SELECT queue_length FROM pgmq.metrics('ai_agent_work_v1')) = (SELECT queue_length FROM rb_queue_before) + 7,
  'running the step again with the same request id replays the receipt and copies nothing');

-- ---------------------------------------------------------------------------
-- Step 3: «Внутреннее».
-- ---------------------------------------------------------------------------
\set req '26960000-0000-4000-8000-000000003002'
\set expected '4'
SAVEPOINT rb_step3;
SELECT set_config('request.jwt.claims', (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', :'admin_uid'::UUID,
  'claims', jsonb_build_object('sub', :'admin_uid', 'role', 'authenticated'))) -> 'claims')::TEXT, TRUE);
SELECT set_config('evo.seed_nodes', (
WITH RECURSIVE tree AS (
  SELECT n.id, n.title AS root, NULL::TEXT AS sub
  FROM platform_private.kb_nodes n
  WHERE n.organization_id = :'org' AND n.area = 'internal' AND n.kind = 'folder'
    AND n.parent_id IS NULL AND n.deleted_at IS NULL AND n.archived_at IS NULL
    AND n.title IN ('ИИ-ассистент', 'Компания', 'Страны и поступление')
  UNION ALL
  SELECT c.id, t.root, COALESCE(t.sub, c.title)
  FROM platform_private.kb_nodes c JOIN tree t ON c.parent_id = t.id
  WHERE c.organization_id = :'org' AND c.area = 'internal'
    AND c.deleted_at IS NULL AND c.archived_at IS NULL
), allow AS (
  SELECT n.id, n.title, t.root, t.sub, n.source ->> 'classification' AS classification
  FROM tree t JOIN platform_private.kb_nodes n ON n.id = t.id
  WHERE n.kind = 'page' AND btrim(n.body) <> ''
    AND n.source ->> 'classification' IN ('historically_approved_general_client_knowledge',
      'historically_approved_internal_knowledge')
)
SELECT COALESCE(array_agg(id ORDER BY root, sub, title, id), '{}')::TEXT FROM allow
WHERE classification = 'historically_approved_internal_knowledge'
  AND root <> 'ИИ-ассистент'
), TRUE);
SELECT set_config('evo.seed_expected', :'expected', TRUE);
DO $guard$
BEGIN
  IF (current_setting('request.jwt.claims')::JSONB ->> 'platform_role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'seed stopped: the claims are not an EVO admin';
  END IF;
  IF cardinality(current_setting('evo.seed_nodes')::UUID[]) IS DISTINCT FROM current_setting('evo.seed_expected')::INTEGER THEN
    RAISE EXCEPTION 'seed stopped: % pages selected, % expected',
      cardinality(current_setting('evo.seed_nodes')::UUID[]), current_setting('evo.seed_expected');
  END IF;
END
$guard$;
SET LOCAL ROLE authenticated;
SELECT platform.ai_agent_seed_from_kb_v1(:'org'::UUID,
  current_setting('evo.seed_nodes')::UUID[], 'document', :'req'::UUID) AS receipt;
RELEASE SAVEPOINT rb_step3;
RESET ROLE;
SELECT pg_temp.rb_assert((SELECT array_agg((d.source_ref ->> 'nodeId')::UUID ORDER BY d.source_ref ->> 'nodeId')
    FROM platform_private.ai_documents d WHERE d.organization_id = :'org' AND d.audience = 'internal')
  = (SELECT array_agg(pg_temp.rb_id(n) ORDER BY pg_temp.rb_id(n)::TEXT) FROM unnest(ARRAY[833, 834, 844, 845]) n),
  'step 3 copies the internal pages of «Компания» and «Страны и поступление» only');
SELECT pg_temp.rb_assert(NOT EXISTS (SELECT 1 FROM platform_private.ai_documents d WHERE d.organization_id = :'org'
    AND (d.source_ref ->> 'nodeId')::UUID IN (SELECT pg_temp.rb_id(n) FROM unnest(ARRAY[814, 815, 816, 835, 836, 837, 846, 847, 848, 851, 861]) n)),
  'rules pages, the README, working material, deleted, archived, file, empty, panel and raw pages are never copied');

-- ---------------------------------------------------------------------------
-- Step 4: «Правила общения».
-- ---------------------------------------------------------------------------
\set req '26960000-0000-4000-8000-000000003003'
\set expected '2'
SAVEPOINT rb_step4;
SELECT set_config('request.jwt.claims', (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', :'admin_uid'::UUID,
  'claims', jsonb_build_object('sub', :'admin_uid', 'role', 'authenticated'))) -> 'claims')::TEXT, TRUE);
SELECT set_config('evo.seed_nodes', (
WITH RECURSIVE tree AS (
  SELECT n.id, n.title AS root, NULL::TEXT AS sub
  FROM platform_private.kb_nodes n
  WHERE n.organization_id = :'org' AND n.area = 'internal' AND n.kind = 'folder'
    AND n.parent_id IS NULL AND n.deleted_at IS NULL AND n.archived_at IS NULL
    AND n.title IN ('ИИ-ассистент', 'Компания', 'Страны и поступление')
  UNION ALL
  SELECT c.id, t.root, COALESCE(t.sub, c.title)
  FROM platform_private.kb_nodes c JOIN tree t ON c.parent_id = t.id
  WHERE c.organization_id = :'org' AND c.area = 'internal'
    AND c.deleted_at IS NULL AND c.archived_at IS NULL
), allow AS (
  SELECT n.id, n.title, t.root, t.sub, n.source ->> 'classification' AS classification
  FROM tree t JOIN platform_private.kb_nodes n ON n.id = t.id
  WHERE n.kind = 'page' AND btrim(n.body) <> ''
    AND n.source ->> 'classification' IN ('historically_approved_general_client_knowledge',
      'historically_approved_internal_knowledge')
)
SELECT COALESCE(array_agg(id ORDER BY CASE sub WHEN 'Правила ответов' THEN 1 ELSE 2 END, title, id), '{}')::TEXT
FROM allow
WHERE root = 'ИИ-ассистент' AND sub IN ('Правила ответов', 'Продажи и ответы')
), TRUE);
SELECT set_config('evo.seed_expected', :'expected', TRUE);
DO $guard$
BEGIN
  IF (current_setting('request.jwt.claims')::JSONB ->> 'platform_role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'seed stopped: the claims are not an EVO admin';
  END IF;
  IF cardinality(current_setting('evo.seed_nodes')::UUID[]) IS DISTINCT FROM current_setting('evo.seed_expected')::INTEGER THEN
    RAISE EXCEPTION 'seed stopped: % pages selected, % expected',
      cardinality(current_setting('evo.seed_nodes')::UUID[]), current_setting('evo.seed_expected');
  END IF;
END
$guard$;
SET LOCAL ROLE authenticated;
SELECT platform.ai_agent_seed_from_kb_v1(:'org'::UUID,
  current_setting('evo.seed_nodes')::UUID[], 'rules', :'req'::UUID) AS receipt;
RELEASE SAVEPOINT rb_step4;
RESET ROLE;
SELECT pg_temp.rb_assert((SELECT r.source = 'seed' AND r.confirmed_at IS NULL AND r.version = 1
    AND r.created_by = pg_temp.rb_id(301)
    AND r.body = E'# Утверждено для ИИ\n\nОтвечайте вежливо и кратко.\n\n# FAQ по обучению и визе\n\nСначала уточните страну, уровень и бюджет.'
    AND r.source_ref -> 'nodes' -> 0 ->> 'nodeId' = pg_temp.rb_id(814)::TEXT
    AND r.source_ref -> 'nodes' -> 1 ->> 'nodeId' = pg_temp.rb_id(816)::TEXT
    AND r.id = s.rules_version_id
  FROM platform_private.ai_rules_versions r JOIN platform_private.ai_settings s ON s.organization_id = r.organization_id
  WHERE r.organization_id = :'org'), 'step 4: the current unconfirmed seed rules, «Правила ответов» first');

-- ---------------------------------------------------------------------------
-- Step 5: the read-only checks of the runbook.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE rb_docs AS
SELECT d.audience, d.status, count(*) AS documents
FROM platform_private.ai_documents d
WHERE d.organization_id = :'org' AND d.source = 'seed_kb'
GROUP BY 1, 2 ORDER BY 1, 2;
SELECT pg_temp.rb_assert((SELECT jsonb_object_agg(audience || '/' || status, documents) FROM rb_docs)
  = '{"client/queued": 7, "internal/queued": 4}'::JSONB, 'the document check sees 7 client and 4 internal queued copies');
CREATE TEMP TABLE rb_failed AS
SELECT d.error_code, count(*) AS documents
FROM platform_private.ai_documents d
WHERE d.organization_id = :'org' AND d.source = 'seed_kb' AND d.status = 'failed'
GROUP BY 1 ORDER BY 1;
SELECT pg_temp.rb_assert(NOT EXISTS (SELECT 1 FROM rb_failed), 'no failed copy');
CREATE TEMP TABLE rb_rules AS
SELECT r.version, r.source, r.confirmed_at IS NOT NULL AS confirmed, octet_length(r.body) AS bytes,
  r.id = s.rules_version_id AS current
FROM platform_private.ai_rules_versions r
JOIN platform_private.ai_settings s ON s.organization_id = r.organization_id
WHERE r.organization_id = :'org'
ORDER BY r.version;
SELECT pg_temp.rb_assert((SELECT count(*) = 1 AND bool_and(version = 1 AND source = 'seed' AND NOT confirmed AND current
    AND bytes > 0) FROM rb_rules), 'the rules check sees one current unconfirmed seed version');
CREATE TEMP TABLE rb_queue AS
SELECT queue_length FROM pgmq.metrics('ai_agent_work_v1');
SELECT pg_temp.rb_assert((SELECT queue_length FROM rb_queue) = (SELECT queue_length FROM rb_queue_before) + 11,
  'the queue check sees the 11 seed pointers');

-- The guard of every write block stops before the call.
SELECT set_config('request.jwt.claims', pg_temp.rb_claims(101), TRUE), set_config('evo.seed_nodes', '{}', TRUE),
  set_config('evo.seed_expected', '1', TRUE);
SELECT pg_temp.rb_assert(pg_temp.rb_err($rb$DO $guard$
BEGIN
  IF (current_setting('request.jwt.claims')::JSONB ->> 'platform_role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'seed stopped: the claims are not an EVO admin';
  END IF;
  IF cardinality(current_setting('evo.seed_nodes')::UUID[]) IS DISTINCT FROM current_setting('evo.seed_expected')::INTEGER THEN
    RAISE EXCEPTION 'seed stopped: % pages selected, % expected',
      cardinality(current_setting('evo.seed_nodes')::UUID[]), current_setting('evo.seed_expected');
  END IF;
END
$guard$$rb$) LIKE 'P0001:seed stopped: 0 pages selected, 1 expected%',
  'a page count other than the preview stops the block');
SELECT set_config('request.jwt.claims', pg_temp.rb_claims(102), TRUE);
SELECT pg_temp.rb_assert(pg_temp.rb_err($rb$DO $guard$
BEGIN
  IF (current_setting('request.jwt.claims')::JSONB ->> 'platform_role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'seed stopped: the claims are not an EVO admin';
  END IF;
  IF cardinality(current_setting('evo.seed_nodes')::UUID[]) IS DISTINCT FROM current_setting('evo.seed_expected')::INTEGER THEN
    RAISE EXCEPTION 'seed stopped: % pages selected, % expected',
      cardinality(current_setting('evo.seed_nodes')::UUID[]), current_setting('evo.seed_expected');
  END IF;
END
$guard$$rb$) LIKE 'P0001:seed stopped: the claims are not an EVO admin%',
  'claims of a staff member who is not an Admin stop the block');
SELECT set_config('request.jwt.claims', pg_temp.rb_claims(101), TRUE);

-- ---------------------------------------------------------------------------
-- Step 6: «В корзину» on the folder (the knowledge UI sends kb_command_v1
-- {op: trash, id, expectedVersion}), then «Восстановить».
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.rb_assert((platform.kb_command_v1(pg_temp.rb_id(1), pg_temp.rb_id(3101),
  jsonb_build_object('op', 'trash', 'id', pg_temp.rb_id(801), 'expectedVersion', 1)) ->> 'deleted_at') IS NOT NULL,
  'the Admin moves the folder to the trash');
RESET ROLE;
CREATE TEMP TABLE rb_folder_after AS
WITH RECURSIVE folder AS (
  SELECT n.id, n.kind, n.title::TEXT AS path, n.deleted_at, n.delete_batch
  FROM platform_private.kb_nodes n
  WHERE n.organization_id = :'org' AND n.area = 'internal' AND n.kind = 'folder'
    AND n.parent_id IS NULL AND n.title = 'ИИ-ассистент'
  UNION ALL
  SELECT c.id, c.kind, f.path || ' / ' || c.title, c.deleted_at, c.delete_batch
  FROM platform_private.kb_nodes c JOIN folder f ON c.parent_id = f.id
  WHERE c.organization_id = :'org'
)
SELECT count(*) AS nodes, count(*) FILTER (WHERE kind = 'folder') AS folders,
  count(*) FILTER (WHERE kind = 'page') AS pages, count(*) FILTER (WHERE kind = 'file') AS files,
  count(*) FILTER (WHERE deleted_at IS NOT NULL) AS in_trash, count(DISTINCT delete_batch) AS trash_batches
FROM folder;
SELECT pg_temp.rb_assert((SELECT nodes = 12 AND in_trash = 12 AND trash_batches = 1 FROM rb_folder_after),
  'the whole folder (12 nodes) is in the trash in one batch');
SELECT pg_temp.rb_assert((SELECT count(*) = 11 FROM platform_private.ai_documents d WHERE d.organization_id = :'org'
    AND d.status = 'queued') AND (SELECT count(*) = 1 FROM platform_private.ai_rules_versions r WHERE r.organization_id = :'org'),
  'the copies and the rules live on after the trash');
SET LOCAL ROLE authenticated;
SELECT pg_temp.rb_assert(pg_temp.rb_err(format('SELECT platform.ai_agent_seed_from_kb_v1(%L, ARRAY[%L]::UUID[], ''document'', %L)',
    pg_temp.rb_id(1), pg_temp.rb_id(811), pg_temp.rb_id(3201))) LIKE '42501:ai_seed_node_not_allowed%',
  'a page in the trash can no longer be copied («Обновить из базы знаний» refuses)');
SELECT pg_temp.rb_assert((platform.kb_command_v1(pg_temp.rb_id(1), pg_temp.rb_id(3102),
  jsonb_build_object('op', 'restore', 'id', pg_temp.rb_id(801), 'expectedVersion', 2)) ->> 'deleted_at') IS NULL,
  'the Admin restores the folder from the trash');
RESET ROLE;
CREATE TEMP TABLE rb_folder_restored AS
WITH RECURSIVE folder AS (
  SELECT n.id, n.kind, n.title::TEXT AS path, n.deleted_at, n.delete_batch
  FROM platform_private.kb_nodes n
  WHERE n.organization_id = :'org' AND n.area = 'internal' AND n.kind = 'folder'
    AND n.parent_id IS NULL AND n.title = 'ИИ-ассистент'
  UNION ALL
  SELECT c.id, c.kind, f.path || ' / ' || c.title, c.deleted_at, c.delete_batch
  FROM platform_private.kb_nodes c JOIN folder f ON c.parent_id = f.id
  WHERE c.organization_id = :'org'
)
SELECT count(*) AS nodes, count(*) FILTER (WHERE kind = 'folder') AS folders,
  count(*) FILTER (WHERE kind = 'page') AS pages, count(*) FILTER (WHERE kind = 'file') AS files,
  count(*) FILTER (WHERE deleted_at IS NOT NULL) AS in_trash, count(DISTINCT delete_batch) AS trash_batches
FROM folder;
SELECT pg_temp.rb_assert((SELECT nodes = 12 AND in_trash = 0 AND trash_batches = 0 FROM rb_folder_restored),
  'restore brings the whole batch back');

SELECT 'AI_SEED_RUNBOOK_SUITE_PASSED' AS rb_suite_result;

ROLLBACK;
