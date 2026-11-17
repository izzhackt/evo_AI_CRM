-- 361 «Добавить студента»: стоимость договора может быть 0; оплата 0 не
-- записывается (решения владельца 17.11.2026).
--
-- Что было. platform_private.admissions_direct_minor (281) принимает только
-- положительное целое, а CHECK на platform.payment_obligations.amount_minor и
-- platform.payment_events.amount_minor требуют amount_minor > 0. Ноль в форме
-- до базы не доходит, а если бы дошёл — строка денег не записалась бы.
--
-- Что меняется.
--   1) admissions_direct_minor принимает 0 только для стоимости
--      (p_label = 'cost'). Оплата 0 по-прежнему отвергается
--      (admissions_direct_invalid:payment): «получено 0» — это не оплата, и
--      форма такую строку не отправляет. Верхняя граница та же
--      (1 000 000 000 000). Функцию зовут и create_admissions_student_case
--      (281), и импорт дела из отчёта продаж (307): стоимость 0 становится
--      допустимой и там. Форма нагрузки не меняется.
--   2) CHECK platform.payment_obligations.amount_minor становится >= 0 (имя
--      ограничения сохраняется): договор на 0 записывается обязательством 0,
--      оно сразу «оплачено» (derive_obligation_status: 0 = 0).
--      CHECK platform.payment_events.amount_minor > 0 НЕ меняется: строки
--      оплаты на 0 в базе быть не может. Ручные команды
--      (create_payment_obligation, запись оплаты, чеки 358) по-прежнему
--      отвергают сумму <= 0 своей проверкой: их этот файл не трогает.
--
-- Условий продажи (lead_sale_condition_fields, 184) ноль уже не отвергает:
-- шаблон суммы там `^(0|[1-9][0-9]{0,12})$`.
-- Forward-only. Повтор — a361_already_applied. Чужое тело или чужой CHECK —
-- a361_anchor_drift. Права функции не меняются (CREATE OR REPLACE их хранит).
BEGIN;

DO $a361_anchor$
DECLARE
  minor_body TEXT;
  rel REGCLASS;
  names TEXT[];
BEGIN
  minor_body := (SELECT p.prosrc FROM pg_catalog.pg_proc p
    WHERE p.oid = to_regprocedure('platform_private.admissions_direct_minor(jsonb,text,text)'));
  IF minor_body IS NULL THEN
    RAISE EXCEPTION 'a361_anchor_drift: admissions_direct_minor is missing' USING ERRCODE = '55000';
  END IF;
  IF strpos(minor_body, '^(0|[1-9][0-9]{0,12})$') > 0 THEN
    RAISE EXCEPTION 'a361_already_applied' USING ERRCODE = '55000';
  END IF;
  IF strpos(minor_body, '^[1-9][0-9]{0,12}$') = 0 THEN
    RAISE EXCEPTION 'a361_anchor_drift: admissions_direct_minor is not the 281 positive-only check' USING ERRCODE = '55000';
  END IF;
  FOREACH rel IN ARRAY ARRAY['platform.payment_obligations'::REGCLASS] LOOP
    SELECT array_agg(c.conname ORDER BY c.conname) INTO names
    FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = rel AND c.contype = 'c'
      AND pg_catalog.pg_get_constraintdef(c.oid) ~ 'amount_minor > 0'
      AND pg_catalog.pg_get_constraintdef(c.oid) !~ 'total_paid|total_refunded';
    IF names IS NULL OR array_length(names, 1) IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'a361_anchor_drift: % amount check count is %', rel::TEXT, COALESCE(names::TEXT, 'none') USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$a361_anchor$;

-- Ноль в минимальных единицах (JSON-число или строка из цифр).
CREATE OR REPLACE FUNCTION platform_private.admissions_direct_minor(p_object JSONB, p_key TEXT, p_label TEXT)
RETURNS BIGINT LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE raw TEXT;
BEGIN
  IF p_object IS NULL OR jsonb_typeof(p_object -> p_key) NOT IN ('number', 'string') THEN
    RAISE EXCEPTION 'admissions_direct_invalid:%', p_label USING ERRCODE = '22023';
  END IF;
  raw := p_object ->> p_key;
  IF raw !~ '^(0|[1-9][0-9]{0,12})$' OR raw::NUMERIC > 1000000000000
     OR (raw = '0' AND p_label IS DISTINCT FROM 'cost') THEN
    RAISE EXCEPTION 'admissions_direct_invalid:%', p_label USING ERRCODE = '22023';
  END IF;
  RETURN raw::BIGINT;
END $$;

COMMENT ON FUNCTION platform_private.admissions_direct_minor(JSONB, TEXT, TEXT) IS
  '361: minor-unit amount for the direct-admissions case and the sales-report case import; 0 only for the contract cost (p_label = cost), a payment stays positive. Upper bound 1000000000000.';

DO $a361_checks$
DECLARE
  rel REGCLASS;
  check_name TEXT;
BEGIN
  FOREACH rel IN ARRAY ARRAY['platform.payment_obligations'::REGCLASS] LOOP
    SELECT c.conname INTO check_name
    FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = rel AND c.contype = 'c'
      AND pg_catalog.pg_get_constraintdef(c.oid) ~ 'amount_minor > 0'
      AND pg_catalog.pg_get_constraintdef(c.oid) !~ 'total_paid|total_refunded';
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I, ADD CONSTRAINT %I CHECK (amount_minor >= 0)', rel, check_name, check_name);
  END LOOP;
END
$a361_checks$;

NOTIFY pgrst, 'reload schema';
COMMIT;
