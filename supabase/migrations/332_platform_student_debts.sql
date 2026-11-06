-- 332 «Долги студентов» — вкладка страницы «Финансы» (решение владельца 06.11.2026).
-- Что добавляется: одна функция чтения platform.student_debts_v1(организация) -> JSONB. Она ничего не пишет и ничего не меняет.
-- Откуда цифры (правило блока «Оплата … остаток» карточки студента, миграция 189): стоимость договора — взносы EVO
-- (platform.payment_obligations, category evo_service_fee, не архивные; сторонние расходы third_party_cost не считаются), оплачено —
-- platform.payment_events по этим взносам (платежи минус возвраты по делу и валюте), долг = стоимость − оплачено. Строка с
-- has_other_currency_payments говорит, что у дела есть оплаты в валюте, которой строка не видит (они в долг не вычитаются). В ответ идут только дела с
-- долгом больше нуля, по убыванию долга; строка — одно дело в одной валюте (дело с долгами в двух валютах даёт две строки).
-- Валюты не пересчитываются и не складываются: итоги отдельно по каждой валюте.
-- Кто читает: те же, что «Финансовый отчёт» (миграция 323): системный Admin или держатель `finance.read.full` с областью
-- «вся организация» (platform_private.report_link_finance_org_access). Остальные — 42501 (`student_debts_forbidden`).
-- Таблицы клиентским ролям не открываются: читает только определитель функции. EXECUTE — только authenticated.
-- Ответ: строки не больше 500 (`truncated` говорит, что дел с долгом больше); итоги считаются по всем делам с долгом.
-- Forward-only, ничего не удаляет и не переименовывает.
BEGIN;

