-- Э8.7 «Отчёт продаж»: связь строк отчёта с лидами (владелец 28.09.2026:
-- «можно связать, но это не рабочее место, просто связать» — запись отчёта
-- остаётся записью отчёта). docs/PLAN_CHANGES.md «2026-09-28 — Э8: срезы по
-- итоговой критике», срез Э8.7. Строится на 253 (Э8.6: read_sales_register_v4,
-- manage_sales_register_v2, написания менеджеров).
--
-- Why: сотрудники находят импортированную запись отчёта, которая относится к
-- уже существующему лиду в CRM, но у отчёта нет способа это отметить — только
-- «Оформить продажу» (создаёт вторую, рабочую запись через pipeline). Нужна
-- лёгкая связь для контекста, а не второй путь оформления продажи.
--
-- Почему не `sales_register.lead_id` (134): это поле — ровно «продажа
-- pipeline» (CHECK 134:25 требует пары lead_id/client_id только при
-- source_kind='pipeline', UNIQUE(organization_id,lead_id) 134:23, «Оформить
-- продажу» отказывает лиду с существующей записью 174/215). Переиспользование
-- лида превратило бы «просто связать» в смену рабочего процесса. Поэтому —
-- отдельная колонка `linked_lead_id`, отдельная пара RPC и отдельная ветка в
-- полосе «Передача», а не изменение уже выпущенных путей.
--
-- Forward-only. read_sales_register_v4, manage_sales_register_v2,
-- platform_private.sales_register_row_v2 и staff_lead_handoff_strip_v1
-- остаются побайтово прежними (откат приложения продолжает работать) — эта
-- миграция их не трогает и заново их не создаёт. SECURITY DEFINER с пустым
-- search_path; клиентские функции — только в `platform`.
--
--  a) platform_private.sales_register.linked_lead_id UUID: контекстная связь
--     импортированной строки с существующим лидом — НЕ продажа pipeline (её
--     поле — `lead_id`, 134). FK (organization_id,linked_lead_id) →
--     platform.leads(organization_id,id) (уникальный ключ 084:159 существует);
--     частичный UNIQUE(organization_id,linked_lead_id) WHERE NOT NULL — один
--     лид связан не более чем с одной записью; CHECK запрещает связь у
--     продажи pipeline (у неё уже есть lead_id).
--  b) platform.sales_record_lead_options_v1(org,query): лиды, которые актёр
--     может читать (`lead.read`), любого жизненного цикла, ещё не связанные и
--     без своей продажи pipeline; запрос от 2 символов, LIMIT 20; отдаёт id,
--     имя, слово этапа (`sales_lead_stage`, 247) и день создания — без
--     персональных сведений сверх имени, которое уже видно по `lead.read`.
--  c) platform.link_sales_record_lead_v1(org,record,expected_version,lead|null,
--     request_id): те же ворота записи, что manage_sales_register_v2
--     (sales.register.manage на записи + страж 208 Sales Manager), плюс
--     lead.read на затрагиваемом лиде (новом при связывании, прежнем при
--     отвязке); только импортированные строки, не в архиве; отказывает лиду
--     с продажей pipeline или уже связанному с другой записью; оптимистичная
--     версия, повтор по request_id, аудит без персональных данных.
--  d) platform.sales_record_lead_link_v1(org,record): маленькое чтение для
--     панели записи — id и имя связанного лида, только если у актёра есть
--     `lead.read` на него; иначе флаг «связано, но не видно» — ни имени, ни
--     прочерка наугад.
--  e) platform.staff_lead_handoff_strip_v2: как v1, но запись отчёта ищется
--     по `lead_id` ИЛИ `linked_lead_id` (продажа pipeline — в приоритете,
--     если почему-то есть обе), и в `report.record` добавлено поле `link`:
--     'sale' (настоящая продажа) | 'linked' (просто связанная запись). v1
--     остаётся неизменной для отката.
BEGIN;

