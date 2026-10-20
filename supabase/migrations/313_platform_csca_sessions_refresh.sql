-- 313: календарь сессий CSCA сверен с csca.cn 21.10.2026 (поручение владельца 21.10.2026:
-- «обновить даты сессий CSCA»). docs/PLAN_CHANGES.md «2026-10-21 · Календарь сессий CSCA:
-- сверка с csca.cn (миграция 313)».
--
-- Forward-only, только данные: шесть новых строк `platform_private.csca_exam_sessions`;
-- таблица, функции, права и прежние строки не меняются. Строки таблицы неизменяемы
-- (285: UPDATE и DELETE запрещены сторожем), «исправление = новая строка того же
-- `session_key`»: главная трека (`learning_track_home_v1`) и выбор сессии
-- (`set_learning_target_session_v1`) читают последнюю по `published_at, id`, поэтому
-- с этой миграции клиенты видят новую дату проверки и новый адрес источника.
--
-- Что проверено. Главная страница csca.cn (календарь экзаменов) и официальное объявление
-- csca.cn о расписании 2026/27 от 14.10.2026 (csca.cn/articles/notice) 21.10.2026:
--   - даты всех шести сессий те же, что записала 286 (14 и 15.11.2026; 19 и 20.12.2026;
--     23 и 24.01.2027; 13 и 14.03.2027; 24 и 25.04.2027; 26 и 27.06.2027): менять нечего;
--   - окно регистрации опубликовано только у сессии 14 и 15 ноября (15.10.2026 15:00 -
--     21.10.2026 23:59 по Пекину, UTC+8), оно то же;
--   - у остальных пяти csca.cn показывает «регистрация не началась»: окно не
--     опубликовано, поэтому остаётся NULL (его нельзя угадывать; когда сайт его
--     опубликует, это новая строка в новой миграции);
--   - страница `/about/examintro`, указанная источником в 286, даты сессий не содержит
--     (там расписание по часам и стоимость); даты и окно регистрации показывает главная
--     страница, адрес источника заменён на неё.
-- Файл-источник: docs/design/portal/content/csca/sessions.json (его сверяет
-- scripts/portal/test-csca-content-seed.mjs: последние строки по каждой сессии,
-- восстановленные из миграций, равны этому файлу).
--
-- Якоря и повторный запуск. Перед вставкой миграция сверяет последнюю строку каждой из
-- шести сессий: даты и окно регистрации равны ожидаемым (иначе кто-то уже менял календарь
-- и нужна новая сверка, а не эта вставка), а дата проверки раньше 21.10.2026; при
-- повторном запуске последняя строка уже проверена 21.10.2026, и миграция останавливается
-- (`p313_anchor_*`). После вставки та же сверка идёт по новым строкам.
BEGIN;

SELECT 'P313_CSCA_SESSIONS_REFRESH_START' AS p313_marker;

DO $p313_anchor$
DECLARE
  expected RECORD;
  latest platform_private.csca_exam_sessions%ROWTYPE;
BEGIN
  FOR expected IN
    SELECT * FROM (VALUES
      ('2026-11', '2026-11-14'::DATE, '2026-11-15'::DATE, '2026-10-15T15:00:00+08:00'::TIMESTAMPTZ, '2026-10-21T23:59:00+08:00'::TIMESTAMPTZ),
      ('2026-12', '2026-12-19'::DATE, '2026-12-20'::DATE, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ),
      ('2027-01', '2027-01-23'::DATE, '2027-01-24'::DATE, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ),
      ('2027-03', '2027-03-13'::DATE, '2027-03-14'::DATE, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ),
      ('2027-04', '2027-04-24'::DATE, '2027-04-25'::DATE, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ),
      ('2027-06', '2027-06-26'::DATE, '2027-06-27'::DATE, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ)
    ) AS value(session_key, exam_from, exam_to, registration_opens_at, registration_closes_at)
  LOOP
    SELECT session.* INTO latest FROM platform_private.csca_exam_sessions session
      WHERE session.session_key = expected.session_key
      ORDER BY session.published_at DESC, session.id DESC LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'p313_anchor_missing: session % has no published row', expected.session_key
        USING ERRCODE = '55000';
    END IF;
    IF latest.exam_from IS DISTINCT FROM expected.exam_from
      OR latest.exam_to IS DISTINCT FROM expected.exam_to
      OR latest.registration_opens_at IS DISTINCT FROM expected.registration_opens_at
      OR latest.registration_closes_at IS DISTINCT FROM expected.registration_closes_at
    THEN
      RAISE EXCEPTION 'p313_anchor_drift: the calendar of session % changed after 286', expected.session_key
        USING ERRCODE = '55000';
    END IF;
    IF latest.verified_on >= DATE '2026-10-21' THEN
      RAISE EXCEPTION 'p313_anchor_rerun: session % is already verified on %', expected.session_key, latest.verified_on
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$p313_anchor$;

