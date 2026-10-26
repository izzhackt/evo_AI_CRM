-- 324 «WhatsApp продаж через Wazzup: значение провайдера» (решение владельца 26.10.2026: «Да, через Wazzup»; план этапа 1
-- docs/EVO_WAZZUP_WHATSAPP_PLAN_2026-10-27.md §6 «Миграция A», PR #1307). Номер 324: на origin/main последняя 322, 323
-- занята параллельной веткой; сверяется ещё раз перед слиянием (хуки набора привязаны к имени файла, не к номеру).
--
-- Что делает. Только добавляет значение `wazzup` в перечисление `platform.communication_provider` (waha, kommo, amocrm).
-- Отдельной миграцией, потому что новое значение перечисления нельзя использовать в той же транзакции, где оно добавлено
-- (PostgreSQL, ALTER TYPE ... ADD VALUE): всё, что его использует (проверки формы, индексы, строки событий), - миграция 325.
--
-- Forward-only: значение перечисления не удаляется. Безвредна для работающего приложения: ни одна строка не получает нового
-- значения, пока 325 и приложение этапа 1 не применены и путь Wazzup не включён командой оператора. Повторный запуск
-- отказывает (`a324_already_applied`).
BEGIN;

DO $a324_anchor$
DECLARE v_labels TEXT[];
BEGIN
  IF to_regtype('platform.communication_provider') IS NULL THEN
    RAISE EXCEPTION 'a324_anchor_drift: platform.communication_provider is missing' USING ERRCODE = '55000';
  END IF;
  SELECT array_agg(e.enumlabel::TEXT ORDER BY e.enumsortorder) INTO v_labels
  FROM pg_catalog.pg_enum e WHERE e.enumtypid = 'platform.communication_provider'::REGTYPE;
  IF 'wazzup' = ANY (v_labels) THEN
    RAISE EXCEPTION 'a324_already_applied' USING ERRCODE = '55000';
  END IF;
  IF v_labels IS DISTINCT FROM ARRAY['waha', 'kommo', 'amocrm']::TEXT[] THEN
    RAISE EXCEPTION 'a324_anchor_drift: platform.communication_provider is not waha, kommo, amocrm' USING ERRCODE = '55000';
  END IF;
END
$a324_anchor$;

ALTER TYPE platform.communication_provider ADD VALUE 'wazzup';

DO $a324_verify$
BEGIN
  IF (SELECT array_agg(e.enumlabel::TEXT ORDER BY e.enumsortorder) FROM pg_catalog.pg_enum e
      WHERE e.enumtypid = 'platform.communication_provider'::REGTYPE)
    IS DISTINCT FROM ARRAY['waha', 'kommo', 'amocrm', 'wazzup']::TEXT[] THEN
    RAISE EXCEPTION 'a324_verify_provider' USING ERRCODE = '55000';
  END IF;
END
$a324_verify$;

COMMIT;
