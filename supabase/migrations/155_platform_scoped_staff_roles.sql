-- S2 shared staff authority. Apply together with 156: no mixed-authority release.
-- Extends 041 immutable bundles, 083 live identity and 087 personal grants.
-- https://supabase.com/docs/guides/database/postgres/row-level-security
-- https://supabase.com/docs/guides/api/securing-your-api
-- JWT claims identify a membership; business grants are read live, including
-- Storage/Realtime callers. A permission and its scope must share an assignment.
BEGIN;

ALTER TABLE platform.role_bundle_versions ALTER COLUMN role DROP NOT NULL;
ALTER TABLE platform.role_bundle_permissions ALTER COLUMN bundle_role DROP NOT NULL;
ALTER TABLE platform.role_bundle_permissions ADD CONSTRAINT staff_bundle_permission_bundle_fk
  FOREIGN KEY (bundle_id) REFERENCES platform.role_bundle_versions(id) ON DELETE RESTRICT;
ALTER TABLE platform.role_bundle_versions ADD CONSTRAINT staff_bundle_id_version_key UNIQUE(id,version);
ALTER TABLE platform.organization_memberships ADD COLUMN is_system_admin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE platform.organization_memberships DROP CONSTRAINT organization_memberships_active_authority_check;
ALTER TABLE platform.organization_memberships ADD CONSTRAINT staff_admin_not_student
  CHECK (NOT is_system_admin OR "current_role" IS DISTINCT FROM 'student');
-- Finish membership DDL before this populated backfill queues the existing
-- deferred live-Admin constraint trigger. Keep that check enabled until COMMIT.
UPDATE platform.organization_memberships m SET is_system_admin = TRUE WHERE m."current_role" = 'admin'
 AND EXISTS(SELECT 1 FROM platform.role_bundle_versions b WHERE b.id=m.current_bundle_id AND b.status='published')
 AND platform_private.membership_has_active_scope(m.organization_id,m.id,'organization',m.organization_id);

ALTER TABLE platform.permission_definitions
  ADD COLUMN staff_label TEXT,
  ADD COLUMN staff_group TEXT,
  ADD COLUMN staff_resource_kinds TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN staff_scope_kinds TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN staff_sensitive BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN staff_system_only BOOLEAN NOT NULL DEFAULT TRUE;

INSERT INTO platform.permission_definitions(permission_key, description) VALUES
 ('staff.task.read','Чтение задач команды'),('staff.task.create','Создание задач команды'),
 ('staff.task.edit','Редактирование задач команды'),('staff.task.complete','Выполнение задач команды'),
 ('team.chat.general','Общий чат команды'),('team.chat.sales','Чат отдела продаж'),
 ('team.chat.admissions','Чат сопровождения'),('sales.register.read','Чтение реестра продаж'),
 ('sales.register.manage','Изменение реестра продаж'),('sales.register.import','Импорт реестра продаж'),
 ('sales.register.target.manage','Управление планами продаж'),
 ('staff.assistant.use','Помощник сотрудника'),('team.chat.moderate','Модерация чатов'),
 ('task.create','Создание задач дела'),
 ('task.assign','Назначение исполнителя задачи дела'),('task.visibility.manage','Видимость задачи для студента'),
 ('company.file.read','Просмотр файлов компании'),('company.file.upload','Загрузка файлов компании'),
 ('company.file.download','Скачивание файлов компании'),('company.file.manage','Управление файлами компании'),
 ('case.workflow.read','Просмотр рабочего процесса дела'),
 ('amocrm.command.manage','Отправка команд в amoCRM'),
 ('finance.stop.create','Создание финансового блокера дела'),
 ('reply.snippet.sales','Шаблоны ответов продаж'),('reply.snippet.admissions','Шаблоны ответов сопровождения'),
 ('reply.snippet.all','Общие шаблоны ответов'),('reply.snippet.manage','Создание и изменение своих шаблонов ответов'),
 ('reply.snippet.moderate','Управление чужими шаблонами ответов');

-- Only explicitly classified keys enter editable roles. Student-only keys and
-- unknown future permissions are non-assignable until their resource is defined.
-- 041 makes the complete catalogue row append-only. This single transactional
-- initialization changes only the newly added metadata; the original columns
-- and the exact permanent trigger are checked before leaving this block. The
-- ALTER TABLE lock already held by this migration prevents concurrent writes.
-- No published bundle, constraint trigger, RLS rule or session setting changes.
-- https://www.postgresql.org/docs/current/sql-altertable.html
DO $staff_catalog_metadata$
DECLARE original_catalog JSONB;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t
  WHERE t.tgrelid='platform.permission_definitions'::regclass
  AND t.tgname='permission_definitions_append_only_rows'
  AND t.tgfoid='platform_private.block_append_only_mutation()'::regprocedure
  AND t.tgenabled='O' AND t.tgtype=27 AND NOT t.tgisinternal) THEN
  RAISE EXCEPTION 'staff_catalog_immutability_source_drift' USING ERRCODE='55000';
 END IF;
 SELECT jsonb_agg(jsonb_build_array(permission_key,description,created_at) ORDER BY permission_key)
 INTO original_catalog FROM platform.permission_definitions;
 ALTER TABLE platform.permission_definitions DISABLE TRIGGER permission_definitions_append_only_rows;
UPDATE platform.permission_definitions SET
 staff_label=CASE permission_key
 WHEN 'organization.read' THEN 'Рабочее пространство'
 WHEN 'membership.read' THEN 'Просмотр сотрудников'
 WHEN 'membership.provision' THEN 'Создание учётных записей'
 WHEN 'membership.role.change' THEN 'Управление ролями сотрудников'
 WHEN 'membership.status.change' THEN 'Управление состоянием сотрудников'
 WHEN 'membership.scope.organization.assign' THEN 'Управление доступом организации'
 WHEN 'rbac.read' THEN 'Просмотр прав доступа'
 WHEN 'scope.manage' THEN 'Управление областями доступа'
 WHEN 'audit.read' THEN 'Журнал изменений'
 WHEN 'lead.read' THEN 'Просмотр лидов'
 WHEN 'lead.sales.workflow.manage' THEN 'Работа с лидами'
 WHEN 'lead.sales.owner.assign' THEN 'Назначение ответственного по лиду'
 WHEN 'client.read' THEN 'Просмотр клиентов'
 WHEN 'client.duplicate.resolve' THEN 'Объединение дублей клиентов'
 WHEN 'case.create' THEN 'Создание дел'
 WHEN 'case.read.full' THEN 'Полный просмотр дела'
 WHEN 'case.read.summary' THEN 'Краткий просмотр дела'
 WHEN 'case.curator.assign' THEN 'Назначение куратора'
 WHEN 'case.lifecycle.change' THEN 'Изменение состояния дела'
 WHEN 'case.route.manage' THEN 'Маршрут поступления'
 WHEN 'case.update.append' THEN 'Добавление обновлений дела'
 WHEN 'case.workflow.read' THEN 'Просмотр рабочего процесса дела'
 WHEN 'amocrm.command.manage' THEN 'Отправка команд в amoCRM'
 WHEN 'finance.stop.create' THEN 'Создание финансового блокера дела'
 WHEN 'application.manage' THEN 'Заявки в университеты'
 WHEN 'visa.manage' THEN 'Визовые дела'
 WHEN 'profile.manage' THEN 'Изменение анкеты'
 WHEN 'profile.read.full' THEN 'Полный просмотр анкеты'
 WHEN 'document.read.full' THEN 'Полный просмотр документов'
 WHEN 'document.read.sales' THEN 'Документы для продаж'
 WHEN 'document.upload' THEN 'Загрузка документов'
 WHEN 'document.download' THEN 'Скачивание документов'
 WHEN 'document.manage' THEN 'Управление документами'
 WHEN 'document.review' THEN 'Проверка документов'
 WHEN 'document.validation.attest' THEN 'Подтверждение проверки документов'
 WHEN 'finance.read.full' THEN 'Полный просмотр финансов'
 WHEN 'finance.read.summary' THEN 'Краткий просмотр финансов'
 WHEN 'finance.manage' THEN 'Управление финансовыми обязательствами'
 WHEN 'finance.stop.manage' THEN 'Финансовые стоп-факторы'
 WHEN 'finance.event.confirm' THEN 'Подтверждение платежа — личный допуск'
 WHEN 'finance.first.payment.confirm' THEN 'Первый платёж — личный допуск'
 WHEN 'contract.evidence.confirm' THEN 'Договор — личный допуск'
 WHEN 'admissions.handoff.gate.override' THEN 'Исключение передачи — личный допуск Admin'
 WHEN 'communication.read.full' THEN 'Полная переписка'
 WHEN 'communication.read.summary' THEN 'Краткая переписка'
 WHEN 'communication.manual.send' THEN 'Отправка сообщений'
 WHEN 'communication.manual.send.request' THEN 'Запрос отправки сообщения'
 WHEN 'ai.draft.request' THEN 'Запрос черновика ИИ'
 WHEN 'ai.draft.review' THEN 'Проверка черновика ИИ'
 WHEN 'ai.control.set' THEN 'Настройки ИИ'
 WHEN 'task.create' THEN 'Создание задач дела'
 WHEN 'task.manage' THEN 'Управление задачами дела'
 WHEN 'task.assign' THEN 'Назначение исполнителя задачи дела'
 WHEN 'task.visibility.manage' THEN 'Видимость задачи для студента'
 WHEN 'staff.assistant.use' THEN 'Помощник сотрудника'
 WHEN 'catalog.read' THEN 'Каталог университетов'
 WHEN 'catalog.import.manage' THEN 'Импорт каталога'
 WHEN 'country.requirement.manage' THEN 'Требования стран'
 WHEN 'contract.draft.manage' THEN 'Подготовка договоров'
 WHEN 'contract.template.read' THEN 'Просмотр шаблонов договоров'
 WHEN 'contract.template.manage' THEN 'Редактирование шаблонов договоров'
 WHEN 'workflow.contract.read' THEN 'Просмотр рабочих процессов'
 WHEN 'workflow.contract.manage' THEN 'Редактирование рабочих процессов'
 WHEN 'post.contract.manage' THEN 'Послепродажное сопровождение'
 WHEN 'decision.read' THEN 'Просмотр решений'
 WHEN 'decision.manage' THEN 'Управление решениями'
 WHEN 'knowledge.read.approved' THEN 'Чтение базы знаний'
 WHEN 'knowledge.manage' THEN 'Редактирование базы знаний'
 WHEN 'workreview.read' THEN 'Просмотр очереди проверки'
 WHEN 'workreview.resolve' THEN 'Обработка очереди проверки'
 WHEN 'prompt.artifact.manage' THEN 'Управление инструкциями ИИ'
 WHEN 'notification.create' THEN 'Создание уведомлений'
 ELSE CASE WHEN permission_key LIKE 'staff.task.%' OR permission_key LIKE 'team.chat.%' OR permission_key LIKE 'company.file.%' OR permission_key LIKE 'reply.snippet.%'
 OR permission_key LIKE 'sales.register.%' THEN description ELSE 'Системное разрешение' END END,
 staff_group=CASE split_part(permission_key,'.',1)
 WHEN 'lead' THEN 'Продажи' WHEN 'client' THEN 'Продажи' WHEN 'sales' THEN 'Продажи'
 WHEN 'case' THEN 'Дела' WHEN 'application' THEN 'Поступление' WHEN 'visa' THEN 'Поступление'
 WHEN 'profile' THEN 'Анкета' WHEN 'document' THEN 'Документы' WHEN 'finance' THEN 'Финансы'
 WHEN 'contract' THEN 'Договоры' WHEN 'communication' THEN 'Переписка'
 WHEN 'amocrm' THEN 'Интеграции'
 WHEN 'team' THEN 'Команда' WHEN 'staff' THEN 'Команда' WHEN 'task' THEN 'Задачи'
 WHEN 'knowledge' THEN 'Знания' WHEN 'catalog' THEN 'Каталог' ELSE 'Настройки' END;

UPDATE platform.permission_definitions SET staff_system_only=FALSE,
 staff_resource_kinds=ARRAY['organization'],staff_scope_kinds=ARRAY['organization']
 WHERE permission_key IN ('organization.read','catalog.read','catalog.import.manage','country.requirement.manage',
 'contract.template.read','contract.template.manage','workflow.contract.read','workflow.contract.manage',
 'knowledge.read.approved','knowledge.manage','ai.control.set','prompt.artifact.manage',
 'workreview.read','workreview.resolve','case.create','staff.task.create',
 'team.chat.general','team.chat.sales','team.chat.admissions','team.chat.moderate',
 'staff.assistant.use','sales.register.import','sales.register.target.manage');
UPDATE platform.permission_definitions SET staff_resource_kinds=ARRAY['organization'],
 staff_scope_kinds=ARRAY['organization']
 WHERE permission_key IN ('membership.read','membership.provision','membership.role.change',
 'membership.status.change','membership.scope.organization.assign','rbac.read','scope.manage','audit.read');
