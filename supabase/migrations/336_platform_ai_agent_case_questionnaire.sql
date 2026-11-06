-- 336 «ИИ-агент видит анкету студента» (решение владельца 03.11.2026, «ок» на пункт «ИИ-агент пока не видит анкету студента —
-- открыть ему»). Хуки набора в `scripts/test-runners/test-postgres-authorization.sh` привязаны к имени файла, не к номеру.
-- Что было: инструмент get_case (317/319/329) отдавал дело, документы, заявки, оплаты, задачи, заметки и профиль, но не анкету,
-- которую студент заполнил на сайте (/apply, platform_private.student_applications). Ни одна функция агента анкету не читала.
-- Что меняется, одно место в одной функции и одна строка схемы (приём 282/329: фрагмент обязан встретиться ровно один раз):
--   1) ai_agent_tool_get_case_v1: новый раздел include «questionnaire» — статус анкеты, дата отправки, self_reported: true и ответы
--      без телефона и служебных полей (requestId, consent, consentVersion, schemaVersion). Анкета дела ищется так же, как у карточки
--      дела (334): public_application_id, одобрение в это дело или приглашение в него; самая новая первой. Нет анкеты — null.
--      Как профиль, раздел не зависит от согласия студента на ИИ: это не документы и не переписка (правило 320 их и закрывает).
--   2) platform_private.ai_agent_tool_schemas, строка get_case: «questionnaire» в списке разделов, maxItems 6 -> 7. База проверяет
--      аргументы по этой строке (ai_agent_tool_begin), приложение — по contract.ts; они совпадают.
-- Чтение пишет тот же аудит, что и раньше (до выдачи данных). Новых функций, таблиц и прав нет.
-- Forward-only: повтор отказывает a336_already_applied, чужое тело функции — a336_replace_drift.
-- Порядок выката: сначала миграция, потом приложение (новое приложение просит раздел, которого старая база не знает).
-- После выката инструкции агентов изменились (prompts.generated.ts): агентов нужно пересинхронизировать, как после любой правки.
BEGIN;

DO $a336_anchor$
BEGIN
  IF (SELECT strpos(p.prosrc, '''questionnaire''') > 0 FROM pg_catalog.pg_proc p
      WHERE p.oid = to_regprocedure('platform.ai_agent_tool_get_case_v1(uuid,text,jsonb)')) THEN
    RAISE EXCEPTION 'a336_already_applied' USING ERRCODE = '55000';
  END IF;
END
$a336_anchor$;

CREATE FUNCTION pg_temp.a336_replace(p_signature TEXT, p_old TEXT, p_new TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE body TEXT; matches INTEGER;
BEGIN
  body := pg_get_functiondef(to_regprocedure(p_signature));
  matches := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  IF body IS NULL OR matches IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'a336_replace_drift: % expected 1, found %', p_signature, matches USING ERRCODE = '55000';
  END IF;
  EXECUTE replace(body, p_old, p_new);
END $$;

SELECT pg_temp.a336_replace('platform.ai_agent_tool_get_case_v1(uuid,text,jsonb)',
  $old$  RETURN v_out;
END$old$,
  $new$  IF 'questionnaire' = ANY (v_inc) THEN
    -- 336: анкета студента с сайта как он её заполнил: без телефона и служебных полей; связь дела и анкеты как у карточки (334).
    v_out := v_out || jsonb_build_object('questionnaire', (SELECT jsonb_build_object('status', x.status,
        'submitted_at', x.submitted_at, 'self_reported', TRUE,
        'answers', x.questionnaire - ARRAY['phone', 'requestId', 'consent', 'consentVersion', 'schemaVersion'])
      FROM platform_private.student_applications x
      WHERE x.organization_id = s.organization_id
        AND (x.id = s.public_application_id OR x.student_case_id = s.id OR x.invited_case_id = s.id)
      ORDER BY x.submitted_at DESC NULLS LAST, x.id DESC LIMIT 1));
  END IF;
  RETURN v_out;
END$new$);

UPDATE platform_private.ai_agent_tool_schemas SET input_schema = $j${"type": "object", "required": ["case_id"], "properties": {"case_id": {"type": "string", "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", "description": "Student case id."}, "include": {"type": "array", "items": {"enum": ["documents", "applications", "payments", "tasks", "notes", "profile", "questionnaire"], "type": "string"}, "maxItems": 7, "minItems": 1, "description": "Sections to include (default documents, applications, payments, tasks). questionnaire: the student's own website answers, self-reported."}}, "additionalProperties": false}$j$::jsonb
WHERE tool = 'get_case';

DO $a336_verify$
BEGIN
  IF (SELECT input_schema -> 'properties' -> 'include' -> 'items' -> 'enum' ? 'questionnaire'
      FROM platform_private.ai_agent_tool_schemas WHERE tool = 'get_case') IS NOT TRUE THEN
    RAISE EXCEPTION 'a336_verify_schema' USING ERRCODE = '55000';
  END IF;
END
$a336_verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
