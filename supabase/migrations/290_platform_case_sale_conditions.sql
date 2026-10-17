-- «Данные продажи» и направление на деле прямого студента (поручение владельца
-- 17.10.2026). docs/PLAN_CHANGES.md «Дело студента: «Данные продажи» и
-- направление у дел прямого импорта (миграция 290, запись до кода)».
--
-- Forward-only, on the LIVE definitions of 001–288. SECURITY DEFINER with the
-- empty search_path; client-callable functions only in `platform`, EXECUTE only
-- for `authenticated`.
--
-- Why: a case made by «Добавить студента» or the import has a lead that 281
-- turns `converted` at once. The lead reads (staff_sales_lead_detail,
-- staff_lead_admissions_gate, staff_lead_admissions_handoff) return only `open`
-- leads, so the case page falls into its «case only» branch and cannot show the
-- contract cost and signing day 281 stored in platform_private.lead_sale_conditions.
-- The case snapshot also never returned admissions_direction.
--
--  a) platform.staff_student_case_sale_conditions_v1(organization, case): the
--     sale conditions of the case's canonical lead, in the same 32-key shape as
--     platform.staff_lead_sale_conditions_v1 (184) so the application keeps one
--     parser. Visibility is NOT widened:
--      * the right to read the case in full (`case.read.full` on this case), the
--        exact check platform.staff_case_access_snapshot uses — a strict subset
--        of the readers of staff_student_case_read_snapshot in `full` mode
--        (the 248 reader of a needs-curator case, who has no section access,
--        gets none);
--      * only a direct-admissions case (source_key 'admissions-direct:' || lead,
--        the 281 origin check) is answered; every other case gets NULL, so a
--        reader of a sales case who has no lead right learns nothing new, and
--        sales leads stay behind lead.read on the lead card;
--      * the money keys (cost, paid, payment note) are blanked unless the actor
--        holds finance.read.full or finance.read.summary on the case — the
--        `finance` section flag of staff_case_access_snapshot.
--     Students, Sales without case.read.full, another organization, a user without
--     membership: 42501; anon: no EXECUTE.
--  b) platform.staff_student_case_read_snapshot gains `admissions_direction` as
--     the LAST column (`full` mode only, NULL for sales_summary). A TABLE return
--     cannot change under CREATE OR REPLACE, so DROP + CREATE in this one
--     transaction with the same arguments, body shape, grants and comment (the
--     body is anchored by md5). The only application reader
--     (normalizePlatformStudentCaseSnapshot) reads columns by name and does not
--     check the key set, so the running application keeps working before and
--     after this migration (proved by tests/platform-admissions.test.mjs).
BEGIN;

-- ---------------------------------------------------------------------------
-- Anchors: the replaced snapshot and its source are the live 001–288 definitions.
-- ---------------------------------------------------------------------------
DO $a290_anchor$
BEGIN
  IF (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p
      WHERE p.oid = 'platform.staff_student_case_read_snapshot(uuid)'::regprocedure)
     IS DISTINCT FROM 'a407bc69cf736072d7cfb779c2a412ff' THEN
    RAISE EXCEPTION 'a290_anchor_drift: platform.staff_student_case_read_snapshot(uuid) is not the expected definition';
  END IF;
  IF pg_catalog.pg_get_function_result('platform.staff_student_case_read_snapshot(uuid)'::regprocedure)
     LIKE '%admissions_direction%' THEN
    RAISE EXCEPTION 'a290_anchor_drift: the snapshot already returns admissions_direction';
  END IF;
  -- The page the snapshot wraps already carries the column.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform' AND p.proname = 'staff_student_case_page'
      AND pg_catalog.pg_get_function_result(p.oid) LIKE '%admissions_direction text%'
  ) THEN
    RAISE EXCEPTION 'a290_anchor_drift: staff_student_case_page does not return admissions_direction';
  END IF;
  IF to_regprocedure('platform_private.lead_sale_conditions_row(platform_private.lead_sale_conditions)') IS NULL
     OR to_regprocedure('platform_private.lead_sale_condition_fields(jsonb)') IS NULL
     OR to_regprocedure('platform_private.staff_can_access_for_actor(uuid,text,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'a290_anchor_drift: a sale-condition or access helper is missing';
  END IF;
END
$a290_anchor$;

-- ---------------------------------------------------------------------------
-- b) The snapshot returns admissions_direction (last column).
-- ---------------------------------------------------------------------------
DROP FUNCTION platform.staff_student_case_read_snapshot(UUID);