UPDATE platform.permission_definitions SET staff_system_only=FALSE,
 staff_resource_kinds=CASE
 WHEN permission_key LIKE 'lead.%' THEN ARRAY['lead']
 WHEN permission_key LIKE 'client.%' THEN ARRAY['client']
 WHEN permission_key='application.manage' THEN ARRAY['student_case','application']
 WHEN permission_key='visa.manage' THEN ARRAY['student_case','visa_case']
 WHEN permission_key LIKE 'document.%' THEN ARRAY['student_case','document_slot','document']
 WHEN permission_key='finance.stop.create' THEN ARRAY['student_case']
 WHEN permission_key LIKE 'finance.%' THEN ARRAY['student_case','finance_record']
 WHEN permission_key='amocrm.command.manage' THEN ARRAY['lead','student_case']
 WHEN permission_key LIKE 'communication.%' OR permission_key IN ('ai.draft.request','ai.draft.review','decision.read','decision.manage') THEN ARRAY['conversation','student_case']
 WHEN permission_key LIKE 'staff.task.%' THEN ARRAY['staff_task']
 WHEN permission_key LIKE 'sales.register.%' THEN ARRAY['sales_register']
 WHEN permission_key LIKE 'task.%' THEN ARRAY['student_case','task']
 ELSE ARRAY['student_case'] END,
 staff_scope_kinds=ARRAY['own','organization','department','direction','record']
 WHERE permission_key IN ('lead.read','lead.sales.workflow.manage','lead.sales.owner.assign',
 'client.read','client.duplicate.resolve','case.read.full','case.read.summary','case.curator.assign',
 'case.lifecycle.change','case.route.manage','case.update.append','case.workflow.read','application.manage','visa.manage',
 'profile.manage','profile.read.full','document.read.full','document.read.sales','document.upload',
 'document.download','document.manage','document.review','document.validation.attest',
 'finance.read.full','finance.read.summary','finance.manage','finance.stop.manage','finance.stop.create',
 'amocrm.command.manage',
 'communication.read.full','communication.read.summary','communication.manual.send','communication.manual.send.request',
 'ai.draft.request','ai.draft.review','task.create','task.manage','task.assign','task.visibility.manage','contract.draft.manage',
 'post.contract.manage','decision.read','decision.manage','notification.create',
 'staff.task.read','staff.task.edit','staff.task.complete','sales.register.read','sales.register.manage');
UPDATE platform.permission_definitions SET staff_scope_kinds=ARRAY['own','organization','department','record']
 WHERE permission_key LIKE 'staff.task.%' AND permission_key<>'staff.task.create'
 OR permission_key IN ('sales.register.read','sales.register.manage');
UPDATE platform.permission_definitions SET staff_system_only=FALSE,staff_group='Файлы компании',
 staff_resource_kinds=ARRAY['organization','company_file'],staff_scope_kinds=ARRAY['organization']
 WHERE permission_key LIKE 'company.file.%';
UPDATE platform.permission_definitions SET staff_system_only=FALSE,staff_group='Шаблоны ответов',
 staff_resource_kinds=ARRAY['organization'],staff_scope_kinds=ARRAY['organization']
 WHERE permission_key LIKE 'reply.snippet.%';
UPDATE platform.permission_definitions SET staff_sensitive=TRUE,staff_system_only=TRUE,
 staff_resource_kinds=ARRAY['organization','lead','student_case','finance_record'],
 staff_scope_kinds=ARRAY['organization']
 WHERE permission_key IN ('contract.evidence.confirm','finance.event.confirm',
 'finance.first.payment.confirm','admissions.handoff.gate.override');
 ALTER TABLE platform.permission_definitions ENABLE TRIGGER permission_definitions_append_only_rows;
 IF original_catalog IS DISTINCT FROM (
  SELECT jsonb_agg(jsonb_build_array(permission_key,description,created_at) ORDER BY permission_key)
  FROM platform.permission_definitions)
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t
  WHERE t.tgrelid='platform.permission_definitions'::regclass
  AND t.tgname='permission_definitions_append_only_rows'
  AND t.tgfoid='platform_private.block_append_only_mutation()'::regprocedure
  AND t.tgenabled='O' AND t.tgtype=27 AND NOT t.tgisinternal) THEN
  RAISE EXCEPTION 'staff_catalog_immutability_changed' USING ERRCODE='55000';
 END IF;
END $staff_catalog_metadata$;

CREATE TABLE platform.staff_role_definitions (
 id UUID PRIMARY KEY,organization_id UUID NOT NULL REFERENCES platform.organizations(id),
 label TEXT NOT NULL CHECK(char_length(btrim(label)) BETWEEN 1 AND 120),
 description TEXT NOT NULL DEFAULT '' CHECK(char_length(description)<=2000),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
 version BIGINT NOT NULL DEFAULT 1 CHECK(version>0),
 current_bundle_id UUID REFERENCES platform.role_bundle_versions(id),
 draft_permission_keys TEXT[] NOT NULL DEFAULT '{}',
 created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
 UNIQUE(organization_id,id)
);
CREATE INDEX staff_roles_org_idx ON platform.staff_role_definitions(organization_id,status);
CREATE INDEX staff_roles_bundle_idx ON platform.staff_role_definitions(current_bundle_id);
CREATE TABLE platform.staff_role_bundle_bindings (
 organization_id UUID NOT NULL,role_id UUID NOT NULL,bundle_id UUID NOT NULL UNIQUE
 REFERENCES platform.role_bundle_versions(id),bundle_version BIGINT NOT NULL CHECK(bundle_version>0),
 PRIMARY KEY(organization_id,role_id,bundle_id),UNIQUE(organization_id,role_id,bundle_version),
 FOREIGN KEY(bundle_id,bundle_version) REFERENCES platform.role_bundle_versions(id,version),
 FOREIGN KEY(organization_id,role_id) REFERENCES platform.staff_role_definitions(organization_id,id)
);
ALTER TABLE platform.staff_role_definitions ADD CONSTRAINT staff_role_current_bundle_fk
 FOREIGN KEY(organization_id,id,current_bundle_id)
 REFERENCES platform.staff_role_bundle_bindings(organization_id,role_id,bundle_id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE platform.staff_role_assignments (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),organization_id UUID NOT NULL,
 membership_id UUID NOT NULL,role_id UUID NOT NULL,bundle_id UUID NOT NULL,
 scope_kind TEXT NOT NULL CHECK(scope_kind IN ('own','organization','department','direction','record')),
 scope_key TEXT,resource_kind TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),revoked_at TIMESTAMPTZ,
 FOREIGN KEY(organization_id,membership_id) REFERENCES platform.organization_memberships(organization_id,id),
 FOREIGN KEY(organization_id,role_id,bundle_id) REFERENCES platform.staff_role_bundle_bindings(organization_id,role_id,bundle_id),
 CHECK((scope_kind='own' AND scope_key IS NULL AND resource_kind IS NULL)
 OR (scope_kind IN ('organization','department','direction') AND scope_key IS NOT NULL AND resource_kind IS NULL)
 OR (scope_kind='record' AND scope_key IS NOT NULL AND resource_kind IS NOT NULL)),
 CHECK(scope_kind<>'organization' OR scope_key=organization_id::TEXT),
 CHECK(scope_kind<>'direction' OR scope_key IN ('CN','MY','EUROPE','AE','TR'))
);
CREATE INDEX staff_assignments_member_idx ON platform.staff_role_assignments(organization_id,membership_id) WHERE revoked_at IS NULL;
CREATE INDEX staff_assignments_role_idx ON platform.staff_role_assignments(organization_id,role_id,bundle_id);
CREATE INDEX staff_assignments_bundle_idx ON platform.staff_role_assignments(bundle_id);
CREATE TABLE platform_private.staff_role_command_receipts (
 request_id UUID PRIMARY KEY,organization_id UUID NOT NULL REFERENCES platform.organizations(id),
 actor_profile_id UUID NOT NULL REFERENCES platform.profiles(id),
 command JSONB NOT NULL,result JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp()
);
CREATE INDEX staff_role_receipts_actor_idx ON platform_private.staff_role_command_receipts(actor_profile_id);
CREATE INDEX staff_role_receipts_org_idx ON platform_private.staff_role_command_receipts(organization_id);

-- Finish table DDL before the backfill queues deferred current-bundle FK checks.
ALTER TABLE platform.staff_role_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.staff_role_definitions FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.staff_role_bundle_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.staff_role_bundle_bindings FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.staff_role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.staff_role_assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.staff_role_command_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.staff_role_command_receipts FORCE ROW LEVEL SECURITY;

-- Preserve the Student branch exactly. Copies are callable only by the explicit
-- Student dispatcher below; existing public/private function OIDs stay in place.
DO $copy_student$
DECLARE source TEXT; pair TEXT[];
BEGIN
 FOREACH pair SLICE 1 IN ARRAY ARRAY[
 ARRAY['private.platform_has_permission(uuid,text)','private.platform_has_permission','private.student_has_permission_pre_scoped_roles'],
 ARRAY['private.platform_has_scope(uuid,platform.scope_kind,uuid)','private.platform_has_scope','private.student_has_scope_pre_scoped_roles'],
 ARRAY['platform.current_actor_authority()','platform.current_actor_authority','platform_private.student_actor_pre_scoped_roles'],
 ARRAY['platform_private.custom_access_token_hook(jsonb)','platform_private.custom_access_token_hook','platform_private.student_token_pre_scoped_roles']]
 LOOP
  source:=pg_get_functiondef(to_regprocedure(pair[1]));
  IF source IS NULL OR strpos(source,pair[2]||'(')=0 THEN RAISE EXCEPTION 'staff_foundation_source_drift'; END IF;
  EXECUTE replace(source,pair[2]||'(',pair[3]||'(');
 END LOOP;
END $copy_student$;

CREATE FUNCTION platform_private.staff_membership_identity(p_organization_id UUID,p_membership_id UUID)
RETURNS TABLE(auth_user_id UUID,profile_id UUID,membership_id UUID,organization_id UUID,
 display_name TEXT,system_role TEXT,access_version BIGINT,coarse_role platform.business_role)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p.auth_user_id,p.id,m.id,m.organization_id,p.display_name,
 CASE WHEN m.is_system_admin THEN 'admin' ELSE 'staff' END,p.access_version,
 CASE WHEN m.is_system_admin THEN 'admin'::platform.business_role
 WHEN m."current_role"='admin' THEN NULL::platform.business_role ELSE m."current_role" END
 FROM platform.organization_memberships m JOIN platform.profiles p ON p.id=m.profile_id
 JOIN platform.organizations o ON o.id=m.organization_id
 WHERE m.organization_id=p_organization_id AND m.id=p_membership_id
 AND m.status='active' AND p.status='active' AND o.status='active'
 AND m."current_role" IS DISTINCT FROM 'student'
$$;

CREATE FUNCTION platform_private.staff_has_permission(p_organization_id UUID,p_membership_id UUID,p_permission_key TEXT)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM platform_private.staff_membership_identity(p_organization_id,p_membership_id) i
 JOIN platform.permission_definitions d ON d.permission_key=p_permission_key
 WHERE cardinality(d.staff_resource_kinds)>0 AND CASE
 WHEN d.staff_sensitive THEN (p_permission_key<>'admissions.handoff.gate.override' OR i.system_role='admin')
 AND platform_private.latest_membership_permission_grant(p_organization_id,p_membership_id,
 CASE WHEN p_permission_key='finance.event.confirm' THEN 'finance.first.payment.confirm' ELSE p_permission_key END)
 WHEN i.system_role='admin' THEN TRUE
 WHEN d.staff_system_only THEN FALSE
 ELSE EXISTS(SELECT 1 FROM platform.staff_role_assignments a
 JOIN platform.staff_role_definitions r ON r.organization_id=a.organization_id AND r.id=a.role_id AND r.status='active'
 JOIN platform.role_bundle_versions b ON b.id=a.bundle_id AND b.status='published'
 JOIN platform.role_bundle_permissions bp ON bp.bundle_id=b.id AND bp.permission_key=p_permission_key
 WHERE a.organization_id=p_organization_id AND a.membership_id=p_membership_id AND a.revoked_at IS NULL
 AND r.current_bundle_id=a.bundle_id) END)
$$;

CREATE OR REPLACE FUNCTION private.platform_has_permission(p_organization_id UUID,p_permission_key TEXT)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN EXISTS(SELECT 1 FROM platform.organization_memberships m JOIN platform.profiles p ON p.id=m.profile_id
 WHERE m.organization_id=p_organization_id AND p.auth_user_id=(SELECT auth.uid()) AND m."current_role"='student')
 THEN private.student_has_permission_pre_scoped_roles(p_organization_id,p_permission_key)
 ELSE EXISTS(SELECT 1 FROM platform.organization_memberships m JOIN platform.profiles p ON p.id=m.profile_id
 WHERE m.organization_id=p_organization_id AND p.auth_user_id=(SELECT auth.uid())
 AND m.id::TEXT=(SELECT auth.jwt()->>'platform_membership_id')
 AND m.organization_id::TEXT=(SELECT auth.jwt()->>'platform_organization_id')
 AND platform_private.staff_has_permission(m.organization_id,m.id,p_permission_key)) END
$$;

