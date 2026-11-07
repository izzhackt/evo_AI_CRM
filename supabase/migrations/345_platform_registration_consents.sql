-- ============================================================
-- 345_platform_registration_consents.sql
--
-- Согласия при регистрации (решение пользователя 07.11.2026, docs/design/v3/product.md «07.11 — Согласия при
-- регистрации»). Обязательная галочка анкеты теперь ещё и принимает Политику конфиденциальности: у текста согласия
-- анкеты новая версия «2026-11-07». Хуки набора в `scripts/test-runners/test-postgres-authorization.sh` привязаны к
-- имени файла.
--
--  a) platform_private.student_application_questionnaire_valid (CHECK анкеты и submit_student_application_v1)
--     принимает обе версии: «2026-11-07» (новая галочка) и «2026-09-18» (сохранённые анкеты, вкладка, открытая до
--     выката, сборки iPhone). Без старой версии повторная проверка CHECK при одобрении сломала бы ждущие анкеты.
--  b) platform.decide_student_application_v1 пишет в доказательство согласия (student_profiles.consent_evidence_ref)
--     версию из самой анкеты, а не зашитую «2026-09-18»: принявший новую политику получает свою версию.
-- Вторая обязательная галочка (ИИ-помощники) пишется прежней командой portal_ai_consent_set_v1 (320) от имени самого
-- студента после подтверждения почты: база для неё не меняется.
--
-- Тела функций меняются заменой проверенных фрагментов (шаблон 281/282): каждый фрагмент обязан встретиться ровно
-- столько раз, сколько ожидается, иначе миграция падает. CREATE OR REPLACE сохраняет владельца и права.
-- Forward-only: повтор отказывает a345_already_applied.
-- ============================================================

BEGIN;

DO $a345_guard$
BEGIN
  IF pg_get_functiondef('platform_private.student_application_questionnaire_valid(jsonb)'::regprocedure) LIKE '%2026-11-07%' THEN
    RAISE EXCEPTION 'a345_already_applied' USING ERRCODE = '55000';
  END IF;
END
$a345_guard$;

CREATE FUNCTION pg_temp.a345_replace(p_signature TEXT, p_old TEXT, p_new TEXT, p_count INTEGER)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE body TEXT; matches INTEGER;
BEGIN
  body := pg_get_functiondef(to_regprocedure(p_signature));
  matches := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  IF body IS NULL OR matches IS DISTINCT FROM p_count THEN
    RAISE EXCEPTION 'a345_replace_drift: % expected %, found %', p_signature, p_count, matches;
  END IF;
  EXECUTE replace(body, p_old, p_new);
END $$;

-- a) Обе версии согласия анкеты.
SELECT pg_temp.a345_replace('platform_private.student_application_questionnaire_valid(jsonb)',
  $old$OR q->>'consentVersion'<>'2026-09-18'$old$,
  $new$OR q->>'consentVersion' NOT IN ('2026-09-18', '2026-11-07')$new$, 1);

-- b) Доказательство согласия — по версии самой анкеты (обе ветки одобрения: обычная и по приглашению).
SELECT pg_temp.a345_replace('platform.decide_student_application_v1(uuid,bigint,text,text,uuid)',
  $old$'student_application:'||app.id::TEXT||':consent:2026-09-18'$old$,
  $new$'student_application:'||app.id::TEXT||':consent:'||(app.questionnaire->>'consentVersion')$new$, 2);

NOTIFY pgrst, 'reload schema';

COMMIT;
