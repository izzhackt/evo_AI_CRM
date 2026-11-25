-- 376: «История» дела называет записанный платёж суммой и названием.
--
-- Было: событие `finance.payment.record` в «Истории» и «Ленте» карточки студента
-- приходило только типом и временем, и две оплаты читались одинаково:
-- «Платёж записан 10.11 18:56» без суммы и без того, какой это платёж.
--
-- Стало: у этого события (и только у него) в ответе
-- `private.staff_student_case_activity` есть поле `payment_detail`:
--   { "amount_minor": BIGINT, "currency": TEXT, "kind": "payment" | "refund",
--     "label": TEXT | NULL }
-- из самой записи платежа (`payment_events`) и названия обязательства
-- (`payment_obligations.label`). Строка `money` этого события и так видна только
-- с `finance.read.summary` (ветка `finance_summary_ok` из 310); те же сумма и
-- название уже видны этому же читателю в блоке «Оплата» карточки
-- (`staff_case_finance_control`, 189: чтение по `finance.read.summary`). Новых
-- прав и новых строк нет; название, которое не прошло бы проверку текста
-- блока «Оплата» (длиннее 500 знаков или с управляющими символами), не
-- отдаётся (`label: null`).
--
-- Тело функции меняется самопроверяемой заменой, как в 302: якорь — конец
-- поля `direction_change`; если тело разошлось с ожидаемым, миграция падает,
-- а не тихо пропускает изменение. Права, владелец и сигнатура не меняются.

DO $a376_activity$
DECLARE original TEXT; body TEXT;
BEGIN
  IF to_regprocedure('private.staff_student_case_activity(uuid,integer,timestamptz,uuid)') IS NULL THEN
    RAISE EXCEPTION 'a376_activity_missing';
  END IF;
  original := pg_get_functiondef(
    'private.staff_student_case_activity(uuid,integer,timestamptz,uuid)'::regprocedure
  );
  body := replace(
    original,
    $old$      ELSE '{}'::JSONB END
      ORDER BY created_at DESC, id DESC) FILTER (WHERE ordinal <= p_limit)$old$,
    $new$      ELSE '{}'::JSONB END
      || CASE WHEN action = 'finance.payment.record' AND kind = 'money' THEN jsonb_build_object('payment_detail',
        (SELECT jsonb_build_object(
           'amount_minor', payment.amount_minor,
           'currency', payment.currency,
           'kind', payment.event_type,
           'label', CASE WHEN char_length(obligation.label) <= 500 AND obligation.label !~ '[[:cntrl:]]'
             THEN obligation.label ELSE NULL END)
         FROM platform.payment_events AS payment
         LEFT JOIN platform.payment_obligations AS obligation
           ON obligation.organization_id = payment.organization_id AND obligation.id = payment.payment_obligation_id
         WHERE payment.organization_id = actor.organization_id AND payment.id = numbered.target_id
           AND payment.student_case_id = p_student_case_id))
      ELSE '{}'::JSONB END
      ORDER BY created_at DESC, id DESC) FILTER (WHERE ordinal <= p_limit)$new$
  );
  IF body = original
    OR (length(body) - length(replace(body, $chk$'payment_detail'$chk$, '')))
      / length($chk$'payment_detail'$chk$) <> 1
    OR (length(body) - length(replace(body, $chk$'direction_change'$chk$, '')))
      / length($chk$'direction_change'$chk$) <> 1
  THEN
    RAISE EXCEPTION 'a376_activity_anchor_drift';
  END IF;
  EXECUTE body;
END
$a376_activity$;
