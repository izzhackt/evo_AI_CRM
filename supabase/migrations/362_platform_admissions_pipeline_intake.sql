-- 362 «Воронка поступления»: набор на карточке (решение владельца 17.11.2026).
--
-- Доска staff_admissions_pipeline_board_v1 (187, тело с 191) не отдавала набор.
-- Карточке нужны три источника, и приложение само выбирает лучший:
--   1) анкета студента — questionnaire.intakeSeason / intakeYear
--      (platform_private.student_applications, связь student_cases.public_application_id);
--   2) пожелания лида — fields.wishes_intake_season / wishes_intake_year
--      (platform_private.lead_sale_conditions, связь student_cases.canonical_lead_id);
--   3) свободный текст дела — student_cases.intake (прямое добавление,
--      «сентябрь 2027»; при одобрении анкеты сюда же пишется сезон словами).
--
-- Только чтение. Подпись функции та же, поэтому GRANT 187/244 не повторяется.
-- Старый клиент незнакомые ключи JSON игнорирует. Новый клиент без этих ключей
-- (доска до 362) прячет набор, а не роняет карточку.
-- В JSON не попадает ни анкета целиком, ни деньги условий продажи: только
-- сезон, год и текст набора, текст обрезан до 120 символов.
--
-- Тело не переписывается целиком: два фрагмента 191 заменяются на месте, чтобы
-- чужая правка той же функции не стёрлась молча. Фрагмент не найден или найден
-- не один раз — a362_replace_drift. Повтор — a362_already_applied.
BEGIN;

DO $a362_anchor$
BEGIN
  IF to_regprocedure('platform.staff_admissions_pipeline_board_v1(uuid,text,text,text)') IS NULL
     OR to_regclass('platform_private.student_applications') IS NULL
     OR to_regclass('platform_private.lead_sale_conditions') IS NULL THEN
    RAISE EXCEPTION 'a362_anchor_drift: board function or an intake source is missing' USING ERRCODE = '55000';
  END IF;
  IF (SELECT strpos(p.prosrc, 'application_intake_season') > 0 FROM pg_catalog.pg_proc p
      WHERE p.oid = to_regprocedure('platform.staff_admissions_pipeline_board_v1(uuid,text,text,text)')) THEN
    RAISE EXCEPTION 'a362_already_applied' USING ERRCODE = '55000';
  END IF;
  IF (SELECT strpos(p.prosrc, 'needs_reply') = 0 FROM pg_catalog.pg_proc p
      WHERE p.oid = to_regprocedure('platform.staff_admissions_pipeline_board_v1(uuid,text,text,text)')) THEN
    RAISE EXCEPTION 'a362_anchor_drift: board function is not the 191 body' USING ERRCODE = '55000';
  END IF;
END
$a362_anchor$;

CREATE FUNCTION pg_temp.a362_replace(p_signature TEXT, p_old TEXT, p_new TEXT, p_expected INTEGER)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE body TEXT; matches INTEGER;
BEGIN
  body := pg_catalog.pg_get_functiondef(to_regprocedure(p_signature));
  IF p_old = '' OR body IS NULL THEN
    RAISE EXCEPTION 'a362_replace_drift: % has no body', p_signature USING ERRCODE = '55000';
  END IF;
  matches := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  IF matches IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'a362_replace_drift: % expected %, found %', p_signature, p_expected, matches USING ERRCODE = '55000';
  END IF;
  EXECUTE replace(body, p_old, p_new);
END $$;

SELECT pg_temp.a362_replace('platform.staff_admissions_pipeline_board_v1(uuid,text,text,text)',
  $old$) AS needs_reply
    FROM platform.student_cases c
    LEFT JOIN platform.organization_memberships curator_membership$old$,
  $new$) AS needs_reply,
      CASE
        WHEN application.questionnaire ->> 'intakeSeason' IN ('spring', 'summer', 'autumn', 'winter', 'undecided')
        THEN application.questionnaire ->> 'intakeSeason'
        ELSE NULL
      END AS application_intake_season,
      CASE
        WHEN application.questionnaire ->> 'intakeYear' ~ '^(19|20|21)[0-9]{2}$'
        THEN (application.questionnaire ->> 'intakeYear')::INTEGER
        ELSE NULL
      END AS application_intake_year,
      NULLIF(btrim(sale.fields ->> 'wishes_intake_season'), '') AS wishes_intake_season,
      NULLIF(btrim(sale.fields ->> 'wishes_intake_year'), '') AS wishes_intake_year,
      NULLIF(left(btrim(c.intake), 120), '') AS intake_text
    FROM platform.student_cases c
    LEFT JOIN platform_private.student_applications application
      ON application.organization_id = c.organization_id AND application.id = c.public_application_id
    LEFT JOIN platform_private.lead_sale_conditions sale
      ON sale.organization_id = c.organization_id AND sale.lead_id = c.canonical_lead_id
    LEFT JOIN platform.organization_memberships curator_membership$new$,
  1);

SELECT pg_temp.a362_replace('platform.staff_admissions_pipeline_board_v1(uuid,text,text,text)',
  $old$'needs_reply', page.needs_reply$old$,
  $new$'needs_reply', page.needs_reply,
      'application_intake_season', page.application_intake_season,
      'application_intake_year', page.application_intake_year,
      'wishes_intake_season', page.wishes_intake_season,
      'wishes_intake_year', page.wishes_intake_year,
      'intake_text', page.intake_text$new$,
  1);

COMMENT ON FUNCTION platform.staff_admissions_pipeline_board_v1(UUID, TEXT, TEXT, TEXT) IS
  'Curator admissions board. 191 added needs_reply. 362 adds application intake, lead wishes intake and student_cases.intake text; the same signature, so a client from before 362 ignores the new keys.';

NOTIFY pgrst, 'reload schema';
COMMIT;