CREATE OR REPLACE FUNCTION private.platform_has_scope(p_organization_id UUID,p_scope_kind platform.scope_kind,p_scope_key UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN EXISTS(SELECT 1 FROM platform.organization_memberships m JOIN platform.profiles p ON p.id=m.profile_id
 WHERE m.organization_id=p_organization_id AND p.auth_user_id=(SELECT auth.uid()) AND m."current_role"='student')
 THEN private.student_has_scope_pre_scoped_roles(p_organization_id,p_scope_kind,p_scope_key)
 -- An unpaired legacy scope cannot prove a staff business action.
 ELSE EXISTS(SELECT 1 FROM platform.organization_memberships m
 JOIN platform_private.staff_membership_identity(m.organization_id,m.id) i ON TRUE
 WHERE m.organization_id=p_organization_id AND i.auth_user_id=(SELECT auth.uid()) AND i.system_role='admin'
 AND m.id::TEXT=(SELECT auth.jwt()->>'platform_membership_id')
 AND m.organization_id::TEXT=(SELECT auth.jwt()->>'platform_organization_id')
 AND p_scope_kind='organization' AND p_scope_key=p_organization_id) END
$$;

CREATE OR REPLACE FUNCTION platform.current_actor_authority()
RETURNS TABLE(auth_user_id UUID,profile_id UUID,membership_id UUID,organization_id UUID,
 display_name TEXT,platform_role platform.business_role,platform_access_version BIGINT)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT i.auth_user_id,i.profile_id,i.membership_id,i.organization_id,i.display_name,i.coarse_role,i.access_version
 FROM platform.organization_memberships m JOIN platform_private.staff_membership_identity(m.organization_id,m.id) i ON TRUE
 WHERE i.auth_user_id=(SELECT auth.uid())
 AND i.membership_id::TEXT=(SELECT auth.jwt()->>'platform_membership_id')
 AND i.organization_id::TEXT=(SELECT auth.jwt()->>'platform_organization_id')
 UNION ALL SELECT s.* FROM platform_private.student_actor_pre_scoped_roles() s
 WHERE s.platform_role='student'
$$;

CREATE OR REPLACE FUNCTION platform_private.custom_access_token_hook(event JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE i RECORD; claims JSONB;
BEGIN
 IF EXISTS(SELECT 1 FROM platform.profiles p JOIN platform.organization_memberships m ON m.profile_id=p.id
 WHERE p.auth_user_id=(event->>'user_id')::UUID AND m.status='active' AND m."current_role"='student') THEN
  RETURN platform_private.student_token_pre_scoped_roles(event);
 END IF;
 claims:=COALESCE(event->'claims','{}'::JSONB)-ARRAY['platform_role','platform_access_version',
 'platform_organization_id','platform_membership_id','platform_bundle_id','platform_bundle_version'];
 SELECT identity.* INTO i FROM platform.organization_memberships m
 JOIN platform_private.staff_membership_identity(m.organization_id,m.id) identity ON TRUE
 WHERE identity.auth_user_id=(event->>'user_id')::UUID;
 IF FOUND THEN claims:=claims||jsonb_build_object('platform_role',COALESCE(i.coarse_role::TEXT,'staff'),
 'platform_access_version',i.access_version,'platform_organization_id',i.organization_id,
 'platform_membership_id',i.membership_id); END IF;
 RETURN jsonb_set(event,'{claims}',claims);
END $$;

-- Backfill only identities that previously had the published bundle and login
-- scope. Org-only actions and owner actions get different immutable bundles.
-- Current owner/scope inconsistencies need an explicit decision, not widening.
DO $backfill$
DECLARE legacy RECORD; segment TEXT; keys TEXT[]; new_role UUID; new_bundle UUID; title TEXT; guard_detail JSONB;
BEGIN
 IF EXISTS(SELECT 1 FROM platform.student_cases c
 JOIN platform.organization_memberships m ON m.organization_id=c.organization_id AND
 ((c.state='pending' AND m.id=c.responsible_sales_membership_id)
 OR (c.state IN ('active','closed') AND m.id=c.current_curator_membership_id))
 WHERE NOT m.is_system_admin AND m."current_role" IN ('sales','curator')
 AND platform_private.membership_has_active_scope(m.organization_id,m.id,'organization',m.organization_id)
 AND ((c.state='pending' AND m."current_role"<>'sales') OR (c.state IN ('active','closed') AND m."current_role"<>'curator')
 OR NOT platform_private.membership_has_active_scope(m.organization_id,m.id,'student_case',c.id)))
 OR EXISTS(SELECT 1 FROM platform.leads l JOIN platform.organization_memberships m
 ON m.organization_id=l.organization_id AND m.id=l.current_owner_membership_id
 WHERE NOT m.is_system_admin AND m."current_role"='curator'
 AND platform_private.membership_has_active_scope(m.organization_id,m.id,'organization',m.organization_id)) THEN
  -- Independent aggregate counts only; categories may overlap. Keep row data private.
  WITH selected_owners AS (
   SELECT c.state,c.id AS case_id,m.organization_id,m.id AS membership_id,m."current_role" AS owner_role
   FROM platform.student_cases c JOIN platform.organization_memberships m
    ON m.organization_id=c.organization_id AND
    ((c.state='pending' AND m.id=c.responsible_sales_membership_id)
     OR (c.state IN ('active','closed') AND m.id=c.current_curator_membership_id))
   WHERE NOT m.is_system_admin AND m."current_role" IN ('sales','curator')
    AND platform_private.membership_has_active_scope(m.organization_id,m.id,'organization',m.organization_id)
  )
  SELECT jsonb_build_object(
   'pending_owner_role_mismatch',(SELECT count(*) FROM selected_owners WHERE state='pending' AND owner_role<>'sales'),
   'active_closed_owner_role_mismatch',(SELECT count(*) FROM selected_owners WHERE state IN ('active','closed') AND owner_role<>'curator'),
   'selected_owner_missing_case_scope',(SELECT count(*) FROM selected_owners
    WHERE NOT platform_private.membership_has_active_scope(organization_id,membership_id,'student_case',case_id)),
   'curator_owned_lead',(SELECT count(*) FROM platform.leads l JOIN platform.organization_memberships m
    ON m.organization_id=l.organization_id AND m.id=l.current_owner_membership_id
    WHERE NOT m.is_system_admin AND m."current_role"='curator'
     AND platform_private.membership_has_active_scope(m.organization_id,m.id,'organization',m.organization_id))
  ) INTO guard_detail;
  RAISE EXCEPTION 'staff_backfill_owner_scope_requires_review' USING ERRCODE='23514', DETAIL=guard_detail::TEXT;
 END IF;
 FOR legacy IN SELECT DISTINCT m.organization_id,m."current_role" AS role,m.current_bundle_id
 FROM platform.organization_memberships m JOIN platform.role_bundle_versions b ON b.id=m.current_bundle_id AND b.status='published'
 WHERE m."current_role" IN ('sales','curator') AND NOT m.is_system_admin
 AND platform_private.membership_has_active_scope(m.organization_id,m.id,'organization',m.organization_id)
 ORDER BY m.organization_id,m."current_role",m.current_bundle_id LOOP
  FOREACH segment IN ARRAY ARRAY['own','organization'] LOOP
   SELECT COALESCE(array_agg(k ORDER BY k),'{}') INTO keys FROM (
    SELECT bp.permission_key AS k FROM platform.role_bundle_permissions bp
    JOIN platform.permission_definitions d ON d.permission_key=bp.permission_key
    WHERE bp.bundle_id=legacy.current_bundle_id AND NOT d.staff_system_only AND NOT d.staff_sensitive
    AND (CASE WHEN segment='organization' THEN d.staff_scope_kinds=ARRAY['organization']::TEXT[]
      ELSE 'own'=ANY(d.staff_scope_kinds) END)
    AND NOT(legacy.role='sales' AND bp.permission_key='task.manage')
    UNION SELECT k FROM unnest(CASE WHEN segment='organization' THEN
     ARRAY['staff.task.create','staff.assistant.use','team.chat.general',
     CASE WHEN legacy.role='sales' THEN 'team.chat.sales' ELSE 'team.chat.admissions' END]
     ELSE ARRAY['staff.task.read','staff.task.edit','staff.task.complete'] END) k
    UNION SELECT 'task.create' WHERE segment='own' AND EXISTS(SELECT 1 FROM platform.role_bundle_permissions bp
     WHERE bp.bundle_id=legacy.current_bundle_id AND bp.permission_key='task.manage')
    UNION SELECT 'case.workflow.read' WHERE segment='own' AND EXISTS(SELECT 1 FROM platform.role_bundle_permissions bp
     WHERE bp.bundle_id=legacy.current_bundle_id AND bp.permission_key='workflow.contract.read')
    -- These old role-gated writes are separate from read authority. The domain
    -- commands retain their handoff/read prerequisites after the permission check.
    UNION SELECT 'amocrm.command.manage' WHERE segment='own'
     AND EXISTS(SELECT 1 FROM platform.role_bundle_permissions bp
      WHERE bp.bundle_id=legacy.current_bundle_id AND bp.permission_key='lead.read')
     AND (legacy.role='sales' OR EXISTS(SELECT 1 FROM platform.role_bundle_permissions bp
      WHERE bp.bundle_id=legacy.current_bundle_id AND bp.permission_key='case.read.full'))
    UNION SELECT 'finance.stop.create' WHERE segment='own' AND legacy.role='curator'
     AND EXISTS(SELECT 1 FROM platform.role_bundle_permissions bp
      WHERE bp.bundle_id=legacy.current_bundle_id AND bp.permission_key='case.read.full')
     AND EXISTS(SELECT 1 FROM platform.role_bundle_permissions bp
      WHERE bp.bundle_id=legacy.current_bundle_id AND bp.permission_key='finance.read.summary')
    UNION SELECT k FROM unnest(ARRAY['reply.snippet.all','reply.snippet.manage',
     CASE WHEN legacy.role='sales' THEN 'reply.snippet.sales' ELSE 'reply.snippet.admissions' END]) k
     WHERE segment='organization' AND EXISTS(SELECT 1 FROM platform.role_bundle_permissions bp
     WHERE bp.bundle_id=legacy.current_bundle_id AND bp.permission_key='communication.manual.send')
    UNION SELECT k FROM unnest(ARRAY['sales.register.read','sales.register.manage']) k
     WHERE segment='own' AND legacy.role='sales'
    UNION SELECT k FROM unnest(ARRAY['company.file.read','company.file.download']) k
     WHERE segment='organization' AND legacy.role='curator' AND EXISTS(SELECT 1 FROM platform.role_bundle_permissions bp
     WHERE bp.bundle_id=legacy.current_bundle_id AND bp.permission_key='document.download')
    UNION SELECT k FROM unnest(ARRAY['company.file.upload','company.file.manage']) k
     WHERE segment='organization' AND legacy.role='curator' AND EXISTS(SELECT 1 FROM platform.role_bundle_permissions bp
     WHERE bp.bundle_id=legacy.current_bundle_id AND bp.permission_key='document.upload')
   ) entries;
   IF cardinality(keys)=0 THEN CONTINUE; END IF;
   new_role:=gen_random_uuid(); new_bundle:=gen_random_uuid();
   title:=CASE WHEN legacy.role='sales' THEN 'Продажи' ELSE 'Сопровождение' END
     ||CASE WHEN segment='own' THEN ' — свои записи' ELSE ' — общие разделы' END;
   INSERT INTO platform.staff_role_definitions(id,organization_id,label,description,draft_permission_keys)
    VALUES(new_role,legacy.organization_id,title,'Перенесено из опубликованной роли; прежние области сохранены.',keys);
   INSERT INTO platform.role_bundle_versions(id,role,version,label) VALUES(new_bundle,NULL,1,title);
   INSERT INTO platform.role_bundle_permissions(bundle_id,bundle_role,permission_key)
    SELECT new_bundle,NULL,k FROM unnest(keys) k;
   UPDATE platform.role_bundle_versions SET status='published',published_at=statement_timestamp() WHERE id=new_bundle;
   INSERT INTO platform.staff_role_bundle_bindings VALUES(legacy.organization_id,new_role,new_bundle,1);
   UPDATE platform.staff_role_definitions SET current_bundle_id=new_bundle WHERE id=new_role;
   INSERT INTO platform.staff_role_assignments(organization_id,membership_id,role_id,bundle_id,scope_kind,scope_key)
    SELECT m.organization_id,m.id,new_role,new_bundle,segment,CASE WHEN segment='organization' THEN m.organization_id::TEXT END
    FROM platform.organization_memberships m WHERE m.organization_id=legacy.organization_id AND m."current_role"=legacy.role
    AND m.current_bundle_id=legacy.current_bundle_id AND NOT m.is_system_admin
    AND platform_private.membership_has_active_scope(m.organization_id,m.id,'organization',m.organization_id);
  END LOOP;
 END LOOP;
 INSERT INTO platform.audit_events(organization_id,actor_kind,actor_principal,action,resource_type,resource_id,
  after_state,reason,request_id)
 SELECT o.id,'system','migration:155','staff.roles.migrated','organization',o.id,
  jsonb_build_object('schemaVersion',1,'roleCount',(SELECT count(*) FROM platform.staff_role_definitions r WHERE r.organization_id=o.id)),
  'Split legacy global actions from canonical-owner actions; preserved protected authority',gen_random_uuid()
 FROM platform.organizations o;
END $backfill$;

CREATE OR REPLACE FUNCTION platform_private.require_domain_actor_read(p_organization_id UUID,p_permission_key TEXT)
RETURNS TABLE(actor_profile_id UUID,actor_membership_id UUID,actor_auth_user_id UUID,actor_role platform.business_role)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 RETURN QUERY SELECT a.profile_id,a.membership_id,a.auth_user_id,a.platform_role
 FROM platform.current_actor_authority() a WHERE a.organization_id=p_organization_id
 AND private.platform_has_permission(p_organization_id,p_permission_key);
 IF NOT FOUND THEN RAISE EXCEPTION 'Active Platform permission is required' USING ERRCODE='42501'; END IF;
END $$;
CREATE OR REPLACE FUNCTION platform_private.require_domain_actor(p_organization_id UUID,p_permission_key TEXT)
RETURNS TABLE(actor_profile_id UUID,actor_membership_id UUID,actor_auth_user_id UUID,actor_role platform.business_role)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM platform.organizations WHERE id=p_organization_id FOR UPDATE;
 PERFORM 1 FROM platform.profiles p WHERE p.auth_user_id=(SELECT auth.uid()) FOR UPDATE;
 PERFORM 1 FROM platform.organization_memberships m JOIN platform.profiles p ON p.id=m.profile_id
 WHERE m.organization_id=p_organization_id AND p.auth_user_id=(SELECT auth.uid()) FOR UPDATE OF m;
 RETURN QUERY SELECT * FROM platform_private.require_domain_actor_read(p_organization_id,p_permission_key);
END $$;

-- A row exists only for a real resource in this tenant. Multiple owner contexts
-- are separate rows, never a mix of one case's owner and another's direction.
CREATE FUNCTION platform_private.staff_resource_context(p_organization_id UUID,p_permission_key TEXT,
 p_resource_kind TEXT,p_resource_id UUID)
RETURNS TABLE(owner_membership_id UUID,student_case_id UUID,direction TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE case_id UUID; owner_id UUID; has_resource BOOLEAN:=FALSE;
BEGIN
 IF p_resource_id IS NULL THEN RETURN; END IF;
 IF p_resource_kind='organization' THEN
  RETURN QUERY SELECT NULL::UUID,NULL::UUID,NULL::TEXT FROM platform.organizations o
  WHERE o.id=p_organization_id AND o.id=p_resource_id AND o.status='active'; RETURN;
 ELSIF p_resource_kind='company_file' THEN
  RETURN QUERY SELECT NULL::UUID,NULL::UUID,NULL::TEXT FROM platform.company_files f
  WHERE f.organization_id=p_organization_id AND f.id=p_resource_id; RETURN;
 ELSIF p_resource_kind='sales_register' THEN
  RETURN QUERY SELECT r.owner_membership_id,NULL::UUID,NULL::TEXT FROM platform_private.sales_register r
  WHERE r.organization_id=p_organization_id AND r.id=p_resource_id; RETURN;
 ELSIF p_resource_kind='staff_task' THEN
  RETURN QUERY SELECT owners.id,NULL::UUID,NULL::TEXT FROM platform.staff_tasks t
  CROSS JOIN LATERAL (SELECT t.creator_membership_id AS id WHERE p_permission_key IN ('staff.task.read','staff.task.edit')
  UNION SELECT t.assignee_membership_id WHERE p_permission_key IN ('staff.task.read','staff.task.complete')) owners
  WHERE t.organization_id=p_organization_id AND t.id=p_resource_id; RETURN;
 ELSIF p_resource_kind='lead' THEN
  RETURN QUERY SELECT l.current_owner_membership_id,NULL::UUID,NULL::TEXT FROM platform.leads l
  WHERE l.organization_id=p_organization_id AND l.id=p_resource_id;
  IF p_permission_key='lead.read' THEN
   RETURN QUERY SELECT c.current_curator_membership_id,c.id,c.admissions_direction
   FROM platform.student_cases c JOIN platform.leads l ON l.organization_id=c.organization_id
   AND c.canonical_lead_id=l.id
   WHERE l.organization_id=p_organization_id AND l.id=p_resource_id;
  END IF;
  -- Direct lead ownership gets the direction only from that lead's own case.
  RETURN QUERY SELECT l.current_owner_membership_id,c.id,c.admissions_direction
  FROM platform.leads l JOIN platform.student_cases c ON c.organization_id=l.organization_id AND c.canonical_lead_id=l.id
  WHERE l.organization_id=p_organization_id AND l.id=p_resource_id; RETURN;
 ELSIF p_resource_kind='client' THEN
  RETURN QUERY SELECT l.current_owner_membership_id,NULL::UUID,NULL::TEXT
  FROM platform.clients cl LEFT JOIN platform.leads l ON l.organization_id=cl.organization_id AND l.client_id=cl.id
  WHERE cl.organization_id=p_organization_id AND cl.id=p_resource_id;
  RETURN QUERY SELECT c.current_curator_membership_id,c.id,c.admissions_direction FROM platform.student_cases c
  WHERE c.organization_id=p_organization_id AND
  (c.canonical_client_id=p_resource_id OR EXISTS(SELECT 1 FROM platform.leads l
  WHERE l.organization_id=c.organization_id AND l.id=c.canonical_lead_id AND l.client_id=p_resource_id)); RETURN;
 ELSIF p_resource_kind='student_case' THEN
  SELECT c.id INTO case_id FROM platform.student_cases c WHERE c.organization_id=p_organization_id AND c.id=p_resource_id;
 ELSIF p_resource_kind='application' THEN
  SELECT a.student_case_id INTO case_id FROM platform.university_applications a WHERE a.organization_id=p_organization_id AND a.id=p_resource_id;
 ELSIF p_resource_kind='visa_case' THEN
  SELECT v.student_case_id INTO case_id FROM platform.visa_cases v WHERE v.organization_id=p_organization_id AND v.id=p_resource_id;
 ELSIF p_resource_kind='document_slot' THEN
  SELECT s.student_case_id INTO case_id FROM platform.document_slots s WHERE s.organization_id=p_organization_id AND s.id=p_resource_id;
 ELSIF p_resource_kind='document' THEN
  SELECT v.student_case_id INTO case_id FROM platform.document_versions v WHERE v.organization_id=p_organization_id AND v.id=p_resource_id;
 ELSIF p_resource_kind='finance_record' THEN
  SELECT f.student_case_id INTO case_id FROM (
   SELECT o.student_case_id FROM platform.payment_obligations o WHERE o.organization_id=p_organization_id AND o.id=p_resource_id
   UNION SELECT e.student_case_id FROM platform.payment_events e WHERE e.organization_id=p_organization_id AND e.id=p_resource_id
  ) f LIMIT 1;
 ELSIF p_resource_kind='task' THEN
  RETURN QUERY SELECT t.assignee_membership_id,c.id,c.admissions_direction
  FROM platform.case_tasks t JOIN platform.student_cases c ON c.organization_id=t.organization_id AND c.id=t.student_case_id
  WHERE t.organization_id=p_organization_id AND t.id=p_resource_id; RETURN;
 ELSIF p_resource_kind='conversation' THEN
  SELECT c.student_case_id,CASE WHEN c.queue='sales' OR p_permission_key='communication.read.summary' THEN c.responsible_sales_membership_id
   ELSE c.current_curator_membership_id END,TRUE INTO case_id,owner_id,has_resource
  FROM platform.communication_conversations c WHERE c.organization_id=p_organization_id AND c.id=p_resource_id;
  IF has_resource THEN
   RETURN QUERY SELECT owner_id,c.id,c.admissions_direction FROM platform.student_cases c
   WHERE c.organization_id=p_organization_id AND c.id=case_id;
   IF case_id IS NULL THEN RETURN QUERY SELECT owner_id,NULL::UUID,NULL::TEXT; END IF;
   RETURN;
  END IF;
 ELSE RETURN;
 END IF;
 IF case_id IS NULL THEN RETURN; END IF;
 RETURN QUERY SELECT CASE
  WHEN p_permission_key IN ('case.read.summary','document.read.sales','communication.read.summary') THEN c.responsible_sales_membership_id
  WHEN c.state='pending' THEN c.responsible_sales_membership_id ELSE c.current_curator_membership_id END,
 c.id,c.admissions_direction FROM platform.student_cases c WHERE c.organization_id=p_organization_id AND c.id=case_id;
 IF p_permission_key='finance.read.summary' THEN
  RETURN QUERY SELECT c.responsible_sales_membership_id,c.id,c.admissions_direction FROM platform.student_cases c
  WHERE c.organization_id=p_organization_id AND c.id=case_id;
 END IF;
END $$;

CREATE FUNCTION platform_private.staff_validate_permission_keys(p_keys JSONB)
RETURNS TEXT[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result TEXT[];
BEGIN
 IF p_keys IS NULL OR jsonb_typeof(p_keys)<>'array' OR jsonb_array_length(p_keys)>200
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_keys) e WHERE jsonb_typeof(e)<>'string') THEN
  RAISE EXCEPTION 'staff_roles_invalid_permissions' USING ERRCODE='22023'; END IF;
 SELECT COALESCE(array_agg(k ORDER BY k),'{}') INTO result FROM jsonb_array_elements_text(p_keys) k;
 IF cardinality(result)<>(SELECT count(DISTINCT k) FROM unnest(result) k)
 OR EXISTS(SELECT 1 FROM unnest(result) k LEFT JOIN platform.permission_definitions d ON d.permission_key=k
 WHERE d.permission_key IS NULL OR d.staff_system_only OR d.staff_sensitive OR cardinality(d.staff_scope_kinds)=0) THEN
  RAISE EXCEPTION 'staff_roles_protected_permission' USING ERRCODE='22023'; END IF;
 RETURN result;
END $$;

CREATE FUNCTION platform_private.staff_validate_role_scope(p_organization_id UUID,p_role_id UUID,p_scope JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r platform.staff_role_definitions%ROWTYPE; kind TEXT; key TEXT; resource TEXT; key_id UUID;
BEGIN
 IF p_scope IS NULL OR jsonb_typeof(p_scope)<>'object' OR NOT(p_scope ?& ARRAY['kind','key','resourceKind'])
 OR (SELECT count(*) FROM jsonb_object_keys(p_scope))<>3 OR jsonb_typeof(p_scope->'kind')<>'string'
 OR jsonb_typeof(p_scope->'key') NOT IN ('string','null') OR jsonb_typeof(p_scope->'resourceKind') NOT IN ('string','null') THEN
  RAISE EXCEPTION 'staff_roles_invalid_scope' USING ERRCODE='22023'; END IF;
 kind:=p_scope->>'kind'; key:=p_scope->>'key'; resource:=p_scope->>'resourceKind';
 SELECT * INTO r FROM platform.staff_role_definitions WHERE organization_id=p_organization_id AND id=p_role_id
 AND status='active' AND current_bundle_id IS NOT NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'staff_roles_unpublished_role' USING ERRCODE='22023'; END IF;
 IF kind NOT IN ('own','organization','department','direction','record')
 OR ((kind='own')<>(key IS NULL)) OR ((kind='record')<>(resource IS NOT NULL))
 OR (kind='direction' AND key NOT IN ('CN','MY','EUROPE','AE','TR')) THEN
  RAISE EXCEPTION 'staff_roles_invalid_scope' USING ERRCODE='22023'; END IF;
 IF kind IN ('organization','department','record') THEN
  IF key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
   RAISE EXCEPTION 'staff_roles_invalid_scope' USING ERRCODE='22023'; END IF;
  key_id:=key::UUID; key:=key_id::TEXT;
 END IF;
 IF (kind='organization' AND key_id<>p_organization_id)
 OR (kind='department' AND NOT EXISTS(SELECT 1 FROM platform.staff_departments d
  WHERE d.organization_id=p_organization_id AND d.id=key_id AND d.status='active'))
 OR EXISTS(SELECT 1 FROM platform.role_bundle_permissions bp JOIN platform.permission_definitions d ON d.permission_key=bp.permission_key
  WHERE bp.bundle_id=r.current_bundle_id AND (d.staff_system_only OR d.staff_sensitive OR NOT(kind=ANY(d.staff_scope_kinds))
   OR (kind='record' AND NOT(resource=ANY(d.staff_resource_kinds))))) THEN
  RAISE EXCEPTION 'staff_roles_unsupported_scope' USING ERRCODE='22023'; END IF;
 IF kind='record' AND NOT EXISTS(SELECT 1 FROM platform.role_bundle_permissions bp
 CROSS JOIN LATERAL platform_private.staff_resource_context(p_organization_id,bp.permission_key,resource,key_id) c
 WHERE bp.bundle_id=r.current_bundle_id) THEN
  RAISE EXCEPTION 'staff_roles_record_missing' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('kind',kind,'key',key,'resourceKind',resource);
END $$;

CREATE FUNCTION platform_private.staff_lock_memberships(p_organization_id UUID,p_membership_ids UUID[])
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM platform.profiles p JOIN platform.organization_memberships m ON m.profile_id=p.id
 WHERE m.organization_id=p_organization_id AND m.id=ANY(p_membership_ids) ORDER BY p.id FOR UPDATE OF p;
 PERFORM 1 FROM platform.organization_memberships m WHERE m.organization_id=p_organization_id
 AND m.id=ANY(p_membership_ids) ORDER BY m.id FOR UPDATE;
END $$;
CREATE FUNCTION platform_private.staff_bump_memberships(p_organization_id UUID,p_membership_ids UUID[])
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM platform.profiles p JOIN platform.organization_memberships m ON m.profile_id=p.id
 WHERE m.organization_id=p_organization_id AND m.id=ANY(p_membership_ids) AND p.access_version>=9007199254740991) THEN
  RAISE EXCEPTION 'staff_access_version_invalid' USING ERRCODE='22023'; END IF;
 UPDATE platform.profiles p SET access_version=p.access_version+1
 FROM platform.organization_memberships m WHERE m.profile_id=p.id AND m.organization_id=p_organization_id
 AND m.id=ANY(p_membership_ids);
END $$;

CREATE FUNCTION platform_private.staff_role_request_begin(p_organization_id UUID,p_request_id UUID,p_command JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor RECORD; receipt platform_private.staff_role_command_receipts%ROWTYPE;
BEGIN
 IF p_organization_id IS NULL OR p_request_id IS NULL OR p_command IS NULL
 OR char_length(btrim(COALESCE(p_command->>'reason',''))) NOT BETWEEN 1 AND 500 THEN
  RAISE EXCEPTION 'staff_roles_invalid_request' USING ERRCODE='22023'; END IF;
 -- All mutations serialize first on the organization, including last-Admin and
 -- role/assignment replacement. Never acquire role/member locks before this.
 PERFORM 1 FROM platform.organizations WHERE id=p_organization_id FOR UPDATE;
 SELECT * INTO actor FROM platform_private.require_admin_actor(p_organization_id,'membership.role.change');
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::TEXT,155));
 SELECT * INTO receipt FROM platform_private.staff_role_command_receipts WHERE request_id=p_request_id;
 IF FOUND THEN
  IF receipt.organization_id<>p_organization_id OR receipt.actor_profile_id<>actor.actor_profile_id OR receipt.command<>p_command THEN
   RAISE EXCEPTION 'staff_roles_request_conflict' USING ERRCODE='23505'; END IF;
  RETURN receipt.result||jsonb_build_object('status','replayed');
 END IF;
 IF EXISTS(SELECT 1 FROM platform.audit_events WHERE request_id=p_request_id) THEN
  RAISE EXCEPTION 'staff_roles_request_conflict' USING ERRCODE='23505'; END IF;
 RETURN NULL;
END $$;
CREATE FUNCTION platform_private.staff_role_request_finish(p_organization_id UUID,p_request_id UUID,
 p_command JSONB,p_result JSONB,p_action TEXT,p_resource_type TEXT,p_resource_id UUID,p_before JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor RECORD;
BEGIN
 -- Own self-demotion may just have changed systemRole. Identity, not a fresh
 -- Admin check, supplies attribution after the command already authorized.
 SELECT * INTO actor FROM platform.current_actor_authority() WHERE organization_id=p_organization_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'staff_roles_actor_missing' USING ERRCODE='42501'; END IF;
 INSERT INTO platform.audit_events(organization_id,actor_kind,actor_profile_id,actor_principal,action,
 resource_type,resource_id,before_state,after_state,reason,request_id)
 VALUES(p_organization_id,'user',actor.profile_id,'auth:'||actor.auth_user_id::TEXT,p_action,p_resource_type,
 p_resource_id,p_before,p_result||jsonb_build_object('command',p_command),btrim(p_command->>'reason'),p_request_id);
 INSERT INTO platform_private.staff_role_command_receipts(request_id,organization_id,actor_profile_id,command,result)
 VALUES(p_request_id,p_organization_id,actor.profile_id,p_command,p_result);
 RETURN p_result;
END $$;

CREATE FUNCTION platform_private.staff_replace_assignments(p_organization_id UUID,p_membership_id UUID,p_assignments JSONB)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE entry JSONB; validated JSONB; role_id UUID; normalized JSONB:='[]';
BEGIN
 IF p_assignments IS NULL OR jsonb_typeof(p_assignments)<>'array' OR jsonb_array_length(p_assignments)>100 THEN
  RAISE EXCEPTION 'staff_roles_invalid_assignments' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM platform.organization_memberships m WHERE m.organization_id=p_organization_id
 AND m.id=p_membership_id AND m."current_role" IS DISTINCT FROM 'student') THEN
  RAISE EXCEPTION 'staff_roles_member_missing' USING ERRCODE='22023'; END IF;
 FOR entry IN SELECT * FROM jsonb_array_elements(p_assignments) LOOP
  IF jsonb_typeof(entry)<>'object' OR NOT(entry ?& ARRAY['roleId','scope']) OR
  (SELECT count(*) FROM jsonb_object_keys(entry))<>2 OR jsonb_typeof(entry->'roleId')<>'string' THEN
   RAISE EXCEPTION 'staff_roles_invalid_assignments' USING ERRCODE='22023'; END IF;
  role_id:=(entry->>'roleId')::UUID;
  validated:=platform_private.staff_validate_role_scope(p_organization_id,role_id,entry->'scope');
  normalized:=normalized||jsonb_build_array(jsonb_build_object('roleId',role_id,'scope',validated));
 END LOOP;
 IF jsonb_array_length(normalized)<>(SELECT count(DISTINCT e) FROM jsonb_array_elements(normalized) e) THEN
  RAISE EXCEPTION 'staff_roles_duplicate_assignment' USING ERRCODE='22023'; END IF;
 UPDATE platform.staff_role_assignments SET revoked_at=statement_timestamp()
 WHERE organization_id=p_organization_id AND membership_id=p_membership_id AND revoked_at IS NULL;
 INSERT INTO platform.staff_role_assignments(organization_id,membership_id,role_id,bundle_id,scope_kind,scope_key,resource_kind)
 SELECT p_organization_id,p_membership_id,r.id,r.current_bundle_id,e->'scope'->>'kind',e->'scope'->>'key',e->'scope'->>'resourceKind'
 FROM jsonb_array_elements(normalized) e JOIN platform.staff_role_definitions r ON r.organization_id=p_organization_id AND r.id=(e->>'roleId')::UUID;
END $$;

-- The one paired matcher receives only contexts derived by private domain
-- resolvers. Neither this function nor those resolvers are granted to clients.
CREATE FUNCTION platform_private.staff_context_can_access(p_organization_id UUID,p_membership_id UUID,
 p_permission_key TEXT,p_resource_kind TEXT,p_resource_id UUID,p_owner_membership_id UUID,
 p_student_case_id UUID,p_direction TEXT)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM platform_private.staff_membership_identity(p_organization_id,p_membership_id) i
 JOIN platform.permission_definitions d ON d.permission_key=p_permission_key
 WHERE p_resource_kind=ANY(d.staff_resource_kinds)
 AND platform_private.staff_has_permission(p_organization_id,p_membership_id,p_permission_key)
 AND CASE WHEN d.staff_sensitive THEN TRUE WHEN i.system_role='admin' THEN TRUE ELSE
 EXISTS(SELECT 1 FROM platform.staff_role_assignments a
 JOIN platform.staff_role_definitions r ON r.organization_id=a.organization_id AND r.id=a.role_id
  AND r.status='active' AND r.current_bundle_id=a.bundle_id
 JOIN platform.role_bundle_versions b ON b.id=a.bundle_id AND b.status='published'
 JOIN platform.role_bundle_permissions bp ON bp.bundle_id=a.bundle_id AND bp.permission_key=p_permission_key
 WHERE a.organization_id=p_organization_id AND a.membership_id=p_membership_id AND a.revoked_at IS NULL
 AND a.scope_kind=ANY(d.staff_scope_kinds) AND CASE a.scope_kind
 WHEN 'organization' THEN a.scope_key=p_organization_id::TEXT
 WHEN 'own' THEN p_owner_membership_id=p_membership_id
 WHEN 'department' THEN EXISTS(SELECT 1 FROM platform.staff_organizational_details od
  JOIN platform.staff_departments dept ON dept.organization_id=od.organization_id AND dept.id=od.department_id AND dept.status='active'
  WHERE od.organization_id=p_organization_id AND od.membership_id=p_owner_membership_id AND dept.id::TEXT=a.scope_key)
 WHEN 'direction' THEN p_direction IS NOT NULL AND p_direction=a.scope_key
 WHEN 'record' THEN (a.resource_kind=p_resource_kind AND a.scope_key=p_resource_id::TEXT)
  OR (a.resource_kind='student_case' AND a.scope_key=p_student_case_id::TEXT)
 ELSE FALSE END) END)
