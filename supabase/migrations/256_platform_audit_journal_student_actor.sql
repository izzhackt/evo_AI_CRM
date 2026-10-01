-- «Журнал действий»: действие Студента подписано «студент», а не «сотрудник».
-- docs/PLAN_CHANGES.md «2026-10-01 — «Журнал действий»: действие Студента
-- подписано «студент», а не «сотрудник» (предложение, миграция 256)».
--
-- Дефект. platform_private.p7a_safe_audit_row (071:408-447) подписывает
-- каждого актора actor_kind='user' кодом 'Staff' (071:435-439; на экране —
-- «сотрудник»). Четыре действия, которые уже входят в серверный allowlist
-- P7A, пишет и Студент от своего имени:
--  * case.chat.post — platform.portal_case_chat_post_v1 (200:59-62 пускает
--    только Студента, вставка 200:121-127);
--  * notification.read — mark_own_student_portal_notification_read_v1
--    (068:610-758) и _v2 (069:793-909, живое тело 153:210-333);
--  * document.download.grant — общая вставка 046:2021-2046, её вызывает
--    Student-only private.grant_student_portal_document_download
--    (128:812-923);
--  * document.upload.reserve — platform.reserve_document_upload_after_ingress_scan
--    (116:167-504, резолвер актора пускает и Студента).
-- Ни один из этих писателей не заполняет actor_membership_id (086), а
-- platform.audit_events — append-only (041:565-572): сторону актора нельзя
-- ни взять из самой строки, ни дописать в исторические строки.
--
-- Правило — только проекция, эта одна функция. Сторона актора 'user' —
-- сторона его членства в организации строки, ровно определение
-- staff-идентичности 155 (staff_membership_identity, 155:299-312:
-- "current_role" IS DISTINCT FROM 'student'):
--  * членство находится детерминированно — UNIQUE (organization_id,
--    profile_id) (041:156-157), actor_profile_id NOT NULL у строки 'user'
--    (041:292-295); записанный actor_membership_id обязан совпасть с ним;
--  * 'student' → 'Student'; роль сотрудника или NULL (сотрудники без грубой
--    роли, 157/244) → 'Staff';
--  * членство не найдено, actor_membership_id указывает на другое членство,
--    или сторона членства хоть раз менялась → нейтральный 'User', а не
--    догадка.
-- Сегодняшнее членство честно и для исторических строк: с 155 сторона
-- неизменна — триггер staff_legacy_role_frozen (155:1244-1253) отклоняет
-- любое изменение "current_role"; членства не удаляются. До 155 роль менял
-- ровно один оператор, platform.change_membership_role (UPDATE 041:2406), и
-- он же писал platform.membership_role_history (041:2465) — переход между
-- сторонами виден по истории.
--
-- Новых идентификационных данных нет: по-прежнему только код категории
-- актора, без id членства или профиля, имени и роли. Не меняются allowlist-ы
-- (их расширяет предложение 255, PR #1120), писатели аудита, схема
-- audit_events, search_audit_events/export_audit_events и гранты.
--
-- Порядок выката. Разбор src/lib/platform-audit.ts до этой правки принимает
-- для 'user' только 'Staff' и отклонит страницу со строкой 'Student'/'User'.
-- EVO_PLATFORM_P7A_AUDIT_ENABLED выключен в production, а с выключенным
-- флагом журнал и экспорт RPC не вызывают; включать флаг — только на
-- приложении с новым разбором. Повтор экспорта (071:774-800) того же
-- request_id, сделанного до этой миграции и содержащего строку Студента,
-- честно откажет по sha256 (55000); новый экспорт работает.
--
-- Forward-only. Предложение: нигде не применена; применение схемы и выпуск —
-- отдельные gate-ы владельца (docs/EVO_LAUNCH_PLAN.md). Номер 256 —
-- следующий свободный после 255 черновика #1120; если 255 не войдёт в main
-- раньше, при слиянии перенумеровать в 255.

BEGIN;

CREATE OR REPLACE FUNCTION platform_private.p7a_safe_audit_row(
  p_event platform.audit_events
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT (
    p_event.action = ANY (platform_private.p7a_safe_audit_actions())
    AND p_event.resource_type = ANY (
      platform_private.p7a_safe_audit_resource_types()
    )
  ) THEN
    RAISE EXCEPTION 'Unsafe audit row reached the P7A projection'
      USING ERRCODE = '55000';
  END IF;

  RETURN jsonb_build_object(
    'audit_event_id', p_event.id,
    'created_at', platform_private.p7a_utc_timestamp(p_event.created_at),
    'action', p_event.action,
    'resource_type', p_event.resource_type,
    'resource_id', p_event.resource_id,
    'actor_kind', p_event.actor_kind::TEXT,
    'actor_display_label', CASE p_event.actor_kind
      WHEN 'user'::platform.audit_actor_kind THEN COALESCE((
        SELECT CASE
          WHEN EXISTS (
            SELECT 1
            FROM platform.membership_role_history AS history
            WHERE history.organization_id = membership.organization_id
              AND history.membership_id = membership.id
              AND history.previous_role IS NOT NULL
              AND (history.previous_role = 'student')
                <> (history.new_role = 'student')
          ) THEN 'User'
          WHEN membership."current_role" = 'student' THEN 'Student'
          ELSE 'Staff'
        END
        FROM platform.organization_memberships AS membership
        WHERE membership.organization_id = p_event.organization_id
          AND membership.profile_id = p_event.actor_profile_id
          AND (
            p_event.actor_membership_id IS NULL
            OR membership.id = p_event.actor_membership_id
          )
      ), 'User')
      WHEN 'service'::platform.audit_actor_kind THEN 'Service'
      ELSE 'System'
    END,
    'request_id', p_event.request_id,
    'reason_code', CASE
      WHEN p_event.action = 'audit.export' THEN 'audit_export_requested'
      ELSE 'restricted'
    END,
    'changed_field_codes',
      platform_private.p7a_changed_field_codes(p_event.action)
  );
END
$$;

REVOKE ALL ON FUNCTION platform_private.p7a_safe_audit_row(
  platform.audit_events
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

COMMIT;
