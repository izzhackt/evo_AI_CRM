-- 339 «Продажа ученику, который сам заполнил анкету» (07.11.2026). Хуки набора в
-- `scripts/test-runners/test-postgres-authorization.sh` привязаны к имени файла.
--
-- Что было (найдено 07.11.2026 на тестовой продаже в боевой CRM: форма продажи отвечала «Проверьте поля…»):
--   1. decide_student_application_v1 (177/180/193/209/337) при одобрении анкеты заводит дело с canonical_lead_id, но без
--      canonical_client_id. Продажа в такое дело (create_sales_report_handoff, ветка 258) доходит до
--      record_pending_case_sales_handoff, а он требует, чтобы клиент дела совпадал с клиентом лида, и отказывает 22023
--      pending_case_handoff_case_mismatch. Так продажа не сохранялась никому, кто сам заполнил анкету и был одобрен.
--   2. Поиск формы продажи (sales_register_intake_options, 174) не находит лида без ответственного, а продажа такого лида
--      отказывает sales_register_forbidden: ответственного приходилось заранее ставить в «Воронке продаж».
-- Что меняется:
--   1. Одобрение анкеты пишет в дело canonical_client_id — клиента его лида (пару проверяет триггер 084).
--   2. Один раз здесь же: делам с лидом и без клиента дописывается клиент их лида. Значение следует из лида, решать
--      нечего, поэтому записей журнала нет (как у восстановления 258).
--   3. Решение пользователя 07.11.2026 («давай эту сделаем»): у лида без ответственного им становится тот, кто сохраняет
--      продажу. Обычной командой «Воронки продаж» mutate_sales_lead_workflow (её журнал lead.sales.workflow.changed и
--      квитанция) в той же транзакции, что и продажа; этап и следующий шаг лида не меняются. Кто сам не может стать
--      ответственным (нет lead.sales.owner.assign или права вести этот лид), получает прежний отказ sales_register_forbidden.
--      Лид с ответственным — как раньше: продажа засчитывается ему. Права на лид не меняются: лида без ответственного
--      видит и продаёт тот, чья область охватывает такого лида (Админ, роль на всю организацию); продавец отдела, как и
--      раньше, сначала берёт его в «Заявках» (250).
--   4. Поиск формы продажи находит и лида без ответственного (owner_id = null), но только тому, кто сам может им стать —
--      те же проверки, что у «Взять» в «Заявках» (250) и у шага 3; иначе форма обещала бы то, в чём продажа откажет.
-- Новых функций, таблиц и прав нет. Forward-only: повтор отказывает a339_already_applied, чужое тело — a339_replace_drift.
-- Выкат: база и приложение выходят одним выпуском (сначала журнал миграций, потом приложение). В эти минуты старое
-- приложение отвечает «Поиск недоступен», если среди найденных в форме продажи есть лид без ответственного.
BEGIN;

DO $a339_anchor$
BEGIN
  IF (SELECT strpos(p.prosrc, 'canonical_client_id') > 0 FROM pg_catalog.pg_proc p
      WHERE p.oid = to_regprocedure('platform.decide_student_application_v1(uuid,bigint,text,text,uuid)')) THEN
    RAISE EXCEPTION 'a339_already_applied' USING ERRCODE = '55000';
  END IF;
END
$a339_anchor$;

-- Как pg_temp.a337_replace: фрагмент обязан встретиться ровно p_expected раз.
CREATE FUNCTION pg_temp.a339_replace(p_signature TEXT, p_old TEXT, p_new TEXT, p_expected INTEGER)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE body TEXT; matches INTEGER;
BEGIN
  body := pg_get_functiondef(to_regprocedure(p_signature));
  matches := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  IF body IS NULL OR matches IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'a339_replace_drift: % expected %, found %', p_signature, p_expected, matches USING ERRCODE = '55000';
  END IF;
  EXECUTE replace(body, p_old, p_new);
END $$;