-- ---------------------------------------------------------------------------
-- Anchor: v2 is a copy of v1's body with one query changed (below).
-- ---------------------------------------------------------------------------
DO $a254_anchor$
BEGIN
  IF (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p
      WHERE p.oid = 'platform.staff_lead_handoff_strip_v1(uuid,uuid)'::regprocedure)
    IS DISTINCT FROM '7089320d801256478819c3c9f6abdf95' THEN
    RAISE EXCEPTION 'a254_strip_anchor_drift: staff_lead_handoff_strip_v1 is not the 247 definition';
  END IF;
END
$a254_anchor$;

-- Rollback proof: the released reads/commands this migration never touches
-- are compared before and after.
CREATE TEMP TABLE a254_released ON COMMIT DROP AS
  SELECT p.oid::REGPROCEDURE::TEXT AS signature, md5(p.prosrc) AS body
  FROM pg_catalog.pg_proc p
  WHERE p.oid IN (
    'platform.read_sales_register_v4(uuid,integer,integer,integer,uuid,boolean,text,text,boolean,text,text)'::regprocedure,
    'platform.manage_sales_register_v2(uuid,text,uuid,bigint,jsonb,bigint,text,text,uuid)'::regprocedure,
    'platform_private.sales_register_row_v2(platform_private.sales_register)'::regprocedure,
    'platform.staff_lead_handoff_strip_v1(uuid,uuid)'::regprocedure);

-- ---------------------------------------------------------------------------
-- a) «Связать с лидом» — a plain context link, never a pipeline sale
-- ---------------------------------------------------------------------------
ALTER TABLE platform_private.sales_register
  ADD COLUMN linked_lead_id UUID,
  ADD CONSTRAINT sales_register_linked_lead_fkey
    FOREIGN KEY (organization_id, linked_lead_id)
    REFERENCES platform.leads(organization_id, id),
  ADD CONSTRAINT sales_register_linked_lead_not_pipeline
    CHECK (source_kind <> 'pipeline' OR linked_lead_id IS NULL);
CREATE UNIQUE INDEX sales_register_linked_lead_unique_idx
  ON platform_private.sales_register (organization_id, linked_lead_id)
  WHERE linked_lead_id IS NOT NULL;
COMMENT ON COLUMN platform_private.sales_register.linked_lead_id IS
  '«Связать с лидом» (254): контекстная связь импортированной строки с существующим лидом. Никогда не продажа pipeline (см. lead_id, 134) и не считается ею.';

-- ---------------------------------------------------------------------------
-- b) platform.sales_record_lead_options_v1: search for «Связать с лидом»
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.sales_record_lead_options_v1(p_organization_id UUID, p_query TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; query TEXT := btrim(coalesce(p_query, '')); options JSONB;
BEGIN
  SELECT a.* INTO actor FROM platform.current_actor_authority() a
  WHERE a.organization_id = p_organization_id AND a.membership_id IS NOT NULL
    AND a.platform_role IS DISTINCT FROM 'student'
    AND platform_private.staff_has_permission(a.organization_id, a.membership_id, 'lead.read');
  IF NOT FOUND THEN RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE = '42501'; END IF;
  IF length(query) < 2 OR length(query) > 200 OR query ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'sales_register_invalid_query' USING ERRCODE = '22023';
  END IF;
  WITH candidates AS MATERIALIZED (
    SELECT l.id, l.lifecycle_state, l.stage_key, l.created_at, c.display_name
    FROM platform.leads l JOIN platform.clients c ON c.organization_id = l.organization_id AND c.id = l.client_id
    WHERE l.organization_id = p_organization_id
      AND platform_private.staff_can_access(p_organization_id, actor.membership_id, 'lead.read', 'lead', l.id)
      AND position(lower(query) IN lower(c.display_name)) > 0
      AND NOT EXISTS (SELECT 1 FROM platform_private.sales_register r WHERE r.organization_id = p_organization_id
        AND (r.linked_lead_id = l.id OR (r.lead_id = l.id AND r.source_kind = 'pipeline')))
    ORDER BY c.display_name, l.id LIMIT 20
  ), handed AS (
    SELECT h.lead_id FROM platform_private.sales_lead_handoffs(p_organization_id,
      (SELECT coalesce(array_agg(candidates.id), ARRAY[]::UUID[]) FROM candidates)) h
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', left(c.display_name, 300),
      'stage', platform_private.sales_lead_stage(c.lifecycle_state, c.stage_key, h.lead_id IS NOT NULL),
      'created_on', c.created_at::DATE) ORDER BY c.display_name, c.id), '[]')
    INTO options FROM candidates c LEFT JOIN handed h ON h.lead_id = c.id;
  RETURN jsonb_build_object('organization_id', p_organization_id, 'query', query, 'options', options);