INSERT INTO platform_private.csca_exam_sessions (id, session_key, exam_from, exam_to, registration_opens_at, registration_closes_at, source_url, verified_on)
VALUES
  ('37af6174-6157-5e7f-8d24-31dcdeccff91', '2026-11', '2026-11-14'::DATE, '2026-11-15'::DATE, '2026-10-15T15:00:00+08:00'::TIMESTAMPTZ, '2026-10-21T23:59:00+08:00'::TIMESTAMPTZ, 'https://csca.cn/home', '2026-10-21'::DATE),
  ('85d565bb-224c-5257-82a3-382e03a0aabd', '2026-12', '2026-12-19'::DATE, '2026-12-20'::DATE, NULL, NULL, 'https://csca.cn/home', '2026-10-21'::DATE),
  ('15d4edca-ae68-5166-8665-64ae02e52685', '2027-01', '2027-01-23'::DATE, '2027-01-24'::DATE, NULL, NULL, 'https://csca.cn/home', '2026-10-21'::DATE),
  ('5b0c137b-05c8-532e-81b8-795c2046599c', '2027-03', '2027-03-13'::DATE, '2027-03-14'::DATE, NULL, NULL, 'https://csca.cn/home', '2026-10-21'::DATE),
  ('9ea61bb8-4b83-5b6d-8877-9c49581f2f5e', '2027-04', '2027-04-24'::DATE, '2027-04-25'::DATE, NULL, NULL, 'https://csca.cn/home', '2026-10-21'::DATE),
  ('7fa72a0e-8d91-50f9-8751-469f43e08d6d', '2027-06', '2027-06-26'::DATE, '2027-06-27'::DATE, NULL, NULL, 'https://csca.cn/home', '2026-10-21'::DATE);

DO $p313_verify$
DECLARE n INTEGER;
BEGIN
  -- Последняя строка каждой из шести сессий: проверена 21.10.2026, источник главная
  -- страница csca.cn, даты и окно регистрации прежние.
  SELECT count(*) INTO n FROM (
    SELECT DISTINCT ON (session.session_key) session.*
    FROM platform_private.csca_exam_sessions session
    WHERE session.session_key IN ('2026-11', '2026-12', '2027-01', '2027-03', '2027-04', '2027-06')
    ORDER BY session.session_key, session.published_at DESC, session.id DESC
  ) latest
  WHERE latest.verified_on = DATE '2026-10-21' AND latest.source_url = 'https://csca.cn/home'
    AND (latest.session_key, latest.exam_from, latest.exam_to) IN (
      ('2026-11', DATE '2026-11-14', DATE '2026-11-15'), ('2026-12', DATE '2026-12-19', DATE '2026-12-20'),
      ('2027-01', DATE '2027-01-23', DATE '2027-01-24'), ('2027-03', DATE '2027-03-13', DATE '2027-03-14'),
      ('2027-04', DATE '2027-04-24', DATE '2027-04-25'), ('2027-06', DATE '2027-06-26', DATE '2027-06-27'))
    AND (latest.session_key = '2026-11') = (latest.registration_closes_at IS NOT NULL);
  IF n <> 6 THEN
    RAISE EXCEPTION 'p313_verify_sessions: expected 6 refreshed sessions, found %', n USING ERRCODE = '55000';
  END IF;
  -- Окно сессии 14 и 15 ноября не изменилось.
  IF NOT EXISTS (
    SELECT 1 FROM platform_private.csca_exam_sessions session
    WHERE session.id = '37af6174-6157-5e7f-8d24-31dcdeccff91'
      AND session.registration_opens_at = '2026-10-15T15:00:00+08:00'::TIMESTAMPTZ
      AND session.registration_closes_at = '2026-10-21T23:59:00+08:00'::TIMESTAMPTZ)
  THEN
    RAISE EXCEPTION 'p313_verify_window: the registration window of 2026-11 changed' USING ERRCODE = '55000';
  END IF;
END
$p313_verify$;

SELECT 'P313_CSCA_SESSIONS_REFRESH_ASSERTED' AS p313_marker;

COMMIT;
