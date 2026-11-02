-- 329 «Студент без кабинета: честный сигнал». У студентов, заведённых вручную или импортом из amoCRM, кабинета нет, а экран
-- переписки и агент этого не знали: сообщение сохранялось, инструмент отвечал status: sent, но читать его негде.
-- Что меняется, по одному месту в трёх функциях (приём 282: фрагмент обязан встретиться ровно один раз):
--   1) case_chat_read_page_v1 отдаёт studentHasPortal, экран показывает предупреждение; писать по-прежнему можно: когда кабинет
--      появится, студент увидит историю;
--   2) ai_agent_tool_get_case_v1 отдаёт в case поле student_has_portal;
--   3) ai_agent_tool_send_message_v1 в канале portal отказывает no_student_portal: агент узнаёт правду и ставит задачу куратору.
-- Кабинет — это студент дела и дата активации, как в 328. Новых функций, таблиц и прав нет.
-- Forward-only: повтор отказывает a329_already_applied, чужое тело функции отказывает a329_replace_drift.
-- Порядок выката: сначала эта миграция, потом приложение. Старое приложение лишнее поле не читает, а отказ покажет как conflict.
BEGIN;

DO $a329_anchor$
BEGIN
  IF (SELECT strpos(p.prosrc, 'studentHasPortal') > 0 FROM pg_catalog.pg_proc p
      WHERE p.oid = to_regprocedure('platform.case_chat_read_page_v1(uuid,uuid,text,bigint)')) THEN
    RAISE EXCEPTION 'a329_already_applied' USING ERRCODE = '55000';
  END IF;
END
$a329_anchor$;

CREATE FUNCTION pg_temp.a329_replace(p_signature TEXT, p_old TEXT, p_new TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE body TEXT; matches INTEGER;
BEGIN
  body := pg_get_functiondef(to_regprocedure(p_signature));
  matches := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  IF body IS NULL OR matches IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'a329_replace_drift: % expected 1, found %', p_signature, matches USING ERRCODE = '55000';
  END IF;
  EXECUTE replace(body, p_old, p_new);
END $$;

SELECT pg_temp.a329_replace('platform.case_chat_read_page_v1(uuid,uuid,text,bigint)',
  $old$'readSequenceId', coalesce(read_seq, 0)::TEXT$old$,
  $new$'readSequenceId', coalesce(read_seq, 0)::TEXT,
    'studentHasPortal', (SELECT s.student_membership_id IS NOT NULL AND s.portal_activated_at IS NOT NULL
      FROM platform.student_cases s WHERE s.organization_id = p_organization_id AND s.id = p_student_case_id)$new$);

SELECT pg_temp.a329_replace('platform.ai_agent_tool_get_case_v1(uuid,text,jsonb)',
  $old$'handoff_at', s.handoff_at, 'created_at', s.created_at, 'updated_at', s.updated_at));$old$,
  $new$'handoff_at', s.handoff_at, 'created_at', s.created_at, 'updated_at', s.updated_at,
      'student_has_portal', s.student_membership_id IS NOT NULL AND s.portal_activated_at IS NOT NULL));$new$);

SELECT pg_temp.a329_replace('platform.ai_agent_tool_send_message_v1(uuid,text,jsonb)',
  $old$    IF NOT FOUND OR v_case.state = 'closed' THEN
      RAISE EXCEPTION 'target_not_found' USING ERRCODE = 'P0002';
    END IF;
    v_label := left(v_case.student_display_name, 120);$old$,
  $new$    IF NOT FOUND OR v_case.state = 'closed' THEN
      RAISE EXCEPTION 'target_not_found' USING ERRCODE = 'P0002';
    END IF;
    -- 329: кабинета нет: читать сообщение негде, ответ sent был бы неправдой.
    IF v_case.student_membership_id IS NULL OR v_case.portal_activated_at IS NULL THEN
      RAISE EXCEPTION 'no_student_portal' USING ERRCODE = '55000';
    END IF;
    v_label := left(v_case.student_display_name, 120);$new$);

NOTIFY pgrst, 'reload schema';

COMMIT;