$$;
CREATE FUNCTION platform_private.staff_access_evaluate(p_organization_id UUID,p_membership_id UUID,
 p_permission_key TEXT,p_resource_kind TEXT,p_resource_id UUID,p_receiving_assignment BOOLEAN)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH contexts AS (
  SELECT * FROM platform_private.staff_resource_context(p_organization_id,p_permission_key,p_resource_kind,p_resource_id)
  UNION ALL SELECT p_membership_id,NULL::UUID,NULL::TEXT WHERE p_receiving_assignment AND p_resource_id IS NULL
   AND p_resource_kind IN ('lead','staff_task','sales_register')
 )
 SELECT EXISTS(SELECT 1 FROM contexts c
 WHERE (NOT p_receiving_assignment OR p_resource_kind IN ('lead','student_case','application','visa_case','task','staff_task','sales_register'))
 AND platform_private.staff_context_can_access(p_organization_id,p_membership_id,p_permission_key,p_resource_kind,p_resource_id,
 CASE WHEN p_receiving_assignment THEN p_membership_id ELSE c.owner_membership_id END,c.student_case_id,c.direction))
$$;
CREATE FUNCTION platform_private.staff_can_create_for_owner(p_organization_id UUID,p_membership_id UUID,
 p_permission_key TEXT,p_resource_kind TEXT,p_owner_membership_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT ((p_owner_membership_id IS NULL OR EXISTS(SELECT 1 FROM platform_private.staff_membership_identity(p_organization_id,p_owner_membership_id)))
 AND ((p_resource_kind='lead' AND p_permission_key='lead.sales.workflow.manage')
  OR (p_resource_kind='sales_register' AND p_permission_key='sales.register.manage'))
 AND platform_private.staff_context_can_access(p_organization_id,p_membership_id,p_permission_key,p_resource_kind,NULL,
 p_owner_membership_id,NULL,NULL))
$$;
CREATE FUNCTION platform_private.staff_can_access(p_organization_id UUID,p_membership_id UUID,
 p_permission_key TEXT,p_resource_kind TEXT,p_resource_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT platform_private.staff_access_evaluate(p_organization_id,p_membership_id,p_permission_key,p_resource_kind,p_resource_id,FALSE)
$$;
CREATE FUNCTION platform_private.staff_can_receive_assignment(p_organization_id UUID,p_membership_id UUID,
 p_permission_key TEXT,p_resource_kind TEXT,p_resource_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT platform_private.staff_access_evaluate(p_organization_id,p_membership_id,p_permission_key,p_resource_kind,p_resource_id,TRUE)
$$;
CREATE FUNCTION platform_private.staff_can_access_for_actor(p_organization_id UUID,p_permission_key TEXT,
 p_resource_kind TEXT,p_resource_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM platform.current_actor_authority() a WHERE a.organization_id=p_organization_id
 AND platform_private.staff_can_access(a.organization_id,a.membership_id,p_permission_key,p_resource_kind,p_resource_id))
$$;
CREATE OR REPLACE FUNCTION platform_private.require_admin_actor(p_organization_id UUID,p_permission_key TEXT)
RETURNS TABLE(actor_profile_id UUID,actor_membership_id UUID,actor_auth_user_id UUID)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 RETURN QUERY SELECT i.profile_id,i.membership_id,i.auth_user_id FROM platform.current_actor_authority() a
 JOIN platform_private.staff_membership_identity(a.organization_id,a.membership_id) i ON TRUE
 WHERE a.organization_id=p_organization_id AND i.system_role='admin'
 AND platform_private.staff_has_permission(a.organization_id,a.membership_id,p_permission_key);
 IF NOT FOUND THEN RAISE EXCEPTION 'System Admin is required' USING ERRCODE='42501'; END IF;
END $$;

CREATE FUNCTION platform.staff_role_command(p_organization_id UUID,p_role_id UUID,p_expected_version BIGINT,
 p_operation TEXT,p_payload JSONB,p_reason TEXT,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE command JSONB; result JSONB; r platform.staff_role_definitions%ROWTYPE;
 replacement platform.staff_role_definitions%ROWTYPE; source_role platform.staff_role_definitions%ROWTYPE;
 before_state JSONB; keys TEXT[]; affected UUID[]; assignment RECORD; replacement_id UUID;
BEGIN
 command:=jsonb_build_object('operation',p_operation,'roleId',p_role_id,'expectedVersion',p_expected_version,
  'payload',p_payload,'reason',btrim(p_reason));
 result:=platform_private.staff_role_request_begin(p_organization_id,p_request_id,command);
 IF result IS NOT NULL THEN RETURN result; END IF;
 IF p_role_id IS NULL OR p_expected_version IS NULL OR p_expected_version<0 OR p_expected_version>=9007199254740991
 OR p_operation IS NULL OR p_operation NOT IN ('create','copy','save','archive','restore')
 OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
  RAISE EXCEPTION 'staff_roles_invalid_command' USING ERRCODE='22023'; END IF;
 SELECT * INTO r FROM platform.staff_role_definitions WHERE organization_id=p_organization_id AND id=p_role_id FOR UPDATE;
 IF p_operation IN ('create','copy') THEN
  IF FOUND OR p_expected_version<>0 THEN RAISE EXCEPTION 'staff_roles_version_conflict' USING ERRCODE='40001'; END IF;
 ELSE
  IF NOT FOUND OR r.version<>p_expected_version THEN RAISE EXCEPTION 'staff_roles_version_conflict' USING ERRCODE='40001'; END IF;
  before_state:=to_jsonb(r);
 END IF;
 IF p_operation IN ('create','copy','save') THEN
  IF NOT(p_payload ?& ARRAY['label','description','permissionKeys'])
  OR (SELECT count(*) FROM jsonb_object_keys(p_payload))<>(CASE WHEN p_operation='copy' THEN 4 ELSE 3 END)
  OR jsonb_typeof(p_payload->'label')<>'string' OR jsonb_typeof(p_payload->'description')<>'string'
  OR char_length(btrim(p_payload->>'label')) NOT BETWEEN 1 AND 120
  OR char_length(p_payload->>'description')>2000 OR (p_payload->>'label') ~ '[[:cntrl:]]' THEN
   RAISE EXCEPTION 'staff_roles_invalid_label' USING ERRCODE='22023'; END IF;
  keys:=platform_private.staff_validate_permission_keys(p_payload->'permissionKeys');
  IF p_operation='copy' THEN
   SELECT * INTO source_role FROM platform.staff_role_definitions
   WHERE organization_id=p_organization_id AND id=(p_payload->>'sourceRoleId')::UUID;
   IF NOT FOUND THEN RAISE EXCEPTION 'staff_roles_source_missing' USING ERRCODE='22023'; END IF;
  END IF;
  IF p_operation='save' THEN
   IF r.status<>'active' THEN RAISE EXCEPTION 'staff_roles_archived' USING ERRCODE='22023'; END IF;
   UPDATE platform.staff_role_definitions SET label=btrim(p_payload->>'label'),description=p_payload->>'description',
    draft_permission_keys=keys,version=version+1,updated_at=statement_timestamp() WHERE id=r.id;
  ELSE
   INSERT INTO platform.staff_role_definitions(id,organization_id,label,description,draft_permission_keys)
    VALUES(p_role_id,p_organization_id,btrim(p_payload->>'label'),p_payload->>'description',keys);
  END IF;
 ELSIF p_operation='restore' THEN
  IF p_payload<>'{}'::JSONB OR r.status<>'archived' THEN RAISE EXCEPTION 'staff_roles_invalid_restore' USING ERRCODE='22023'; END IF;
  UPDATE platform.staff_role_definitions SET status='active',version=version+1,updated_at=statement_timestamp() WHERE id=r.id;
 ELSE
  IF r.status<>'active' OR NOT(p_payload ?& ARRAY['replacementRoleId','revokeAssignments'])
  OR (SELECT count(*) FROM jsonb_object_keys(p_payload))<>2
  OR jsonb_typeof(p_payload->'replacementRoleId') NOT IN ('string','null')
  OR jsonb_typeof(p_payload->'revokeAssignments')<>'boolean' THEN
   RAISE EXCEPTION 'staff_roles_invalid_archive' USING ERRCODE='22023'; END IF;
  replacement_id:=(p_payload->>'replacementRoleId')::UUID;
  SELECT COALESCE(array_agg(DISTINCT a.membership_id ORDER BY a.membership_id),'{}') INTO affected
   FROM platform.staff_role_assignments a WHERE a.organization_id=p_organization_id AND a.role_id=r.id AND a.revoked_at IS NULL;
  IF replacement_id IS NOT NULL THEN
   IF replacement_id=r.id OR (p_payload->>'revokeAssignments')::BOOLEAN THEN
    RAISE EXCEPTION 'staff_roles_invalid_replacement' USING ERRCODE='22023'; END IF;
   SELECT * INTO replacement FROM platform.staff_role_definitions WHERE organization_id=p_organization_id AND id=replacement_id
    AND status='active' AND current_bundle_id IS NOT NULL;
   IF NOT FOUND THEN RAISE EXCEPTION 'staff_roles_unpublished_role' USING ERRCODE='22023'; END IF;
   FOR assignment IN SELECT * FROM platform.staff_role_assignments a WHERE a.organization_id=p_organization_id
   AND a.role_id=r.id AND a.revoked_at IS NULL LOOP
    PERFORM platform_private.staff_validate_role_scope(p_organization_id,replacement_id,
     jsonb_build_object('kind',assignment.scope_kind,'key',assignment.scope_key,'resourceKind',assignment.resource_kind));
   END LOOP;
  ELSIF cardinality(affected)>0 AND NOT(p_payload->>'revokeAssignments')::BOOLEAN THEN
   RAISE EXCEPTION 'staff_roles_archive_requires_resolution' USING ERRCODE='22023';
  END IF;
  PERFORM platform_private.staff_lock_memberships(p_organization_id,affected);
  WITH revoked AS (UPDATE platform.staff_role_assignments SET revoked_at=statement_timestamp()
   WHERE organization_id=p_organization_id AND role_id=r.id AND revoked_at IS NULL RETURNING *)
  INSERT INTO platform.staff_role_assignments(organization_id,membership_id,role_id,bundle_id,scope_kind,scope_key,resource_kind)
   SELECT organization_id,membership_id,replacement_id,replacement.current_bundle_id,scope_kind,scope_key,resource_kind
   FROM revoked WHERE replacement_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM platform.staff_role_assignments existing
    WHERE existing.organization_id=p_organization_id AND existing.membership_id=revoked.membership_id
    AND existing.role_id=replacement_id AND existing.scope_kind=revoked.scope_kind
    AND existing.scope_key IS NOT DISTINCT FROM revoked.scope_key
    AND existing.resource_kind IS NOT DISTINCT FROM revoked.resource_kind AND existing.revoked_at IS NULL);
  PERFORM platform_private.staff_bump_memberships(p_organization_id,affected);
  UPDATE platform.staff_role_definitions SET status='archived',version=version+1,updated_at=statement_timestamp() WHERE id=r.id;
 END IF;
 result:=jsonb_build_object('status','applied','roleId',p_role_id,'version',p_expected_version+1);
 RETURN platform_private.staff_role_request_finish(p_organization_id,p_request_id,command,result,
  'staff.role.'||p_operation,'staff_role',p_role_id,before_state);
END $$;

-- One canonical reviewed publication input. Live assignment IDs and complete
-- scopes detect both newly affected people and changed assignments for a person
-- already shown in the impact screen. No personal fields enter the fingerprint.
CREATE FUNCTION platform_private.staff_role_impact_fingerprint(p_organization_id UUID,p_role_id UUID)
RETURNS TEXT LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object(
  'schemaVersion',1,'organizationId',r.organization_id,'roleId',r.id,
  'roleVersion',r.version,'status',r.status,'bundleId',r.current_bundle_id,
  'bundleVersion',(SELECT b.bundle_version FROM platform.staff_role_bundle_bindings b
    WHERE b.organization_id=r.organization_id AND b.role_id=r.id AND b.bundle_id=r.current_bundle_id),
  'draftPermissionKeys',COALESCE((SELECT jsonb_agg(k ORDER BY k) FROM unnest(r.draft_permission_keys) k),'[]'::JSONB),
  'publishedPermissionKeys',COALESCE((SELECT jsonb_agg(bp.permission_key ORDER BY bp.permission_key)
    FROM platform.role_bundle_permissions bp WHERE bp.bundle_id=r.current_bundle_id),'[]'::JSONB),
  'assignments',COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id',a.id,'membershipId',a.membership_id,'bundleId',a.bundle_id,
    'scopeKind',a.scope_kind,'scopeKey',a.scope_key,'resourceKind',a.resource_kind) ORDER BY a.id)
    FROM platform.staff_role_assignments a WHERE a.organization_id=r.organization_id
      AND a.role_id=r.id AND a.revoked_at IS NULL),'[]'::JSONB)
 )::TEXT,'UTF8')),'hex')
 FROM platform.staff_role_definitions r WHERE r.organization_id=p_organization_id AND r.id=p_role_id