END $$;

-- ---------------------------------------------------------------------------
-- c) platform.link_sales_record_lead_v1: save or clear the link
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.link_sales_record_lead_v1(
  p_organization_id UUID, p_record_id UUID, p_expected_version BIGINT, p_lead_id UUID, p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; old platform_private.sales_register%ROWTYPE; changed platform_private.sales_register%ROWTYPE;
 fingerprint TEXT; prior platform_private.sales_register_requests%ROWTYPE; receipt JSONB; lead_check UUID;
BEGIN
 PERFORM 1 FROM platform.organizations WHERE id = p_organization_id FOR KEY SHARE;
 SELECT * INTO actor FROM platform_private.sales_register_actor(p_organization_id);
 IF NOT platform_private.staff_is_sales_manager(p_organization_id, actor.membership_id) THEN
   RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE = '42501'; END IF;
 IF p_request_id IS NULL OR p_record_id IS NULL OR p_expected_version IS NULL
   OR p_expected_version < 1 OR p_expected_version > 9007199254740991 THEN
   RAISE EXCEPTION 'sales_register_invalid_command' USING ERRCODE = '22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sales-register:'||p_organization_id::TEXT, 0));
 SELECT * INTO actor FROM platform_private.sales_register_actor(p_organization_id);
 IF NOT platform_private.staff_is_sales_manager(p_organization_id, actor.membership_id) THEN
   RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE = '42501'; END IF;
 fingerprint := md5(jsonb_build_object('command', 'link_lead', 'actor', actor.membership_id, 'record', p_record_id,
   'version', p_expected_version, 'lead', p_lead_id)::TEXT);
 SELECT * INTO prior FROM platform_private.sales_register_requests WHERE organization_id = p_organization_id AND request_id = p_request_id;
 IF FOUND THEN
   IF prior.fingerprint <> fingerprint OR prior.actor_membership_id <> actor.membership_id THEN
     RAISE EXCEPTION 'sales_register_request_id_conflict' USING ERRCODE = '22023'; END IF;
   IF NOT platform_private.staff_can_access(p_organization_id, actor.membership_id,
      'sales.register.manage', 'sales_register', (prior.receipt->>'record_id')::UUID) THEN
     RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE = '42501'; END IF;
   RETURN prior.receipt;
 END IF;
 SELECT * INTO old FROM platform_private.sales_register WHERE organization_id = p_organization_id AND id = p_record_id FOR UPDATE;
 IF NOT FOUND OR NOT platform_private.staff_can_access(p_organization_id, actor.membership_id,
    'sales.register.manage', 'sales_register', old.id) THEN
   RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE = '42501'; END IF;
 IF old.version <> p_expected_version THEN RAISE EXCEPTION 'sales_register_stale' USING ERRCODE = 'PT409'; END IF;
 -- «Просто связать» — только импортированная строка, не в архиве.
 IF old.source_kind <> 'import' OR old.archived THEN
   RAISE EXCEPTION 'sales_register_invalid_command' USING ERRCODE = '22023'; END IF;
 -- lead.read на затрагиваемом лиде: новом при связывании, прежнем при отвязке.
 lead_check := coalesce(p_lead_id, old.linked_lead_id);
 IF lead_check IS NULL OR NOT platform_private.staff_has_permission(p_organization_id, actor.membership_id, 'lead.read')
   OR NOT platform_private.staff_can_access(p_organization_id, actor.membership_id, 'lead.read', 'lead', lead_check) THEN
   RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE = '42501'; END IF;
 IF p_lead_id IS NOT NULL THEN
   IF NOT EXISTS(SELECT 1 FROM platform.leads l WHERE l.organization_id = p_organization_id AND l.id = p_lead_id) THEN
     RAISE EXCEPTION 'sales_register_invalid_lead' USING ERRCODE = '22023'; END IF;
   IF EXISTS(SELECT 1 FROM platform_private.sales_register r WHERE r.organization_id = p_organization_id
       AND r.lead_id = p_lead_id AND r.source_kind = 'pipeline') THEN
     RAISE EXCEPTION 'sales_register_lead_has_sale' USING ERRCODE = 'PT409'; END IF;
   IF EXISTS(SELECT 1 FROM platform_private.sales_register r WHERE r.organization_id = p_organization_id
       AND r.linked_lead_id = p_lead_id AND r.id <> old.id) THEN
     RAISE EXCEPTION 'sales_register_lead_already_linked' USING ERRCODE = 'PT409'; END IF;
 END IF;
 UPDATE platform_private.sales_register SET linked_lead_id = p_lead_id, version = version + 1, updated_at = now()
   WHERE id = old.id RETURNING * INTO changed;
 receipt := jsonb_build_object('organization_id', p_organization_id, 'record_id', changed.id, 'version', changed.version::TEXT,
   'operation', CASE WHEN p_lead_id IS NULL THEN 'unlink' ELSE 'link' END, 'request_id', p_request_id);
 INSERT INTO platform_private.sales_register_requests VALUES (p_organization_id, p_request_id, actor.membership_id, fingerprint, receipt, 'Sales record lead link');
 -- No personal data in the shared audit projection: only whether a link exists.
 INSERT INTO platform.audit_events(organization_id, actor_kind, actor_profile_id, actor_principal, action, resource_type, resource_id, before_state, after_state, reason, request_id)
 VALUES (p_organization_id, 'user', actor.profile_id, 'auth:'||actor.auth_user_id::TEXT,
   CASE WHEN p_lead_id IS NULL THEN 'sales.register.lead.unlink' ELSE 'sales.register.lead.link' END,
   'sales_register', changed.id,
   jsonb_build_object('version', old.version::TEXT, 'linked', old.linked_lead_id IS NOT NULL),
   jsonb_build_object('version', changed.version::TEXT, 'linked', changed.linked_lead_id IS NOT NULL),
   'Sales record lead link', p_request_id);
 RETURN receipt;
