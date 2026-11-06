-- 337 «При одобрении анкеты в дело копируется вся анкета» (решение владельца 03.11.2026, «ок» на пункт «при одобрении копируется не
-- вся анкета — дополнить»). Хуки набора в `scripts/test-runners/test-postgres-authorization.sh` привязаны к имени файла.
-- Что было: decide_student_application_v1 (180 + 193 + 209) при одобрении заводит профиль и поля карточки студента (на проверку,
-- review_state needs_review), но из анкеты в поля попадали только имя, фамилия, телефон, почта, гражданство, статус обучения и
-- бюджет. Страны, направления, ступени, английский и сезон начала оставались только в самой анкете.
-- Что меняется, одно место в двух ветках одобрения (обычной и приглашённой, приём 282: фрагмент обязан встретиться ровно дважды):
-- в поля карточки добавляются
--   desired_country_of_study — страны анкеты по-русски через запятую (без «Пока не решил»),
--   field_major              — направления анкеты через запятую,
--   program_level            — ступени анкеты по-русски через запятую,
--   english_level            — английский словами (тот же текст, что в language_summary),
--   desired_start_date       — сезон и год начала;
-- тоже на проверку, обрезанные до длины поля. Маршрут дела (target_country, admissions_direction) по-прежнему не трогается: его
-- выбирает сотрудник (план §4/§8). Профиль, который уже был у приглашённого дела, по-прежнему не переписывается этими полями.
-- Новых функций, таблиц и прав нет. Forward-only: повтор отказывает a337_already_applied, чужое тело — a337_replace_drift.
-- Порядок выката любой: приложение функцию вызывает как раньше.
BEGIN;

DO $a337_anchor$
BEGIN
  IF (SELECT strpos(p.prosrc, 'desired_country_of_study') > 0 FROM pg_catalog.pg_proc p
      WHERE p.oid = to_regprocedure('platform.decide_student_application_v1(uuid,bigint,text,text,uuid)')) THEN
    RAISE EXCEPTION 'a337_already_applied' USING ERRCODE = '55000';
  END IF;
END
$a337_anchor$;

-- Как pg_temp.a329_replace, но фрагмент обязан встретиться ровно p_expected раз (здесь: обе ветки одобрения).
CREATE FUNCTION pg_temp.a337_replace(p_signature TEXT, p_old TEXT, p_new TEXT, p_expected INTEGER)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE body TEXT; matches INTEGER;
BEGIN
  body := pg_get_functiondef(to_regprocedure(p_signature));
  matches := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  IF body IS NULL OR matches IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'a337_replace_drift: % expected %, found %', p_signature, p_expected, matches USING ERRCODE = '55000';
  END IF;
  EXECUTE replace(body, p_old, p_new);
END $$;

SELECT pg_temp.a337_replace('platform.decide_student_application_v1(uuid,bigint,text,text,uuid)',
  $old$('nationality',NULL::TEXT),('current_study_status',education_label),('budget_per_year',budget_label)$old$,
  $new$('nationality',NULL::TEXT),('current_study_status',education_label),('budget_per_year',budget_label),
     -- 337: остальное из анкеты, на проверку.
     ('desired_country_of_study',NULLIF(btrim(left((SELECT string_agg(CASE d.c WHEN 'CN' THEN 'Китай' WHEN 'MY' THEN 'Малайзия' WHEN 'AE' THEN 'ОАЭ'
       WHEN 'TR' THEN 'Турция' WHEN 'IT' THEN 'Италия' WHEN 'CZ' THEN 'Чехия' END,', ' ORDER BY d.o)
       FROM jsonb_array_elements_text(q->'destinationCountries') WITH ORDINALITY AS d(c,o)),60)),'')),
     ('field_major',NULLIF(btrim(left((SELECT string_agg(btrim(f.v),', ' ORDER BY f.o) FROM jsonb_array_elements_text(q->'studyFields') WITH ORDINALITY AS f(v,o)
       WHERE btrim(f.v)<>''),100)),'')),
     ('program_level',NULLIF(btrim(left((SELECT string_agg(CASE l.v WHEN 'foundation' THEN 'Подготовительная программа' WHEN 'bachelor' THEN 'Бакалавриат'
       WHEN 'master' THEN 'Магистратура' WHEN 'phd' THEN 'Докторантура' WHEN 'diploma' THEN 'Колледж / диплом' WHEN 'language' THEN 'Языковая программа' END,
       ', ' ORDER BY l.o) FROM jsonb_array_elements_text(q->'studyLevels') WITH ORDINALITY AS l(v,o)),60)),'')),
     ('english_level',NULLIF(btrim(left(btrim(language_label),60)),'')),
     ('desired_start_date',NULLIF(btrim(left(CASE q->>'intakeSeason' WHEN 'spring' THEN 'Весна' WHEN 'summer' THEN 'Лето' WHEN 'autumn' THEN 'Осень'
       WHEN 'winter' THEN 'Зима' ELSE 'Сезон не определён' END||' '||(q->>'intakeYear'),30)),''))$new$,
  2);

NOTIFY pgrst, 'reload schema';

COMMIT;