$$;

-- The ordinary member editor supplies a separate published-role binding set.
-- Shared assignment/scope validation and invitation157 preparation stay intact.
CREATE FUNCTION platform_private.staff_validate_assignment_bindings(p_organization_id UUID,
 p_assignments JSONB,p_expected_role_bindings JSONB)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE entry JSONB; v_role_id UUID; seen UUID[]:='{}';
BEGIN
 IF p_assignments IS NULL OR jsonb_typeof(p_assignments)<>'array' OR jsonb_array_length(p_assignments)>100
 OR p_expected_role_bindings IS NULL OR jsonb_typeof(p_expected_role_bindings)<>'array'
 OR jsonb_array_length(p_expected_role_bindings)>100 THEN
  RAISE EXCEPTION 'staff_roles_invalid_bindings' USING ERRCODE='22023'; END IF;
 FOR entry IN SELECT * FROM jsonb_array_elements(p_assignments) LOOP
  IF jsonb_typeof(entry)<>'object' OR NOT(entry ?& ARRAY['roleId','scope'])
  OR (SELECT count(*) FROM jsonb_object_keys(entry))<>2 OR jsonb_typeof(entry->'roleId')<>'string' THEN
   RAISE EXCEPTION 'staff_roles_invalid_assignments' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF jsonb_array_length(p_expected_role_bindings)<>(SELECT count(DISTINCT (a->>'roleId')::UUID)
  FROM jsonb_array_elements(p_assignments) a) THEN
  RAISE EXCEPTION 'staff_roles_invalid_bindings' USING ERRCODE='22023'; END IF;
 FOR entry IN SELECT * FROM jsonb_array_elements(p_expected_role_bindings) LOOP
  IF jsonb_typeof(entry)<>'object' OR NOT(entry ?& ARRAY['roleId','roleVersion','bundleId','bundleVersion'])
  OR (SELECT count(*) FROM jsonb_object_keys(entry))<>4
  OR jsonb_typeof(entry->'roleId')<>'string' OR jsonb_typeof(entry->'bundleId')<>'string'
  OR jsonb_typeof(entry->'roleVersion')<>'number' OR jsonb_typeof(entry->'bundleVersion')<>'number'
  OR (entry->>'roleVersion')!~'^[1-9][0-9]*$' OR (entry->>'bundleVersion')!~'^[1-9][0-9]*$'
  OR (entry->>'roleVersion')::NUMERIC>9007199254740991 OR (entry->>'bundleVersion')::NUMERIC>9007199254740991 THEN
   RAISE EXCEPTION 'staff_roles_invalid_bindings' USING ERRCODE='22023'; END IF;
  v_role_id:=(entry->>'roleId')::UUID;
  IF v_role_id=ANY(seen) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_assignments) a
    WHERE (a->>'roleId')::UUID=v_role_id) THEN
   RAISE EXCEPTION 'staff_roles_invalid_bindings' USING ERRCODE='22023'; END IF;
  seen:=array_append(seen,v_role_id);
  IF NOT EXISTS(SELECT 1 FROM platform.staff_role_definitions r
   JOIN platform.staff_role_bundle_bindings binding ON binding.organization_id=r.organization_id
    AND binding.role_id=r.id AND binding.bundle_id=r.current_bundle_id
   JOIN platform.role_bundle_versions bundle ON bundle.id=binding.bundle_id
    AND bundle.version=binding.bundle_version AND bundle.status='published'
   WHERE r.organization_id=p_organization_id AND r.id=v_role_id AND r.status='active'
    AND r.version=(entry->>'roleVersion')::BIGINT AND r.current_bundle_id=(entry->>'bundleId')::UUID
    AND binding.bundle_version=(entry->>'bundleVersion')::BIGINT) THEN
   RAISE EXCEPTION 'staff_roles_selected_role_version_conflict' USING ERRCODE='40001'; END IF;
 END LOOP;