-- 1. Одобрение анкеты: клиент дела — клиент его лида.
SELECT pg_temp.a339_replace('platform.decide_student_application_v1(uuid,bigint,text,text,uuid)',
  'current_scope_id,current_scope_version,public_application_id,canonical_lead_id)',
  'current_scope_id,current_scope_version,public_application_id,canonical_lead_id,canonical_client_id)',
  1);
SELECT pg_temp.a339_replace('platform.decide_student_application_v1(uuid,bigint,text,text,uuid)',
  'scope_id,1,app.id,lead_id);',
  'scope_id,1,app.id,lead_id,(SELECT l.client_id FROM platform.leads l WHERE l.organization_id=org AND l.id=lead_id));',
  1);

-- 2. Один раз: делам с лидом и без клиента — клиент их лида.
UPDATE platform.student_cases AS student_case
SET canonical_client_id = lead.client_id
FROM platform.leads AS lead
WHERE lead.organization_id = student_case.organization_id
  AND lead.id = student_case.canonical_lead_id
  AND student_case.canonical_client_id IS NULL;

-- 3. Продажа лида без ответственного: ответственным становится тот, кто её сохраняет.
SELECT pg_temp.a339_replace('platform.create_sales_report_handoff(uuid,uuid,uuid,uuid,date)',
  $old$IF NOT FOUND OR owner_id IS NULL THEN RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501'; END IF;$old$,
  $new$IF NOT FOUND THEN RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501'; END IF;$new$,
  1);
SELECT pg_temp.a339_replace('platform.create_sales_report_handoff(uuid,uuid,uuid,uuid,date)',
  $old$RAISE EXCEPTION 'sales_register_already_transferred' USING ERRCODE='PT409'; END IF;$old$,
  $new$RAISE EXCEPTION 'sales_register_already_transferred' USING ERRCODE='PT409'; END IF;
  -- 339: у лида без ответственного им становится тот, кто сохраняет продажу (решение 07.11.2026), обычной командой
  -- «Воронки продаж» (её журнал и квитанция); этап и следующий шаг лида не меняются.
  IF owner_id IS NULL THEN
    IF platform_private.staff_can_access(p_organization_id,actor.membership_id,'lead.sales.owner.assign','lead',p_lead_id) IS NOT TRUE
      OR platform_private.staff_can_receive_assignment(p_organization_id,actor.membership_id,'lead.read','lead',p_lead_id) IS NOT TRUE
      OR platform_private.staff_can_receive_assignment(p_organization_id,actor.membership_id,
        'lead.sales.workflow.manage','lead',p_lead_id) IS NOT TRUE
    THEN RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501'; END IF;
    PERFORM platform.mutate_sales_lead_workflow(l.id,l.workflow_version,
      public.uuid_generate_v5(p_request_id,'sales-report:lead-owner'),l.stage_key,actor.membership_id,
      l.next_action_text,l.next_action_due_date,l.next_action_text IS NULL,NULL)
    FROM platform.leads l WHERE l.organization_id=p_organization_id AND l.id=p_lead_id;
    owner_id:=actor.membership_id;
  END IF;$new$,
  1);

-- 4. Поиск формы продажи: и лид без ответственного, если тот, кто ищет, сам может им стать (проверки шага 3).
SELECT pg_temp.a339_replace('platform.sales_register_intake_options(uuid,text)',
  'AND lead.current_owner_membership_id IS NOT NULL',
  $new$AND (lead.current_owner_membership_id IS NOT NULL
          -- 339: лид без ответственного — только тому, кто сам станет им при сохранении продажи
          OR (platform_private.staff_can_access(p_organization_id,actor.membership_id,'lead.sales.owner.assign','lead',lead.id)
            AND platform_private.staff_can_receive_assignment(p_organization_id,actor.membership_id,'lead.read','lead',lead.id)
            AND platform_private.staff_can_receive_assignment(p_organization_id,actor.membership_id,
              'lead.sales.workflow.manage','lead',lead.id)))$new$,
  1);

NOTIFY pgrst, 'reload schema';

COMMIT;
