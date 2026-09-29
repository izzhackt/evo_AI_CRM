-- «Журнал действий»: серверный allowlist аудита расширен на 72 действия и
-- 15 типов объектов, которые уже пишутся канонической схемой, но раньше не
-- проецировались в platform.search_audit_events()/export_audit_events()
-- (071, платформа P7A). docs/PLAN_CHANGES.md «2026-09-29 — «Журнал
-- действий»: серверный allowlist аудита расширен на 72 действия
-- (предложение, миграция 255)».
--
-- Тот же приём rename-and-union, что и во всех предыдущих расширениях этого
-- allowlist-а (083 → … → 191, шаблон формы взят из 191:725-742 и
-- 154:451-472): переименовать текущую p7a_safe_audit_actions()/
-- p7a_safe_audit_resource_types() в `_pre_journal_widen`, создать НОВУЮ
-- функцию (не OR REPLACE) с тем же именем, объединяющую старый список с
-- новым, ORDER BY внутри array_agg(DISTINCT …), REVOKE ALL от PUBLIC, anon,
-- authenticated, service_role, supabase_auth_admin на обе версии. Ни одного
-- GRANT — вызывающие RPC уже SECURITY DEFINER и обращаются к private-схеме
-- напрямую. platform_private.p7a_changed_field_codes(TEXT) НЕ трогается:
-- как и при каждом расширении с 154, новые действия ниже используют
-- существующие ветки-фолбэки этой функции (по умолчанию ARRAY['record_status'];
-- 'document.%' — уже существующая ветка для document.export.*/document.slot.*).
--
-- Включены 72 действия, которые УЖЕ пишет канонический Supabase (см. writer
-- file:line ниже), но которые ни разу не заходили в этот allowlist ни в
-- одной из миграций 071→191. Явно НЕ включены 28 действий, которые остаются
-- невидимыми журналу по одной из причин: pre-account applicant intake без
-- staff-маршрута к идентификатору (student.application.approve/reject),
-- Student-writable путь, который проекция подписала бы «сотрудник»
-- (application.document.submit и, как выяснилось при сверке ниже,
-- application.catalog.select/application.requirements.initialize),
-- внутренности восстановления учётных данных (staff.auth.prepare/
-- staff.auth.recovery.observed), машинная разводка без решения человека и
-- большим объёмом (work.*, communication.leadagent.*,
-- communication.webhook.persist, media.archive.*, media.download.consume,
-- company.file.download.consume, integration.amocrm.mapping.discovery.persist,
-- configuration.waha.provision, platform.observability.probe), и два
-- одноразовых деплой-бэкфилла (lead.sales.stage.normalized,
-- staff.roles.migrated). Полная таблица INCLUDE/EXCLUDE с причинами — в
-- PLAN_CHANGES.md записи выше.
--
-- Пересчёт лида (заказ этой миграции) по «101 действие пишется, но не
-- allowlist-нуто» не совпал с последними writer'ами в трёх местах —
-- задокументировано здесь, а не тихо исправлено. 72 INCLUDE + 28 EXCLUDE +
-- 1 DEFERRED (ниже) = 101.
--  * `case.payment_receipt.upload` был переименован миграцией 230
--    (230_platform_payment_receipt_audit_action.sql) в
--    `case.payment.receipt.upload` (доменная грамматика 041: только точки,
--    без подчёркивания в action). Ниже — актуальный дотированный вид;
--    подчёркнутая форма больше нигде не пишется.
--  * `application.catalog.select` (214_platform_catalog_preparation.sql) и
--    `application.requirements.initialize`
--    (218_platform_application_requirements.sql) оказались
--    Student-writable: у каждого есть параметр `p_student BOOLEAN` и
--    публичная обёртка `platform.student_select_catalog_intake_v1`
--    (214:296-306) / `platform.student_initialize_application_requirements_v1`
--    (218:644-659), обе `GRANT EXECUTE … TO authenticated`, обе пишут
--    `actor_kind='user'` независимо от `p_student` — тот же класс дефекта,
--    что уже исключённый `application.document.submit` (228): запись
--    Студента проекция подписала бы «сотрудник». Перенесены в EXCLUDE, не
--    включены сюда.
--  * **DEFERRED, не INCLUDE и не EXCLUDE**: `case.contract_file.upload`
--    (189:472-584, `platform.record_case_contract_file_metadata`) не может
--    сегодня попасть в `platform.audit_events` вообще — независимый от этой
--    задачи, ранее не пойманный дефект уже применённой миграции 189:
--    действие содержит подчёркивание («contract_file»), а
--    `platform.audit_events.action` проверяется `CHECK (action ~
--    '^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$')` (041:281) — сегмент с `_` не
--    проходит. Реальный (не replay) вызов
--    `record_case_contract_file_metadata` всегда упал бы с ошибкой
--    ограничения при попытке записать аудит; ни один существующий тест не
--    ловит это — `supabase/tests/platform_case_agreement.sql:505-521`
--    проверяет только отказ НЕ-service_role вызывающему (42501) и никогда не
--    доходит до реальной записи. Найдено этой миграцией: универсальная
--    P7A-фикстура «одна строка аудита на каждое текущее safe-действие»
--    (эта же миграция, суффикс ниже) впервые попыталась записать буквально
--    это действие и упала на той же проверке —
--    `DOCKER_CONTEXT=orbstack npm run test:database:migration-boundaries`,
--    `ERROR: new row for relation "audit_events" violates check constraint
--    "audit_events_action_check"`. Чинить 189 или ослаблять CHECK — вне
--    объёма этой задачи (уже применённая миграция, продуктовый код); действие
--    НЕ включено в allowlist ниже, чтобы не расширять область репозитория, в
--    которой цепочка полных проверок красная. Резервируется до отдельного
--    решения владельца о починке 189 или переименовании действия по образцу
--    230 (`case.payment_receipt.upload` → `case.payment.receipt.upload`).
--
-- INCLUDE (72 действия, writer file:line на момент этой миграции):
--  application.document.review — 228:283-288,328-350 (staff-only:
--    application_document_actor блокирует 'document.review' для
--    platform_role='student', 228:90-91)
--  application.requirements.save — 226:749-988 (только
--    staff_save_application_requirements_v1, p_student=FALSE жёстко)
--  case.coverage.start/return — 133:209-384 (require_admin_actor
--    'case.curator.assign')
--  case.handoff.acknowledge/clarification/decline — 182:260-444
--    (require_domain_actor_read 'case.read.full')
--  case.next.action.change — 241:150-229 (u7_require_case_workspace_actor +
--    admissions_lock_case 'case.route.manage', явно staff-only с 241)
--  docs.student.create — 176:82-181 (require_domain_actor 'profile.manage' +
--    'case.read.full')
--  case.payment.receipt.upload — 229/230 (actor_kind='system', переименовано
--    230; см. выше)
--  case.tranche.save — 189:780-931 (staff_can_access 'case.update.append'
--    или Sales-владелец pending-дела)
--  lead.lifecycle.change — 246 (staff/admin actor)
--  lead.manual.create — 143:84 (staff actor)
--  lead.sale.conditions.save — 213:60-108 (actor.platform_role IS DISTINCT
--    FROM 'student' + staff_can_access 'lead.sales.workflow.manage')
--  lead.sales.workflow.changed — 086:1370-1536 (actor.platform_role IN
--    ('admin','sales',…))
--  lead.website.receive — 240:104 (actor_kind='service', evo-website)
--  sales.register.create/update/archive/restore — 134:129-322,
--    253:314-410 (v2: staff_is_sales_manager)
--  sales.register.pipeline — 134:381-410 (handoff actor)
--  sales.register.lead.link/unlink — 254:100-201 (a.platform_role IS
--    DISTINCT FROM 'student')
--  sales.register.import — 134:255-322
--  sales.register.target — 134:339-366
--  sales.register.manager.label — 253:460-528 (staff_can_access
--    'sales.register.import')
--  staff.role.create/copy/save/archive/restore/publish — 155:700-1163
--    (System Admin role-management workspace)
--  staff.role.assignments/staff.system.admin — 155:1113-1163
--    (resource_type='membership', distinct from existing
--    'organization_membership')
--  staff.task.create/edit/status — 140:100-208 (platform_role IN
--    ('admin','sales','curator'))
--  team.chat.post/edit/delete/moderate — 171:7-132 (team_chat_can_access →
--    staff_can_access_for_actor)
--  company.file.folder.create/rename/move/archive,
--    file.create/rename/move/archive, upload.reserve/finalize,
--    download.grant — 109 (auth.jwt()->>'platform_role' IN ('admin',
--    'curator') only)
--  student.profile.start — 159:21-130 (require_case_operator
--    'profile.manage')
--  student.profile.field.review — 160:394-461 (require_case_operator
--    'profile.manage')
--  student.profile.export.attempted/generated/failed — 161:88-251
--    (staff_can_access 'profile.read.full' + 'document.download';
--    service_role-only RPC on behalf of a staff actor)
--  student.profile.recognition.publish — 162:700-777
--    (document_recognition_require_actor → staff_membership_identity +
--    staff_can_access)
--  document.export.prepared/begun/sealed/reconciled/ready/failed/unknown,
--    download.verified/download.failed — 164:260-587
--    (staff_can_access_for_actor 'profile.read.full'+'document.download';
--    resource_type='student_profile', already allowlisted)
--  document.slot.scaninvalidate — 115:611-680: ОДНОРАЗОВЫЙ deploy-бэкфилл
--    внутри DO $$ … $$ этой же миграции (actor_kind='system',
--    'service:migration-115'), больше нигде не пишется — по форме тот же
--    класс, что уже исключённые lead.sales.stage.normalized/
--    staff.roles.migrated (X5), но лид явно указал включить его отдельной
--    категорией L; включено по прямому решению, отмечено для повторной
--    сверки владельцем.
--  prompt.artifact.publish/retire — 054:1143-1461 (require_bw4_admin_actor)
--  work.review.resolve — 045:3031-3090 (require_p2f_admin_actor
--    'workreview.resolve')
--  media.download.grant — 062:1500-1664 (require_domain_actor_read
--    'communication.read.full')
--
-- Новые типы объектов (15, выведены из фактических INSERT INTO
-- platform.audit_events выше, не из приблизительного списка задания;
-- case_contract_file исключён вместе с case.contract_file.upload — см.
-- DEFERRED выше, оно единственное действие, которое писало бы этот тип):
-- ai_prompt_artifact_version, communication_media,
-- company_file, company_file_folder, company_file_version, membership,
-- payment_receipt_file, sales_manager_label, sales_register,
-- sales_register_import, sales_register_target, staff_role, staff_task,
-- team_chat_message, work_review_case. НЕ добавлены (остаются невидимыми):
-- student_application, staff_auth_request, waha_session_observation,
-- provider_webhook_event.
--
-- Это ПРЕДЛОЖЕНИЕ: миграция не применена ни к одной базе (ни production, ни
-- disposable — путь применения ниже документирован в PLAN_CHANGES.md).
-- EVO_PLATFORM_P7A_AUDIT_ENABLED выключен в production. Применение схемы и
-- выпуск — отдельные gate-ы владельца из docs/EVO_LAUNCH_PLAN.md; слияние в
-- main допустимо только вместе с одобренным владельцем применением.