END $$;

CREATE FUNCTION platform.staff_role_impact(p_organization_id UUID,p_role_id UUID,p_expected_version BIGINT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r platform.staff_role_definitions%ROWTYPE; published TEXT[];
BEGIN
 PERFORM 1 FROM platform_private.require_admin_actor(p_organization_id,'rbac.read');
 SELECT * INTO r FROM platform.staff_role_definitions WHERE organization_id=p_organization_id AND id=p_role_id;
 IF NOT FOUND OR p_expected_version IS NULL OR r.version<>p_expected_version THEN
  RAISE EXCEPTION 'staff_roles_version_conflict' USING ERRCODE='40001'; END IF;
 SELECT COALESCE(array_agg(bp.permission_key ORDER BY bp.permission_key),'{}') INTO published
 FROM platform.role_bundle_permissions bp WHERE bp.bundle_id=r.current_bundle_id;
 RETURN jsonb_build_object('roleId',r.id,'version',r.version,
  'impactFingerprint',platform_private.staff_role_impact_fingerprint(p_organization_id,r.id),'affectedMembershipIds',
  COALESCE((SELECT jsonb_agg(id ORDER BY id) FROM (SELECT DISTINCT a.membership_id AS id FROM platform.staff_role_assignments a
   WHERE a.organization_id=p_organization_id AND a.role_id=r.id AND a.revoked_at IS NULL) members),'[]'::JSONB),
  'addedPermissionKeys',COALESCE((SELECT jsonb_agg(k ORDER BY k) FROM unnest(r.draft_permission_keys) k WHERE NOT(k=ANY(published))),'[]'::JSONB),
  'removedPermissionKeys',COALESCE((SELECT jsonb_agg(k ORDER BY k) FROM unnest(published) k WHERE NOT(k=ANY(r.draft_permission_keys))),'[]'::JSONB));
END $$;

CREATE FUNCTION platform.staff_role_publish(p_organization_id UUID,p_role_id UUID,p_expected_version BIGINT,
 p_expected_impact_fingerprint TEXT,p_reason TEXT,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE command JSONB; result JSONB; r platform.staff_role_definitions%ROWTYPE; affected UUID[];
 keys TEXT[]; v_bundle_id UUID:=gen_random_uuid(); v_bundle_version BIGINT; before_state JSONB;
BEGIN
 IF p_expected_impact_fingerprint IS NULL OR p_expected_impact_fingerprint!~'^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'staff_roles_invalid_impact' USING ERRCODE='22023'; END IF;
 command:=jsonb_build_object('operation','publish','roleId',p_role_id,'expectedVersion',p_expected_version,
  'expectedImpactFingerprint',p_expected_impact_fingerprint,'reason',btrim(p_reason));
 result:=platform_private.staff_role_request_begin(p_organization_id,p_request_id,command);
 IF result IS NOT NULL THEN RETURN result; END IF;
 SELECT * INTO r FROM platform.staff_role_definitions WHERE organization_id=p_organization_id AND id=p_role_id FOR UPDATE;
 IF NOT FOUND OR p_expected_version IS NULL OR r.version<>p_expected_version OR r.version>=9007199254740991 THEN
  RAISE EXCEPTION 'staff_roles_version_conflict' USING ERRCODE='40001'; END IF;
 IF r.status<>'active' THEN RAISE EXCEPTION 'staff_roles_archived' USING ERRCODE='22023'; END IF;
 keys:=platform_private.staff_validate_permission_keys(to_jsonb(r.draft_permission_keys));
 SELECT COALESCE(array_agg(DISTINCT a.membership_id ORDER BY a.membership_id),'{}') INTO affected
 FROM platform.staff_role_assignments a WHERE a.organization_id=p_organization_id AND a.role_id=r.id AND a.revoked_at IS NULL;
 -- Publishing must not leave active assignments whose scopes no longer have a
 -- meaning for the new actions. Resolve those assignments explicitly first.
 IF EXISTS(SELECT 1 FROM platform.staff_role_assignments a CROSS JOIN unnest(keys) k
 JOIN platform.permission_definitions d ON d.permission_key=k WHERE a.organization_id=p_organization_id AND a.role_id=r.id
 AND a.revoked_at IS NULL AND (NOT(a.scope_kind=ANY(d.staff_scope_kinds))
 OR (a.scope_kind='record' AND NOT(a.resource_kind=ANY(d.staff_resource_kinds))))) THEN
  RAISE EXCEPTION 'staff_roles_publish_scope_conflict' USING ERRCODE='22023'; END IF;
 PERFORM platform_private.staff_lock_memberships(p_organization_id,affected);
 IF platform_private.staff_role_impact_fingerprint(p_organization_id,r.id) IS DISTINCT FROM p_expected_impact_fingerprint THEN
  RAISE EXCEPTION 'staff_roles_impact_version_conflict' USING ERRCODE='40001'; END IF;
 before_state:=to_jsonb(r);
 SELECT COALESCE(max(b.bundle_version),0)+1 INTO v_bundle_version FROM platform.staff_role_bundle_bindings b
 WHERE b.organization_id=p_organization_id AND b.role_id=r.id;
 INSERT INTO platform.role_bundle_versions(id,role,version,label) VALUES(v_bundle_id,NULL,v_bundle_version,r.label);
 INSERT INTO platform.role_bundle_permissions(bundle_id,bundle_role,permission_key) SELECT v_bundle_id,NULL,k FROM unnest(keys) k;
 UPDATE platform.role_bundle_versions b SET status='published',published_at=statement_timestamp() WHERE b.id=v_bundle_id;
 INSERT INTO platform.staff_role_bundle_bindings VALUES(p_organization_id,r.id,v_bundle_id,v_bundle_version);
 UPDATE platform.staff_role_definitions SET current_bundle_id=v_bundle_id,version=version+1,updated_at=statement_timestamp() WHERE id=r.id;
 WITH revoked AS(UPDATE platform.staff_role_assignments SET revoked_at=statement_timestamp()
  WHERE organization_id=p_organization_id AND role_id=r.id AND revoked_at IS NULL RETURNING *)
 INSERT INTO platform.staff_role_assignments(organization_id,membership_id,role_id,bundle_id,scope_kind,scope_key,resource_kind)
 SELECT organization_id,membership_id,role_id,v_bundle_id,scope_kind,scope_key,resource_kind FROM revoked;
 PERFORM platform_private.staff_bump_memberships(p_organization_id,affected);
 result:=jsonb_build_object('status','applied','roleId',r.id,'version',r.version+1,
  'bundleId',v_bundle_id,'bundleVersion',v_bundle_version,'affectedMembershipIds',to_jsonb(affected));
 RETURN platform_private.staff_role_request_finish(p_organization_id,p_request_id,command,result,'staff.role.publish','staff_role',r.id,before_state);
END $$;

CREATE FUNCTION platform.staff_role_assignments_save(p_organization_id UUID,p_membership_id UUID,
 p_expected_access_version BIGINT,p_assignments JSONB,p_expected_role_bindings JSONB,p_reason TEXT,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE command JSONB; result JSONB; current_version BIGINT; before_state JSONB;
BEGIN
 command:=jsonb_build_object('operation','assignments','membershipId',p_membership_id,
  'expectedAccessVersion',p_expected_access_version,'assignments',p_assignments,
  'expectedRoleBindings',p_expected_role_bindings,'reason',btrim(p_reason));
 result:=platform_private.staff_role_request_begin(p_organization_id,p_request_id,command);
 IF result IS NOT NULL THEN RETURN result; END IF;
 PERFORM platform_private.staff_lock_memberships(p_organization_id,ARRAY[p_membership_id]);
 SELECT p.access_version INTO current_version FROM platform.organization_memberships m JOIN platform.profiles p ON p.id=m.profile_id
 WHERE m.organization_id=p_organization_id AND m.id=p_membership_id AND m."current_role" IS DISTINCT FROM 'student';
 IF current_version IS NULL OR p_expected_access_version IS NULL OR current_version<>p_expected_access_version
 OR current_version>=9007199254740991 THEN RAISE EXCEPTION 'staff_roles_version_conflict' USING ERRCODE='40001'; END IF;
 PERFORM platform_private.staff_validate_assignment_bindings(p_organization_id,p_assignments,p_expected_role_bindings);
 SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]') INTO before_state FROM platform.staff_role_assignments a
 WHERE a.organization_id=p_organization_id AND a.membership_id=p_membership_id AND a.revoked_at IS NULL;
 PERFORM platform_private.staff_replace_assignments(p_organization_id,p_membership_id,p_assignments);
 PERFORM platform_private.staff_bump_memberships(p_organization_id,ARRAY[p_membership_id]);
 result:=jsonb_build_object('status','applied','membershipId',p_membership_id,'accessVersion',current_version+1);
 RETURN platform_private.staff_role_request_finish(p_organization_id,p_request_id,command,result,
  'staff.role.assignments','membership',p_membership_id,before_state);
END $$;

CREATE FUNCTION platform.staff_system_admin_command(p_organization_id UUID,p_membership_id UUID,
 p_expected_access_version BIGINT,p_enabled BOOLEAN,p_reason TEXT,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE command JSONB; result JSONB; current_version BIGINT; previous_flag BOOLEAN;
BEGIN
 command:=jsonb_build_object('operation','systemAdmin','membershipId',p_membership_id,
  'expectedAccessVersion',p_expected_access_version,'enabled',p_enabled,'reason',btrim(p_reason));
 result:=platform_private.staff_role_request_begin(p_organization_id,p_request_id,command);
 IF result IS NOT NULL THEN RETURN result; END IF;
 PERFORM platform_private.staff_lock_memberships(p_organization_id,ARRAY[p_membership_id]);
 SELECT p.access_version,m.is_system_admin INTO current_version,previous_flag FROM platform.organization_memberships m
 JOIN platform.profiles p ON p.id=m.profile_id WHERE m.organization_id=p_organization_id AND m.id=p_membership_id
 AND m."current_role" IS DISTINCT FROM 'student';
 IF current_version IS NULL OR p_enabled IS NULL OR p_expected_access_version IS NULL OR current_version<>p_expected_access_version
 OR current_version>=9007199254740991 THEN RAISE EXCEPTION 'staff_roles_version_conflict' USING ERRCODE='40001'; END IF;
 IF previous_flag AND NOT p_enabled AND NOT EXISTS(SELECT 1 FROM platform.organization_memberships m
 JOIN platform.profiles p ON p.id=m.profile_id WHERE m.organization_id=p_organization_id AND m.id<>p_membership_id
 AND m.is_system_admin AND m.status='active' AND p.status='active') THEN
  RAISE EXCEPTION 'staff_workspace_last_admin' USING ERRCODE='23514'; END IF;
 UPDATE platform.organization_memberships SET is_system_admin=p_enabled WHERE organization_id=p_organization_id AND id=p_membership_id;
 PERFORM platform_private.staff_bump_memberships(p_organization_id,ARRAY[p_membership_id]);
 result:=jsonb_build_object('status','applied','membershipId',p_membership_id,'accessVersion',current_version+1,
  'systemRole',CASE WHEN p_enabled THEN 'admin' ELSE 'staff' END);
 RETURN platform_private.staff_role_request_finish(p_organization_id,p_request_id,command,result,
  'staff.system.admin','membership',p_membership_id,jsonb_build_object('systemAdmin',previous_flag,'accessVersion',current_version));
END $$;

CREATE FUNCTION platform_private.staff_assignment_snapshot(p_organization_id UUID,p_membership_id UUID)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',a.id,'roleId',r.id,'label',r.label,
  'bundleId',b.id,'bundleVersion',b.version,
  'scope',jsonb_build_object('kind',a.scope_kind,'key',a.scope_key,'resourceKind',a.resource_kind)) ORDER BY r.label,a.id),'[]'::JSONB)
 FROM platform.staff_role_assignments a JOIN platform.staff_role_definitions r
  ON r.organization_id=a.organization_id AND r.id=a.role_id AND r.status='active' AND r.current_bundle_id=a.bundle_id
 JOIN platform.role_bundle_versions b ON b.id=a.bundle_id AND b.status='published'
 WHERE a.organization_id=p_organization_id AND a.membership_id=p_membership_id AND a.revoked_at IS NULL