CREATE FUNCTION platform.staff_student_case_read_snapshot(
  p_student_case_id UUID
)
RETURNS TABLE (
  access_mode TEXT,
  sort_at TIMESTAMPTZ,
  organization_id UUID,
  student_case_id UUID,
  student_display_name TEXT,
  target_country TEXT,
  target_degree TEXT,
  program_direction TEXT,
  intake TEXT,
  language_assumption TEXT,
  funding_assumption TEXT,
  route_approval_status platform.route_approval_status,
  operational_stage TEXT,
  state platform.student_case_state,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  handoff_at TIMESTAMPTZ,
  next_action TEXT,
  responsible_sales_display_name TEXT,
  current_curator_display_name TEXT,
  applied_ozo_workflow_contract_version_id UUID,
  overdue_task_count BIGINT,
  overdue_obligation_count BIGINT,
  rejected_document_count BIGINT,
  student_case_op_handoff_id UUID,
  op_workflow_contract_version_id UUID,
  approved_commercial_fields JSONB,
  unresolved_questions JSONB,
  promises JSONB,
  handoff_next_step TEXT,
  handoff_due_at TIMESTAMPTZ,
  handoff_responsible_role platform.business_role,
  handoff_created_at TIMESTAMPTZ,
  admissions_direction TEXT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    page.access_mode, page.sort_at, page.organization_id, page.student_case_id,
    page.student_display_name, page.target_country, page.target_degree,
    page.program_direction, page.intake, page.language_assumption,
    page.funding_assumption, page.route_approval_status, page.operational_stage,
    page.state, page.created_at, page.updated_at, page.handoff_at, page.next_action,
    page.responsible_sales_display_name, page.current_curator_display_name,
    page.applied_ozo_workflow_contract_version_id, page.overdue_task_count,
    page.overdue_obligation_count, page.rejected_document_count,
    CASE WHEN page.access_mode = 'full' THEN handoff.id END,
    CASE WHEN page.access_mode = 'full'
      THEN handoff.op_workflow_contract_version_id END,
    CASE WHEN page.access_mode = 'full'
      THEN handoff.approved_commercial_fields END,
    CASE WHEN page.access_mode = 'full' THEN handoff.unresolved_questions END,
    CASE WHEN page.access_mode = 'full' THEN handoff.promises END,
    CASE WHEN page.access_mode = 'full' THEN handoff.next_step END,
    CASE WHEN page.access_mode = 'full' THEN handoff.due_at END,
    CASE WHEN page.access_mode = 'full' THEN handoff.responsible_role END,
    CASE WHEN page.access_mode = 'full' THEN handoff.created_at END,
    CASE WHEN page.access_mode = 'full' THEN page.admissions_direction END
  FROM platform.staff_student_case_page(
    1,
    NULL,
    NULL,
    NULL,
    NULL,
    p_student_case_id
  ) AS page
  LEFT JOIN platform.student_case_op_handoffs AS handoff
    ON page.access_mode = 'full'
   AND handoff.organization_id = page.organization_id
   AND handoff.student_case_id = page.student_case_id
$$;

REVOKE ALL ON FUNCTION platform.staff_student_case_read_snapshot(UUID)
  FROM PUBLIC, anon, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_student_case_read_snapshot(UUID) TO authenticated;
COMMENT ON FUNCTION platform.staff_student_case_read_snapshot(UUID) IS
  'One canonical role-scoped student-case detail projection for full and post-handoff summary access. 290: the last column is the admissions direction (full access only).';

-- ---------------------------------------------------------------------------
-- a) The sale conditions of a direct-admissions case.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.staff_student_case_sale_conditions_v1(
  p_organization_id UUID,
  p_student_case_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target platform.student_cases%ROWTYPE;
  stored platform_private.lead_sale_conditions%ROWTYPE;
  body JSONB;
BEGIN
  -- The exact right staff_case_access_snapshot (the case page's section gate)
  -- demands: no needs-curator reader, no Student, no other organization.
  IF p_organization_id IS NULL OR p_student_case_id IS NULL
     OR NOT platform_private.staff_can_access_for_actor(
       p_organization_id, 'case.read.full', 'student_case', p_student_case_id) THEN
    RAISE EXCEPTION 'case_sale_conditions_forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO target FROM platform.student_cases AS c
   WHERE c.organization_id = p_organization_id AND c.id = p_student_case_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'case_sale_conditions_forbidden' USING ERRCODE = '42501';
  END IF;

  -- Only the direct-admissions origin (281's check): the lead of every other
  -- case is read through the lead right on the lead card.
  IF target.canonical_lead_id IS NULL
     OR target.source_key IS DISTINCT FROM ('admissions-direct:' || target.canonical_lead_id::TEXT)
     OR NOT EXISTS (
       SELECT 1 FROM platform.leads AS l
        WHERE l.organization_id = target.organization_id AND l.id = target.canonical_lead_id
          AND l.source_key = 'admissions_direct') THEN
    RETURN NULL;
  END IF;

  SELECT * INTO stored FROM platform_private.lead_sale_conditions AS c
   WHERE c.organization_id = target.organization_id AND c.lead_id = target.canonical_lead_id;
  IF FOUND THEN
    body := platform_private.lead_sale_conditions_row(stored);
  ELSE
    -- Nothing entered at creation: the blank card, as the lead read returns it.
    body := platform_private.lead_sale_condition_fields('{}'::JSONB) || jsonb_build_object(
      'organization_id', target.organization_id, 'lead_id', target.canonical_lead_id,
      'revision', '0', 'updated_by_membership_id', NULL, 'updated_at', NULL);
  END IF;

  -- Money follows the case page's own finance section (finance.read.full or
  -- finance.read.summary on this case): without it the cost, the paid amount and
  -- the payment note stay blank, as the page hides «Договор и оплата».
  IF NOT (
    platform_private.staff_can_access_for_actor(
      p_organization_id, 'finance.read.full', 'student_case', p_student_case_id)
    OR platform_private.staff_can_access_for_actor(
      p_organization_id, 'finance.read.summary', 'student_case', p_student_case_id)
  ) THEN
    body := body || jsonb_build_object(
      'service_cost_raw', '', 'service_cost_minor', NULL, 'service_cost_currency', NULL,
      'paid_raw', '', 'paid_minor', NULL, 'paid_currency', NULL, 'payment_note', '');
  END IF;

  -- A direct lead never reaches the sales report (281); the key keeps the shape
  -- of staff_lead_sale_conditions_v1 so the application has one parser.
  RETURN body || jsonb_build_object('linked_sales_register', NULL);
END
$$;

REVOKE ALL ON FUNCTION platform.staff_student_case_sale_conditions_v1(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_student_case_sale_conditions_v1(UUID, UUID) TO authenticated;
COMMENT ON FUNCTION platform.staff_student_case_sale_conditions_v1(UUID, UUID) IS
  '290: read-only «Данные продажи» of a direct-admissions case (the conditions of its converted lead). Needs case.read.full on the case; NULL for any other case; the money keys are blank without finance.read.full/summary on the case. Same 32-key shape as staff_lead_sale_conditions_v1.';

COMMIT;