END $$;

-- ---------------------------------------------------------------------------
-- d) platform.sales_record_lead_link_v1: the panel's small read
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.sales_record_lead_link_v1(p_organization_id UUID, p_record_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; rec RECORD; lead_name TEXT; result JSONB;
BEGIN
  SELECT * INTO actor FROM platform_private.sales_register_actor(p_organization_id);
  SELECT r.id, r.linked_lead_id INTO rec FROM platform_private.sales_register r
    WHERE r.organization_id = p_organization_id AND r.id = p_record_id
      AND platform_private.staff_can_access(p_organization_id, actor.membership_id, 'sales.register.read', 'sales_register', r.id);
  IF NOT FOUND THEN RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE = '42501'; END IF;
  IF rec.linked_lead_id IS NULL THEN
    RETURN jsonb_build_object('organization_id', p_organization_id, 'record_id', p_record_id, 'link', NULL);
  END IF;
  IF platform_private.staff_has_permission(p_organization_id, actor.membership_id, 'lead.read')
    AND platform_private.staff_can_access(p_organization_id, actor.membership_id, 'lead.read', 'lead', rec.linked_lead_id) THEN
    SELECT c.display_name INTO lead_name FROM platform.leads l
      JOIN platform.clients c ON c.organization_id = l.organization_id AND c.id = l.client_id
      WHERE l.organization_id = p_organization_id AND l.id = rec.linked_lead_id;
    result := jsonb_build_object('organization_id', p_organization_id, 'record_id', p_record_id,
      'link', jsonb_build_object('visible', true, 'lead_id', rec.linked_lead_id, 'name', left(coalesce(lead_name, ''), 300)));
  ELSE
    -- Связано, но у этого актёра нет lead.read на связанный лид: ни имени, ни прочерка наугад.
    result := jsonb_build_object('organization_id', p_organization_id, 'record_id', p_record_id,
      'link', jsonb_build_object('visible', false, 'lead_id', NULL, 'name', NULL));
  END IF;
  RETURN result;
END $$;

-- ---------------------------------------------------------------------------
-- e) platform.staff_lead_handoff_strip_v2: lead_id OR linked_lead_id, pipeline first
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.staff_lead_handoff_strip_v2(p_organization_id UUID, p_lead_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  lead_row RECORD;
  handoff RECORD;
  gate RECORD;
  sale RECORD;
  report JSONB;
  curator JSONB := NULL;
  acceptance JSONB := NULL;
  case_row RECORD;
  assignment RECORD;
  response RECORD;
  recordable BOOLEAN := NULL;
BEGIN
  SELECT a.* INTO actor FROM platform.current_actor_authority() a
  WHERE a.organization_id = p_organization_id AND a.membership_id IS NOT NULL
    AND a.platform_role IS DISTINCT FROM 'student'
    AND platform_private.staff_has_permission(a.organization_id, a.membership_id, 'lead.read');
  IF NOT FOUND OR p_lead_id IS NULL THEN
    RAISE EXCEPTION 'lead_handoff_strip_forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT l.id, l.client_id, l.stage_key, l.lifecycle_state INTO lead_row
  FROM platform.leads l
  WHERE l.organization_id = p_organization_id AND l.id = p_lead_id
    AND platform_private.staff_can_access(p_organization_id, actor.membership_id, 'lead.read', 'lead', l.id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lead_handoff_strip_forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT h.completed_at, h.student_case_id, h.evidence INTO handoff
  FROM platform_private.sales_lead_handoffs(p_organization_id, ARRAY[p_lead_id]) h;

  SELECT g.contract_confirmed, g.contract_confirmed_at, g.first_payment_received_date INTO gate
  FROM platform.lead_admissions_gates g
  WHERE g.organization_id = p_organization_id AND g.lead_id = p_lead_id;

  -- The report record: only for report readers with access to the record.
  -- 254: a record can match this lead by `lead_id` (a real pipeline sale) or
  -- by `linked_lead_id` (254's plain context link); a pipeline match wins
  -- when, for any reason, both exist. `link` tells the app which one it is —
  -- a linked record is never treated as the recorded sale.
  IF platform_private.staff_has_permission(p_organization_id, actor.membership_id, 'sales.register.read') THEN
    SELECT r.id, r.report_month, r.archived, NULLIF(r.fields->>'signing_date', '')::DATE AS sale_date,
      COALESCE(btrim(r.fields->>'contract_number'), '') <> '' AS has_contract_number,
      CASE WHEN r.fields->>'paid_minor' ~ '^[0-9]{1,13}$' AND (r.fields->>'paid_minor')::BIGINT > 0
        AND r.fields->>'paid_currency' ~ '^[A-Z]{3}$' THEN (r.fields->>'paid_minor')::BIGINT END AS paid_minor,
      r.fields->>'paid_currency' AS paid_currency,
      CASE WHEN r.lead_id = p_lead_id THEN 'sale' ELSE 'linked' END AS link
    INTO sale
    FROM platform_private.sales_register r
    WHERE r.organization_id = p_organization_id AND (r.lead_id = p_lead_id OR r.linked_lead_id = p_lead_id)
      AND platform_private.staff_can_access(
        p_organization_id, actor.membership_id, 'sales.register.read', 'sales_register', r.id)
    -- `r.lead_id` is NULL for a merely linked row: compare with IS NOT DISTINCT
    -- FROM so that NULL sorts as false, not first, under DESC.
    ORDER BY (r.lead_id IS NOT DISTINCT FROM p_lead_id) DESC
    LIMIT 1;
    report := jsonb_build_object('status', 'available', 'record', CASE WHEN sale.id IS NULL THEN NULL ELSE
      jsonb_build_object('id', sale.id, 'report_month', sale.report_month, 'sale_date', sale.sale_date,
        'archived', sale.archived, 'has_contract_number', sale.has_contract_number,
        'paid', CASE WHEN sale.paid_minor IS NULL THEN NULL ELSE
          jsonb_build_object('minor', sale.paid_minor::TEXT, 'currency', sale.paid_currency) END,
        'link', sale.link) END);
  ELSE
    report := jsonb_build_object('status', 'denied', 'record', NULL);
  END IF;

  -- The handoff's case: its current curator, when that curator was
  -- assigned, and the curator's latest answer to exactly that assignment
  -- (the 130 lookup: a reassignment starts a new answer). With no curator
  -- after a decline (182: the case back in 'pending'), the case's latest
  -- answer is that decline.
  IF handoff.student_case_id IS NOT NULL THEN
    SELECT c.id, c.current_curator_membership_id, c.state INTO case_row
    FROM platform.student_cases c
    WHERE c.organization_id = p_organization_id AND c.id = handoff.student_case_id;
    recordable := EXISTS (
      SELECT 1 FROM platform.sales_admissions_handoffs h
      WHERE h.organization_id = p_organization_id AND h.student_case_id = handoff.student_case_id);
    IF case_row.current_curator_membership_id IS NULL AND case_row.state = 'pending' THEN
      SELECT a.decision, a.created_at INTO response
      FROM platform.student_case_handoff_acknowledgements a
      WHERE a.organization_id = p_organization_id AND a.student_case_id = case_row.id
      ORDER BY a.created_at DESC, a.revision DESC LIMIT 1;
      IF response.decision = 'declined' THEN
        acceptance := jsonb_build_object('decision', response.decision, 'at', response.created_at);
      END IF;
    END IF;
    IF case_row.current_curator_membership_id IS NOT NULL THEN
      SELECT e.id, e.created_at INTO assignment
      FROM platform.student_case_assignment_events e
      WHERE e.organization_id = p_organization_id AND e.student_case_id = case_row.id
        AND e.new_curator_membership_id = case_row.current_curator_membership_id
      ORDER BY e.new_scope_version DESC LIMIT 1;
      SELECT jsonb_build_object('display_name', p.display_name, 'assigned_at', assignment.created_at) INTO curator
      FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
      WHERE m.organization_id = p_organization_id AND m.id = case_row.current_curator_membership_id;
      IF assignment.id IS NOT NULL THEN
        SELECT a.decision, a.created_at INTO response
        FROM platform.student_case_handoff_acknowledgements a
        WHERE a.organization_id = p_organization_id AND a.student_case_id = case_row.id
          AND a.assignment_event_id = assignment.id
          AND a.curator_membership_id = case_row.current_curator_membership_id
        ORDER BY a.revision DESC LIMIT 1;
        IF response.decision IS NOT NULL THEN
          acceptance := jsonb_build_object('decision', response.decision, 'at', response.created_at);
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'organization_id', p_organization_id,
    'lead_id', p_lead_id,
    'stage', platform_private.sales_lead_stage(lead_row.lifecycle_state, lead_row.stage_key,
      handoff.completed_at IS NOT NULL),
    'handoff', CASE WHEN handoff.completed_at IS NULL THEN NULL ELSE
      jsonb_build_object('completed_at', handoff.completed_at, 'evidence', handoff.evidence,
        'acceptance_recordable', COALESCE(recordable, FALSE)) END,
    'contract', jsonb_build_object('confirmed', COALESCE(gate.contract_confirmed, FALSE),
      'confirmed_at', CASE WHEN gate.contract_confirmed IS TRUE THEN gate.contract_confirmed_at END),
    'first_payment', jsonb_build_object('received_date', gate.first_payment_received_date),
    'report', report,
    'curator', curator,
    'acceptance', acceptance);
END
$$;

REVOKE ALL ON FUNCTION platform.sales_record_lead_options_v1(UUID, TEXT),
  platform.link_sales_record_lead_v1(UUID, UUID, BIGINT, UUID, UUID),
  platform.sales_record_lead_link_v1(UUID, UUID),
  platform.staff_lead_handoff_strip_v2(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.sales_record_lead_options_v1(UUID, TEXT),
  platform.link_sales_record_lead_v1(UUID, UUID, BIGINT, UUID, UUID),
  platform.sales_record_lead_link_v1(UUID, UUID),
  platform.staff_lead_handoff_strip_v2(UUID, UUID)
  TO authenticated;

-- Every function of this migration keeps the empty search_path; client
-- functions are SECURITY DEFINER and callable by authenticated only; the
-- released reads and commands this migration does not touch stay byte-identical.
DO $a254_verify$
DECLARE routine RECORD;
BEGIN
  FOR routine IN SELECT p.oid::REGPROCEDURE AS signature, p.prosecdef, p.proconfig
    FROM pg_catalog.pg_proc AS p
    WHERE p.oid IN (
      'platform.sales_record_lead_options_v1(uuid,text)'::regprocedure,
      'platform.link_sales_record_lead_v1(uuid,uuid,bigint,uuid,uuid)'::regprocedure,
      'platform.sales_record_lead_link_v1(uuid,uuid)'::regprocedure,
      'platform.staff_lead_handoff_strip_v2(uuid,uuid)'::regprocedure)
  LOOP
    IF routine.proconfig IS DISTINCT FROM ARRAY['search_path=""']
      OR has_function_privilege('anon', routine.signature, 'EXECUTE')
      OR NOT routine.prosecdef
      OR NOT has_function_privilege('authenticated', routine.signature, 'EXECUTE')
    THEN
      RAISE EXCEPTION 'a254_sales_record_lead_verification_failed: %', routine.signature;
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM a254_released r JOIN pg_catalog.pg_proc p ON p.oid = r.signature::regprocedure
      WHERE md5(p.prosrc) IS DISTINCT FROM r.body)
    OR (SELECT count(*) FROM a254_released) <> 4 THEN
    RAISE EXCEPTION 'a254_sales_record_lead_verification_failed: a released read or command changed';
  END IF;
END
$a254_verify$;

COMMENT ON FUNCTION platform.sales_record_lead_options_v1(UUID, TEXT) IS
  '«Связать с лидом» — поиск (254): лиды с lead.read, любого жизненного цикла, ещё не связанные и без своей продажи pipeline; запрос от 2 символов, LIMIT 20.';
COMMENT ON FUNCTION platform.link_sales_record_lead_v1(UUID, UUID, BIGINT, UUID, UUID) IS
  '«Связать с лидом» (254): сохраняет или снимает linked_lead_id импортированной записи. Ворота — как manage_sales_register_v2 плюс lead.read на затрагиваемом лиде; отказывает лиду с продажей pipeline или уже связанному.';
COMMENT ON FUNCTION platform.sales_record_lead_link_v1(UUID, UUID) IS
  'Чтение связи записи с лидом для панели «Отчёта продаж» (254): имя лида только при lead.read актёра, иначе флаг «связано, но не видно».';
COMMENT ON FUNCTION platform.staff_lead_handoff_strip_v2(UUID, UUID) IS
  'staff_lead_handoff_strip_v1 (247) + связь 254: запись отчёта ищется по lead_id ИЛИ linked_lead_id (продажа pipeline — в приоритете), report.record получает link: ''sale''|''linked''. v1 остаётся для отката.';

NOTIFY pgrst, 'reload schema';
COMMIT;