$$;

CREATE FUNCTION platform.staff_access_snapshot()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor RECORD; permission_keys JSONB;
BEGIN
 SELECT i.* INTO actor FROM platform.current_actor_authority() a
 JOIN platform_private.staff_membership_identity(a.organization_id,a.membership_id) i ON TRUE;
 -- Absence is not an infrastructure failure. A valid Student is verified by
 -- the unchanged Student authority path; no exception is converted to access.
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF actor.access_version>9007199254740991 THEN RAISE EXCEPTION 'staff_access_version_invalid' USING ERRCODE='22023'; END IF;
 SELECT COALESCE(jsonb_agg(d.permission_key ORDER BY d.permission_key),'[]') INTO permission_keys
 FROM platform.permission_definitions d WHERE platform_private.staff_has_permission(actor.organization_id,actor.membership_id,d.permission_key);
 RETURN jsonb_build_object('schemaVersion',1,'authUserId',actor.auth_user_id,'profileId',actor.profile_id,
  'membershipId',actor.membership_id,'organizationId',actor.organization_id,'displayName',actor.display_name,
  'systemRole',actor.system_role,'accessVersion',actor.access_version,
  'assignments',platform_private.staff_assignment_snapshot(actor.organization_id,actor.membership_id),
  'permissions',permission_keys);
END $$;

CREATE FUNCTION platform.staff_role_workspace(p_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE permission_rows JSONB; role_rows JSONB; member_rows JSONB; department_rows JSONB;
BEGIN
 PERFORM 1 FROM platform_private.require_admin_actor(p_organization_id,'rbac.read');
 SELECT COALESCE(jsonb_agg(jsonb_build_object('key',d.permission_key,'label',d.staff_label,'group',d.staff_group,
  'allowedScopes',to_jsonb(d.staff_scope_kinds),'resourceKinds',to_jsonb(d.staff_resource_kinds),
  'sensitive',d.staff_sensitive,'systemOnly',d.staff_system_only) ORDER BY d.staff_group,d.staff_label,d.permission_key),'[]')
 INTO permission_rows FROM platform.permission_definitions d WHERE cardinality(d.staff_scope_kinds)>0;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',r.id,'label',r.label,'description',r.description,
  'status',r.status,'version',r.version,'bundleId',b.id,'bundleVersion',b.version,
  'permissionKeys',COALESCE((SELECT jsonb_agg(bp.permission_key ORDER BY bp.permission_key)
    FROM platform.role_bundle_permissions bp WHERE bp.bundle_id=b.id),'[]'::JSONB),
  'draftPermissionKeys',to_jsonb(r.draft_permission_keys),'memberCount',(SELECT count(DISTINCT a.membership_id)
    FROM platform.staff_role_assignments a WHERE a.organization_id=r.organization_id AND a.role_id=r.id AND a.revoked_at IS NULL))
  ORDER BY r.label,r.id),'[]') INTO role_rows
 FROM platform.staff_role_definitions r LEFT JOIN platform.role_bundle_versions b ON b.id=r.current_bundle_id
 WHERE r.organization_id=p_organization_id;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('membershipId',m.id,'displayName',p.display_name,
  'systemRole',CASE WHEN m.is_system_admin THEN 'admin' ELSE 'staff' END,'accessVersion',p.access_version,
  'assignments',platform_private.staff_assignment_snapshot(m.organization_id,m.id)) ORDER BY p.display_name,m.id),'[]')
 INTO member_rows FROM platform.organization_memberships m JOIN platform.profiles p ON p.id=m.profile_id
 WHERE m.organization_id=p_organization_id AND m."current_role" IS DISTINCT FROM 'student';
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'status',d.status) ORDER BY d.name,d.id),'[]')
 INTO department_rows FROM platform.staff_departments d WHERE d.organization_id=p_organization_id;
 RETURN jsonb_build_object('schemaVersion',1,'permissions',permission_rows,'roles',role_rows,'members',member_rows,'departments',department_rows);
END $$;