BEGIN;

ALTER FUNCTION platform_private.p7a_safe_audit_actions()
  RENAME TO p7a_safe_audit_actions_pre_journal_widen;
CREATE FUNCTION platform_private.p7a_safe_audit_actions()
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.array_agg(DISTINCT allowed.action ORDER BY allowed.action)
  FROM pg_catalog.unnest(
    platform_private.p7a_safe_audit_actions_pre_journal_widen()
      || ARRAY[
    'application.document.review',
    'application.requirements.save',
    'case.coverage.return',
    'case.coverage.start',
    'case.handoff.acknowledge',
    'case.handoff.clarification',
    'case.handoff.decline',
    'case.next.action.change',
    'case.payment.receipt.upload',
    'case.tranche.save',
    'company.file.download.grant',
    'company.file.file.archive',
    'company.file.file.create',
    'company.file.file.move',
    'company.file.file.rename',
    'company.file.folder.archive',
    'company.file.folder.create',
    'company.file.folder.move',
    'company.file.folder.rename',
    'company.file.upload.finalize',
    'company.file.upload.reserve',
    'docs.student.create',
    'document.export.begun',
    'document.export.download.failed',
    'document.export.download.verified',
    'document.export.failed',
    'document.export.prepared',
    'document.export.ready',
    'document.export.reconciled',
    'document.export.sealed',
    'document.export.unknown',
    'document.slot.scaninvalidate',
    'lead.lifecycle.change',
    'lead.manual.create',
    'lead.sale.conditions.save',
    'lead.sales.workflow.changed',
    'lead.website.receive',
    'media.download.grant',
    'prompt.artifact.publish',
    'prompt.artifact.retire',
    'sales.register.archive',
    'sales.register.create',
    'sales.register.import',
    'sales.register.lead.link',
    'sales.register.lead.unlink',
    'sales.register.manager.label',
    'sales.register.pipeline',
    'sales.register.restore',
    'sales.register.target',
    'sales.register.update',
    'staff.role.archive',
    'staff.role.assignments',
    'staff.role.copy',
    'staff.role.create',
    'staff.role.publish',
    'staff.role.restore',
    'staff.role.save',
    'staff.system.admin',
    'staff.task.create',
    'staff.task.edit',
    'staff.task.status',
    'student.profile.export.attempted',
    'student.profile.export.failed',
    'student.profile.export.generated',
    'student.profile.field.review',
    'student.profile.recognition.publish',
    'student.profile.start',
    'team.chat.delete',
    'team.chat.edit',
    'team.chat.moderate',
    'team.chat.post',
    'work.review.resolve'
      ]::TEXT[]
  ) AS allowed(action)
$$;

ALTER FUNCTION platform_private.p7a_safe_audit_resource_types()
  RENAME TO p7a_safe_audit_resource_types_pre_journal_widen;
CREATE FUNCTION platform_private.p7a_safe_audit_resource_types()
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.array_agg(DISTINCT allowed.resource_type ORDER BY allowed.resource_type)
  FROM pg_catalog.unnest(
    platform_private.p7a_safe_audit_resource_types_pre_journal_widen()
      || ARRAY[
    'ai_prompt_artifact_version',
    'communication_media',
    'company_file',
    'company_file_folder',
    'company_file_version',
    'membership',
    'payment_receipt_file',
    'sales_manager_label',
    'sales_register',
    'sales_register_import',
    'sales_register_target',
    'staff_role',
    'staff_task',
    'team_chat_message',
    'work_review_case'
      ]::TEXT[]
  ) AS allowed(resource_type)
$$;

REVOKE ALL ON FUNCTION
  platform_private.p7a_safe_audit_actions_pre_journal_widen(),
  platform_private.p7a_safe_audit_actions(),
  platform_private.p7a_safe_audit_resource_types_pre_journal_widen(),
  platform_private.p7a_safe_audit_resource_types()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

COMMIT;
