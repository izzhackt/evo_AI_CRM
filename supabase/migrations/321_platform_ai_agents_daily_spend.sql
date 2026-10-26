-- 321: «ИИ-агенты»: расход агента за сутки по Бишкеку для дневного лимита на WhatsApp (решение владельца
-- 26.10.2026: агент «Продажи» остаётся в WhatsApp с лимитом $10 в день; docs/PLAN_CHANGES.md «2026-10-26 ·
-- ИИ-агенты: дневной лимит $10 на запуски по WhatsApp (миграция 321)»). Номер 321: на origin/main последняя 320;
-- хуки набора привязаны к имени файла, не к номеру. Если к слиянию номер 321 занят другой миграцией, этот файл
-- переименовывается в следующий свободный номер вместе с именем в хуке `scripts/test-postgres-authorization.sh`.
--
-- Зачем. Запуск агента по входящему сообщению WhatsApp (`whatsapp_inbound`) теперь не стартует, когда расход агента
-- за сутки дошёл до лимита. Решает приложение (`src/lib/ai-agents/daily-cap.ts`), но расход лежит в
-- `platform_private.ai_agent_runs` (приложение читает только через RPC), а ни одна функция рантайма его не отдаёт:
-- `ai_agents_get_v1` и `ai_agents_list_v1` — для сотрудника с правами, `ai_agent_runtime_runs_open_v1` — только
-- открытые запуски без расхода за день. Эта миграция добавляет ОДНУ чтение-функцию рантайма и больше ничего.
--
-- Forward-only, ничего не удаляет и не меняет: новая функция схемы `platform` для service_role; таблицы, прежние
-- функции и их права не затронуты. SECURITY DEFINER с пустым search_path. Повторный запуск: a321_already_applied
-- (55000).
--
--   platform.ai_agent_runtime_daily_spend_v1(организация, ключ агента, момент, окно в минутах) -> JSONB
--     day         сутки по Asia/Bishkek для момента (`YYYY-MM-DD`; момент по умолчанию — часы базы; приложение
--                 передаёт свои часы, чтобы день в базе и ключ строки «лимит исчерпан» в приложении совпадали);
--     dayStart    начало этих суток (00:00 по Бишкеку) как момент времени;
--     spentCents  записанный `cost_cents` ВСЕХ запусков агента, начатых в эти сутки, в любом статусе и любого вида
--                 (лимит про агента, а не про один вид запуска; сами запуски по заявке, расписанию и поручению им не
--                 останавливаются);
--     open        запуски агента в работе (`starting` / `running`), начатые не раньше чем за окно до начала этих
--                 суток (по умолчанию 60 минут, от 1 до 1440), ЛЮБОГО возраста: `[{costCents, startedAt, triggerKind}]`,
--                 не больше 50. Расход запуска записывается только при его закрытии, поэтому открытая строка всегда
--                 показывает 0, и давний запуск в работе не отбрасывается: иначе при отставшей сверке (таймер или
--                 Claude недоступны) лимит открылся бы сам. Под запуски по WhatsApp приложение держит резерв.
--   Ошибки: `ai_agent_not_found` (P0002) для неизвестного ключа или пустой организации; не service_role — отказ
--   общего стража `require_p2g_service`. Чужая организация видна как нулевой расход: чтение ограничено
--   `organization_id` в каждом запросе.
--
-- Порядок выката. Миграция идёт ДО приложения с лимитом: приложение, не нашедшее эту функцию (PGRST202), не
-- запускает агента по WhatsApp (расход не проверить - не пропускаем) и пишет в журнал `dispatch_cap` с кодом.
-- Прежнее приложение функцию не вызывает и работает как раньше.
BEGIN;