CREATE OR REPLACE FUNCTION platform_private.organization_has_live_admin(p_organization_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT NOT EXISTS(SELECT 1 FROM platform.organizations o WHERE o.id=p_organization_id AND o.status='active')
 OR EXISTS(SELECT 1 FROM platform.organization_memberships m JOIN platform.profiles p ON p.id=m.profile_id
 WHERE m.organization_id=p_organization_id AND m.is_system_admin AND m.status='active' AND p.status='active')
$$;
CREATE OR REPLACE FUNCTION platform_private.staff_workspace_keep_admin()
RETURNS TRIGGER LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.is_system_admin AND OLD.status='active' AND (NOT NEW.is_system_admin OR NEW.status<>'active') THEN
  PERFORM 1 FROM platform.organizations WHERE id=OLD.organization_id FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM platform.organization_memberships m JOIN platform.profiles p ON p.id=m.profile_id
   WHERE m.organization_id=OLD.organization_id AND m.id<>OLD.id AND m.is_system_admin AND m.status='active' AND p.status='active') THEN
   RAISE EXCEPTION 'staff_workspace_last_admin' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER staff_workspace_keep_admin ON platform.organization_memberships;
CREATE TRIGGER staff_workspace_keep_admin BEFORE UPDATE OF is_system_admin,status ON platform.organization_memberships
FOR EACH ROW EXECUTE FUNCTION platform_private.staff_workspace_keep_admin();

CREATE FUNCTION platform_private.staff_legacy_role_frozen()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF OLD."current_role" IS DISTINCT FROM NEW."current_role"
 OR (OLD."current_role" IS DISTINCT FROM 'student' AND OLD.current_bundle_id IS DISTINCT FROM NEW.current_bundle_id) THEN
  RAISE EXCEPTION 'staff_roles_use_assignment_commands' USING ERRCODE='22023'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER staff_legacy_role_frozen BEFORE UPDATE OF "current_role",current_bundle_id ON platform.organization_memberships
FOR EACH ROW EXECUTE FUNCTION platform_private.staff_legacy_role_frozen();

CREATE FUNCTION platform_private.staff_assignment_revoke_only()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Staff assignment history is immutable' USING ERRCODE='55000'; END IF;
 IF OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL OR (to_jsonb(OLD)-'revoked_at')<>(to_jsonb(NEW)-'revoked_at') THEN
  RAISE EXCEPTION 'Staff assignment history is immutable' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER staff_assignment_revoke_only BEFORE UPDATE OR DELETE ON platform.staff_role_assignments
FOR EACH ROW EXECUTE FUNCTION platform_private.staff_assignment_revoke_only();
CREATE TRIGGER staff_assignment_no_truncate BEFORE TRUNCATE ON platform.staff_role_assignments
FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER staff_bundle_bindings_immutable BEFORE UPDATE OR DELETE ON platform.staff_role_bundle_bindings
FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER staff_bundle_bindings_no_truncate BEFORE TRUNCATE ON platform.staff_role_bundle_bindings
FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER staff_role_receipts_immutable BEFORE UPDATE OR DELETE ON platform_private.staff_role_command_receipts
FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER staff_role_receipts_no_truncate BEFORE TRUNCATE ON platform_private.staff_role_command_receipts
FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();

-- Department is live authority. A metadata transfer/archive invalidates open
-- staff intents in the same organization; it never grants access by job title.
CREATE FUNCTION platform_private.staff_department_access_changed()
RETURNS TRIGGER LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE org_id UUID; members UUID[];
BEGIN
 IF TG_TABLE_NAME='staff_organizational_details' THEN
  IF TG_OP='UPDATE' AND NEW.department_id IS NOT DISTINCT FROM OLD.department_id THEN RETURN NEW; END IF;
 ELSE
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
 END IF;
 org_id:=NEW.organization_id;
 PERFORM 1 FROM platform.organizations WHERE id=org_id FOR UPDATE;
 SELECT COALESCE(array_agg(m.id ORDER BY m.id),'{}') INTO members FROM platform.organization_memberships m
 WHERE m.organization_id=org_id AND m."current_role" IS DISTINCT FROM 'student';
 PERFORM platform_private.staff_lock_memberships(org_id,members);
 PERFORM platform_private.staff_bump_memberships(org_id,members);
 RETURN NEW;
END $$;
CREATE TRIGGER staff_department_access_changed AFTER INSERT OR UPDATE OF department_id ON platform.staff_organizational_details
FOR EACH ROW EXECUTE FUNCTION platform_private.staff_department_access_changed();
CREATE TRIGGER staff_department_status_access_changed AFTER UPDATE OF status ON platform.staff_departments
FOR EACH ROW EXECUTE FUNCTION platform_private.staff_department_access_changed();

CREATE OR REPLACE FUNCTION private.platform_can_read_membership(p_organization_id UUID,p_membership_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM platform.organization_memberships m CROSS JOIN platform.current_actor_authority() a
 WHERE m.organization_id=p_organization_id AND m.id=p_membership_id AND a.organization_id=m.organization_id
 AND ((a.platform_role='student' AND a.membership_id=m.id
  AND private.student_has_permission_pre_scoped_roles(p_organization_id,'membership.read.self')
  AND private.student_has_scope_pre_scoped_roles(p_organization_id,'organization',p_organization_id))
 OR (a.platform_role IS DISTINCT FROM 'student' AND (a.membership_id=m.id
  OR platform_private.staff_can_access(p_organization_id,a.membership_id,'membership.read','organization',p_organization_id)))))
$$;
CREATE OR REPLACE FUNCTION private.platform_can_read_profile(p_profile_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM platform.organization_memberships m JOIN platform.profiles p ON p.id=m.profile_id
 CROSS JOIN platform.current_actor_authority() a WHERE p.id=p_profile_id AND m.organization_id=a.organization_id
 AND m.status='active' AND p.status='active' AND
 ((a.platform_role='student' AND a.profile_id=p.id
  AND private.student_has_permission_pre_scoped_roles(a.organization_id,'profile.read.self')
  AND private.student_has_scope_pre_scoped_roles(a.organization_id,'organization',a.organization_id))
 OR (a.platform_role IS DISTINCT FROM 'student' AND (a.profile_id=p.id
  OR platform_private.staff_can_access(a.organization_id,a.membership_id,'membership.read','organization',a.organization_id)))))
$$;
CREATE OR REPLACE FUNCTION private.platform_can_read_rbac()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM platform.current_actor_authority() a
 WHERE platform_private.staff_can_access(a.organization_id,a.membership_id,'rbac.read','organization',a.organization_id))
$$;
CREATE OR REPLACE FUNCTION private.platform_can_read_scope(p_organization_id UUID,p_scope_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM platform.record_scopes s CROSS JOIN platform.current_actor_authority() a
 WHERE s.organization_id=p_organization_id AND s.id=p_scope_id AND s.is_active AND a.organization_id=s.organization_id
 AND ((a.platform_role='student' AND private.student_has_permission_pre_scoped_roles(p_organization_id,'scope.read.self')
 AND private.student_has_scope_pre_scoped_roles(p_organization_id,s.scope_kind,s.scope_key))
 OR platform_private.staff_can_access(p_organization_id,a.membership_id,'scope.manage','organization',p_organization_id)))
$$;
CREATE OR REPLACE FUNCTION private.platform_can_read_audit(p_organization_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT platform_private.staff_can_access_for_actor(p_organization_id,'audit.read','organization',p_organization_id)
$$;
CREATE OR REPLACE FUNCTION platform_private.p7a_require_audit_admin()
RETURNS TABLE(auth_user_id UUID,profile_id UUID,membership_id UUID,organization_id UUID)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 RETURN QUERY SELECT a.auth_user_id,a.profile_id,a.membership_id,a.organization_id FROM platform.current_actor_authority() a
 WHERE platform_private.staff_can_access(a.organization_id,a.membership_id,'audit.read','organization',a.organization_id);
 IF NOT FOUND THEN RAISE EXCEPTION 'Active Platform Admin audit authority is required' USING ERRCODE='42501'; END IF;
END $$;

-- Keep the established sensitive grant event/replay/audit command; replace
-- only its fixed-role target classification with the same staff identity.
DO $personal_grants$
DECLARE body TEXT; previous TEXT;
BEGIN
 body:=pg_get_functiondef('platform.change_membership_permission(uuid,uuid,text,boolean,text,uuid)'::regprocedure);
 previous:=body;
 IF strpos(body,'membership."current_role" IN (''admin'', ''sales'', ''curator'')')=0
 OR strpos(body,'SELECT membership.profile_id, membership."current_role"')=0
 OR strpos(body,'AND target_role <> ''admin''')=0 THEN RAISE EXCEPTION 'staff_personal_grant_source_drift'; END IF;
 body:=replace(body,'SELECT membership.profile_id, membership."current_role"',
  'SELECT membership.profile_id, CASE WHEN membership.is_system_admin THEN ''admin''::platform.business_role WHEN membership."current_role"=''admin'' THEN NULL::platform.business_role ELSE membership."current_role" END');
 body:=replace(body,'membership."current_role" IN (''admin'', ''sales'', ''curator'')','membership."current_role" IS DISTINCT FROM ''student''');
 body:=replace(body,'AND target_role <> ''admin''','AND target_role IS DISTINCT FROM ''admin''');
 body:=replace(body,'  SELECT'||chr(10)||'    actor.actor_profile_id,',
  '  PERFORM 1 FROM platform.organizations WHERE id=p_organization_id FOR UPDATE;'||chr(10)||
  '  PERFORM platform_private.staff_lock_memberships(p_organization_id,ARRAY[p_membership_id]);'||chr(10)||
  '  SELECT'||chr(10)||'    actor.actor_profile_id,');
 IF body=previous OR strpos(body,'staff_lock_memberships')=0 THEN RAISE EXCEPTION 'staff_personal_grant_source_drift'; END IF;
 EXECUTE body;
END $personal_grants$;

-- Metadata commands keep their existing optimistic version, reason and receipt
-- contract; employee classification no longer depends on a fixed business role.
DO $organization_details$
DECLARE body TEXT;
BEGIN
 body:=pg_get_functiondef('platform.staff_organizational_details_save(uuid,uuid,uuid,text,text[],bigint,text,uuid)'::regprocedure);
 IF strpos(body,'membership."current_role" IN (''admin'', ''sales'', ''curator'')')=0 THEN
  RAISE EXCEPTION 'staff_organization_details_source_drift'; END IF;
 EXECUTE replace(body,'membership."current_role" IN (''admin'', ''sales'', ''curator'')',
  'membership."current_role" IS DISTINCT FROM ''student''');
END $organization_details$;

REVOKE ALL ON TABLE platform.staff_role_definitions,platform.staff_role_bundle_bindings,
 platform.staff_role_assignments,platform_private.staff_role_command_receipts
 FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;

DO $function_acl$
DECLARE f RECORD;
BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE (n.nspname IN ('platform_private','private') AND p.proname IN (
 'student_has_permission_pre_scoped_roles','student_has_scope_pre_scoped_roles','student_actor_pre_scoped_roles','student_token_pre_scoped_roles',
 'staff_membership_identity','staff_has_permission','staff_resource_context','staff_context_can_access','staff_access_evaluate',
 'staff_can_access','staff_can_access_for_actor','staff_can_receive_assignment','staff_can_create_for_owner',
 'staff_validate_permission_keys','staff_validate_role_scope','staff_lock_memberships','staff_bump_memberships',
 'staff_role_request_begin','staff_role_request_finish','staff_replace_assignments','staff_assignment_snapshot',
 'staff_role_impact_fingerprint','staff_validate_assignment_bindings',
 'staff_legacy_role_frozen','staff_assignment_revoke_only','staff_department_access_changed'))
 OR (n.nspname='platform' AND p.proname IN ('staff_access_snapshot','staff_role_workspace','staff_role_command',
 'staff_role_impact','staff_role_publish','staff_role_assignments_save','staff_system_admin_command'))
 LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin',f.signature);
 END LOOP;
END $function_acl$;
GRANT EXECUTE ON FUNCTION platform.staff_access_snapshot(),platform.staff_role_workspace(UUID),
 platform.staff_role_command(UUID,UUID,BIGINT,TEXT,JSONB,TEXT,UUID),
 platform.staff_role_impact(UUID,UUID,BIGINT),platform.staff_role_publish(UUID,UUID,BIGINT,TEXT,TEXT,UUID),
 platform.staff_role_assignments_save(UUID,UUID,BIGINT,JSONB,JSONB,TEXT,UUID),
 platform.staff_system_admin_command(UUID,UUID,BIGINT,BOOLEAN,TEXT,UUID) TO authenticated;
REVOKE ALL ON FUNCTION platform_private.custom_access_token_hook(JSONB) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform_private.custom_access_token_hook(JSONB) TO supabase_auth_admin;
REVOKE ALL ON FUNCTION platform.change_membership_role(UUID,UUID,platform.business_role,TEXT,UUID),
 platform.change_pilot_staff_role(UUID,UUID,platform.business_role,TEXT,UUID) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;

COMMENT ON FUNCTION platform_private.staff_can_access(UUID,UUID,TEXT,TEXT,UUID)
 IS 'S2 authoritative paired permission+scope check against canonical current resource context. Private trusted callers only.';
COMMENT ON FUNCTION platform_private.staff_has_permission(UUID,UUID,TEXT)
 IS 'S2 live shell/preflight union only; never sufficient to authorize a business record.';
COMMENT ON FUNCTION platform.staff_access_snapshot()
 IS 'Own live staff identity and assignments. Permission union is presentation only. Student authority is separate and unchanged.';
COMMENT ON TABLE platform.staff_role_assignments
 IS 'One immutable published role bundle bound to one scope; revoke preserves history. No standalone permission/scope union.';

COMMIT;