DO $a332_guard$
BEGIN
  IF to_regclass('platform.payment_obligations') IS NULL OR to_regclass('platform.payment_events') IS NULL
    OR to_regclass('platform.student_cases') IS NULL
    OR to_regprocedure('platform_private.report_link_finance_org_access(uuid,uuid)') IS NULL
    OR to_regprocedure('platform.current_actor_authority()') IS NULL THEN
    RAISE EXCEPTION 'a332_prerequisite_missing' USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('platform.student_debts_v1(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'a332_already_applied' USING ERRCODE = '55000';
  END IF;
END
$a332_guard$;

CREATE FUNCTION platform.student_debts_v1(p_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor RECORD;
  v_rows JSONB;
  v_totals JSONB;
  v_count BIGINT;
BEGIN
  SELECT a.organization_id, a.membership_id, a.platform_role INTO v_actor
  FROM platform.current_actor_authority() a
  WHERE p_organization_id IS NOT NULL AND a.organization_id = p_organization_id
    AND a.membership_id IS NOT NULL AND a.platform_role IS DISTINCT FROM 'student'
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'student_debts_forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_actor.platform_role IS DISTINCT FROM 'admin'::platform.business_role
    AND NOT platform_private.report_link_finance_org_access(v_actor.organization_id, v_actor.membership_id)
  THEN
    RAISE EXCEPTION 'student_debts_forbidden' USING ERRCODE = '42501';
  END IF;

  -- Одним запросом: чтение остаётся STABLE и ничего не пишет.
  WITH debts AS (
    -- Те же правила, что у блока «Оплата … остаток» карточки студента (`platform.case_agreement_v1`, миграция 189): считаются только
    -- взносы EVO (`category = 'evo_service_fee'`, без сторонних расходов `third_party_cost`) и только не архивные (`archived_at IS NULL`);
    -- оплачено — платежи минус возвраты по этим взносам; без пересчёта валют (остаток «по траншам» в каждой валюте).
    SELECT c.student_case_id AS case_id, c.currency, c.cost_minor,
      coalesce(p.paid_minor, 0) AS paid_minor, c.cost_minor - coalesce(p.paid_minor, 0) AS debt_minor,
      -- Оплаты, которых строка не видит: в валюте, отличной от валюты взноса, или в валюте, где у дела нет взноса.
      EXISTS (
        SELECT 1 FROM platform.payment_events e
        JOIN platform.payment_obligations o ON o.organization_id = e.organization_id AND o.id = e.payment_obligation_id
        WHERE e.organization_id = p_organization_id AND e.student_case_id = c.student_case_id
          AND o.category = 'evo_service_fee' AND o.archived_at IS NULL
          AND ((o.currency = c.currency AND e.currency <> o.currency)
            OR (e.currency <> c.currency AND NOT EXISTS (
              SELECT 1 FROM platform.payment_obligations o2
              WHERE o2.organization_id = p_organization_id AND o2.student_case_id = c.student_case_id
                AND o2.category = 'evo_service_fee' AND o2.archived_at IS NULL AND o2.currency = e.currency)))
      ) AS has_other_currency_payments
    FROM (
      SELECT o.student_case_id, o.currency, sum(o.amount_minor)::BIGINT AS cost_minor
      FROM platform.payment_obligations o
      WHERE o.organization_id = p_organization_id AND o.category = 'evo_service_fee' AND o.archived_at IS NULL
      GROUP BY o.student_case_id, o.currency
    ) c
    LEFT JOIN (
      SELECT e.student_case_id, e.currency,
        (coalesce(sum(e.amount_minor) FILTER (WHERE e.event_type = 'payment'), 0)
         - coalesce(sum(e.amount_minor) FILTER (WHERE e.event_type = 'refund'), 0))::BIGINT AS paid_minor
      FROM platform.payment_events e
      JOIN platform.payment_obligations o ON o.organization_id = e.organization_id AND o.id = e.payment_obligation_id
      WHERE e.organization_id = p_organization_id AND o.category = 'evo_service_fee' AND o.archived_at IS NULL
      GROUP BY e.student_case_id, e.currency
    ) p ON p.student_case_id = c.student_case_id AND p.currency = c.currency
    WHERE c.cost_minor - coalesce(p.paid_minor, 0) > 0
  ), top_rows AS (
    SELECT * FROM debts ORDER BY debt_minor DESC, case_id LIMIT 500
  )
  SELECT
    (SELECT count(*) FROM debts),
    (SELECT coalesce(jsonb_agg(jsonb_build_object('currency', t.currency, 'cost_minor', t.cost, 'paid_minor', t.paid,
        'debt_minor', t.debt, 'case_count', t.cnt) ORDER BY t.currency), '[]'::JSONB)
      FROM (SELECT currency, sum(cost_minor)::BIGINT cost, sum(paid_minor)::BIGINT paid, sum(debt_minor)::BIGINT debt, count(*) cnt
            FROM debts GROUP BY currency) t),
    (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'case_id', r.case_id, 'student_name', sc.student_display_name, 'country', sc.target_country,
        'direction', sc.program_direction, 'curator', cp.display_name, 'currency', r.currency,
        'cost_minor', r.cost_minor, 'paid_minor', r.paid_minor, 'debt_minor', r.debt_minor,
        'has_other_currency_payments', r.has_other_currency_payments)
        ORDER BY r.debt_minor DESC, sc.student_display_name, r.case_id), '[]'::JSONB)
      FROM top_rows r
      JOIN platform.student_cases sc ON sc.organization_id = p_organization_id AND sc.id = r.case_id
      LEFT JOIN platform.organization_memberships cm ON cm.organization_id = p_organization_id AND cm.id = sc.current_curator_membership_id
      LEFT JOIN platform.profiles cp ON cp.id = cm.profile_id)
  INTO v_count, v_totals, v_rows;

  RETURN jsonb_build_object('schema_version', 1, 'organization_id', p_organization_id,
    'rows', v_rows, 'totals', v_totals, 'case_row_count', v_count, 'truncated', v_count > 500);
END
$$;
REVOKE ALL ON FUNCTION platform.student_debts_v1(UUID) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.student_debts_v1(UUID) TO authenticated;
COMMENT ON FUNCTION platform.student_debts_v1(UUID) IS
  'Migration 332: students with a debt (contract cost from payment_obligations minus payments minus refunds from payment_events, per case and currency, debt > 0, largest first, at most 500 rows, totals per currency, never converted). Read only. Admin or finance.read.full over the WHOLE organization; others 42501.';

NOTIFY pgrst, 'reload schema';

COMMIT;