-- ---------------------------------------------------------------------------
-- Якоря: объекты 317, на которые опирается миграция, и отказ при повторном применении.
-- ---------------------------------------------------------------------------
DO $a321_anchor$
BEGIN
  IF to_regclass('platform_private.ai_agent_runs') IS NULL
    OR to_regprocedure('platform_private.require_p2g_service()') IS NULL
    OR to_regprocedure('platform_private.ai_agent_key_known(text)') IS NULL THEN
    RAISE EXCEPTION 'a321_anchor_drift: the 317 objects this migration builds on are missing' USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('platform.ai_agent_runtime_daily_spend_v1(uuid,text,timestamp with time zone,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'a321_already_applied' USING ERRCODE = '55000';
  END IF;
END
$a321_anchor$;

-- ---------------------------------------------------------------------------
-- Функция рантайма (service_role): расход агента за сутки и запуски в работе. Только чтение.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.ai_agent_runtime_daily_spend_v1(p_organization_id UUID, p_key TEXT,
  p_now TIMESTAMPTZ DEFAULT NULL, p_open_minutes INTEGER DEFAULT 60)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_now TIMESTAMPTZ; v_day DATE; v_from TIMESTAMPTZ; v_to TIMESTAMPTZ; v_minutes INTEGER; v_spent BIGINT; v_open JSONB;
BEGIN
  PERFORM platform_private.require_p2g_service();
  IF p_organization_id IS NULL OR p_key IS NULL OR NOT platform_private.ai_agent_key_known(p_key) THEN
    RAISE EXCEPTION 'ai_agent_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_now := COALESCE(p_now, clock_timestamp());
  v_minutes := least(greatest(COALESCE(p_open_minutes, 60), 1), 1440);
  -- Сутки по Бишкеку (UTC+6, без перехода на летнее время): [00:00 дня; 00:00 следующего дня).
  v_day := (v_now AT TIME ZONE 'Asia/Bishkek')::DATE;
  v_from := v_day::TIMESTAMP AT TIME ZONE 'Asia/Bishkek';
  v_to := (v_day + 1)::TIMESTAMP AT TIME ZONE 'Asia/Bishkek';
  SELECT COALESCE(sum(r.cost_cents), 0) INTO v_spent
  FROM platform_private.ai_agent_runs r
  WHERE r.organization_id = p_organization_id AND r.agent_key = p_key AND r.started_at >= v_from AND r.started_at < v_to;
  -- Запуск в работе держит резерв, пока не закрыт, любого возраста: окно отсчитывается назад от начала суток, а не от
  -- «сейчас», чтобы запуск, начатый перед полуночью и ещё идущий, не пропал, а зависшая давняя строка не копилась вечно.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('costCents', o.cost_cents, 'startedAt', o.started_at, 'triggerKind', o.trigger_kind)
      ORDER BY o.started_at, o.id), '[]'::JSONB) INTO v_open
  FROM (SELECT x.id, x.cost_cents, x.started_at, x.trigger_kind FROM platform_private.ai_agent_runs x
    WHERE x.organization_id = p_organization_id AND x.agent_key = p_key AND x.status IN ('starting', 'running')
      AND x.started_at >= v_from - make_interval(mins => v_minutes)
    ORDER BY x.started_at, x.id LIMIT 50) o;
  RETURN jsonb_build_object('day', to_char(v_day, 'YYYY-MM-DD'), 'dayStart', v_from, 'spentCents', v_spent, 'open', v_open);
END
$$;

-- ---------------------------------------------------------------------------
-- Права: как у остальных функций рантайма (317): только service_role.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION platform.ai_agent_runtime_daily_spend_v1(uuid, text, timestamp with time zone, integer)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
GRANT EXECUTE ON FUNCTION platform.ai_agent_runtime_daily_spend_v1(uuid, text, timestamp with time zone, integer)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Проверка в конце: определитель, пустой search_path, права, число функций семейства «рантайм».
-- ---------------------------------------------------------------------------
DO $a321_verify$
DECLARE f RECORD; v_runtime INTEGER;
BEGIN
  SELECT p.oid, p.prosecdef, p.proconfig INTO f FROM pg_catalog.pg_proc p
  WHERE p.oid = to_regprocedure('platform.ai_agent_runtime_daily_spend_v1(uuid,text,timestamp with time zone,integer)');
  IF f.oid IS NULL OR NOT f.prosecdef OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[] THEN
    RAISE EXCEPTION 'a321_verify_function' USING ERRCODE = '55000';
  END IF;
  IF NOT has_function_privilege('service_role', f.oid, 'EXECUTE')
    OR has_function_privilege('anon', f.oid, 'EXECUTE')
    OR has_function_privilege('authenticated', f.oid, 'EXECUTE')
    OR has_function_privilege('supabase_auth_admin', f.oid, 'EXECUTE')
    OR has_function_privilege('evo_ai_agent', f.oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'a321_verify_grants' USING ERRCODE = '55000';
  END IF;
  -- 16 функций рантайма после 318 и одна новая; сотрудник (9), MCP (3) и инструменты (24) не изменились.
  SELECT count(*) INTO v_runtime FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'platform' AND p.proname LIKE 'ai\_agent\_runtime\_%';
  IF v_runtime <> 17
    OR (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'platform' AND p.proname LIKE 'ai\_agents\_%\_v1') <> 9
    OR (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'platform' AND p.proname LIKE 'ai\_agent\_mcp\_%') <> 3
    OR (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'platform' AND p.proname LIKE 'ai\_agent\_tool\_%') <> 24 THEN
    RAISE EXCEPTION 'a321_verify_counts' USING ERRCODE = '55000';
  END IF;
END
$a321_verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
