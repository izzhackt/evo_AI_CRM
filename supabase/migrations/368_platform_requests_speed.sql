-- ============================================================
-- 368_platform_requests_speed.sql
--
-- Скорость «Заявок» (аудит владельца 20.11.2026: полная загрузка /requests в боевой базе, медиана 1,5 с, p90 1,7 с).
-- Хук набора в `scripts/test-runners/test-postgres-authorization.sh` привязан к имени файла, а не к номеру.
--
-- Что тратит время в `platform.staff_requests_queue_v3` (300) и в странице:
--  1. `lead_scope` зовёт `platform_private.staff_can_access(... 'lead.read', 'lead', l.id)` на КАЖДЫЙ открытый лид:
--     цепочка из пяти SQL-функций на строку (310 измерила ~5,9 мс на проверку);
--  2. `PERFORM private.staff_sales_lead_page(1)` исполняет всю страницу «Воронки» (связи, подсчёты, сортировка) ради одной
--     проверки, а результат выбрасывает;
--  3. `platform_private.student_application_visible` решает право на разбор анкеты на КАЖДУЮ анкету (три проверки на страну);
--  4. страница зовёт до 20 `telephony_lead_calls_v1` параллельно, по одному на строку «Звонков».
--
-- Что делает миграция (только скорость; решения о доступе те же, строки те же, ошибки те же):
--  A. `platform_private.staff_requests_ledger_guard_v1(org, lead_ids)`: ровно проверка целостности журнала продаж из
--     `staff_sales_lead_page` (111/119: квитанции, аудит, текущее состояние открытых лидов, видимых звонящему), без
--     самой страницы. Отказ тот же: `sales_stage_entry_evidence_inconsistent` (23514). Остальные отказы страницы
--     (`sales_workflow_forbidden`, фильтры) очереди недостижимы: она зовёт страницу только после `lead.read` у того же
--     актёра, а страница при `lead.read` без других условий не отказывает.
--  B. `staff_requests_queue_v3`: видимые лиды считаются ОДИН раз множеством 310 (`staff_visible_ids_v1`), им же
--     питаются `lead_scope` и проверка A; право на разбор анкеты решается по разу на направление, а не на анкету.
--     «Можно взять» остаётся построчной проверкой четырёх прав (множество 310 их пары не поддерживает), только на
--     строках страницы. Подпись, ответ, ключи и права функции прежние.
--  C. `platform.telephony_lead_calls_batch_v1(org, lead_ids, limit_per_lead)`: те же строки, что `telephony_lead_calls_v1`,
--     по каждому видимому лиду одним запросом. Право то же — `lead.read` на лид (множество 310 с узким `only_ids`):
--     невидимый или чужой лид просто отсутствует в ответе (одиночная функция отвечает ему 42501). Отказ звонящему
--     без права на организацию и проверка параметров те же, что у одиночной.
--
-- Защита от дрейфа: md5 боевого `prosrc` у заменяемой функции и у всех, чью логику повторяет новый код; расхождение
-- прерывает миграцию, ничего не меняя. Эталоны (`staff_sales_lead_page`, `telephony_lead_calls_v1`) остаются как были и
-- получают комментарий «зеркалится, менять вместе»; набор supabase/tests/platform_requests_speed.sql сверяет новые
-- функции с прежними построчно на самой цепочке. Forward-only: повтор отказывает a368_already_applied.
-- CREATE OR REPLACE сохраняет владельца и права функции. Порядок выката: миграция до приложения (старое приложение
-- продолжает звать прежние функции; приложение с пакетным чтением звонков без миграции получает пустые исходы звонков).
-- ============================================================

BEGIN;

DO $a368_guard$
DECLARE pinned RECORD; actual TEXT;
BEGIN
  IF to_regprocedure('platform_private.staff_requests_ledger_guard_v1(uuid,uuid[])') IS NOT NULL
    OR to_regprocedure('platform.telephony_lead_calls_batch_v1(uuid,uuid[],integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'a368_already_applied' USING ERRCODE = '55000';
  END IF;
  FOR pinned IN SELECT * FROM (VALUES
    ('platform.staff_requests_queue_v3(uuid,text,text,integer,jsonb)', 'db224f4cbc898a77a59084bb2d89de8b'),
    ('private.staff_sales_lead_page(integer,timestamp with time zone,uuid,text,text,text,uuid,text,text)', '690b21b268fb8dcfaf6921eeed88fdf1'),
    ('platform.telephony_lead_calls_v1(uuid,uuid,integer,timestamp with time zone,timestamp with time zone)', 'a2a1a9bc5a217b51daab217ca83dba0b'),
    ('platform_private.staff_visible_ids_v1(uuid,uuid,text,text,uuid[])', 'ca9cf0d8e2a3599e37aa01fea0d6f733'),
    ('platform_private.staff_can_access(uuid,uuid,text,text,uuid)', '21e0ba2d0b74502c8611c5d8cf4852f8'),
    ('platform_private.student_application_visible(uuid,jsonb)', '8f5a7bc44fc29927eba83adecc6b2e0c'),
    ('platform_private.student_application_can_manage(uuid,text)', '6d46718507160393e1fdc0ed10e9bf39'),
    ('platform_private.student_application_direction(text)', '3e96df52a3e6762e80d62e6e8237419e')
  ) AS t(signature, source_md5) LOOP
    SELECT md5(p.prosrc) INTO actual FROM pg_catalog.pg_proc AS p WHERE p.oid = to_regprocedure(pinned.signature);
    IF actual IS DISTINCT FROM pinned.source_md5 THEN
      RAISE EXCEPTION 'a368_drift: % has % (expected %)', pinned.signature, actual, pinned.source_md5 USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$a368_guard$;

-- ---------------------------------------------------------------------------
-- A. Проверка целостности журнала продаж: тело 111/119, как оно стоит в staff_sales_lead_page, но без страницы.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.staff_requests_ledger_guard_v1(p_organization_id UUID, p_lead_ids UUID[])
RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $a368_guard_fn$
DECLARE
  inconsistent_request_id UUID;
BEGIN
  -- p_lead_ids: лиды, которые звонящий читает (множество lead.read); открытые из них проверяются, как в странице.
  WITH actor_visible_leads AS MATERIALIZED (
    SELECT u.id FROM unnest(p_lead_ids) AS u(id)
  ),
  visible_lead_scope AS MATERIALIZED (
    SELECT lead.organization_id, lead.id AS lead_id
    FROM platform.leads AS lead
    WHERE lead.organization_id = p_organization_id
      AND lead.lifecycle_state = 'open'
      AND lead.id IN (SELECT visible_lead.id FROM actor_visible_leads AS visible_lead)
  ),
  receipt_mismatches AS (
    SELECT receipt.request_id
    FROM visible_lead_scope AS scope
    JOIN platform_private.sales_lead_workflow_receipts AS receipt
      ON receipt.organization_id = scope.organization_id
     AND receipt.lead_id = scope.lead_id
    LEFT JOIN platform.audit_events AS audit_event
      ON audit_event.request_id = receipt.request_id
    LEFT JOIN platform.profiles AS actor_profile
      ON actor_profile.id = receipt.actor_profile_id
    LEFT JOIN platform.organization_memberships AS actor_membership
      ON actor_membership.organization_id = receipt.organization_id
     AND actor_membership.id = receipt.actor_membership_id
     AND actor_membership.profile_id = receipt.actor_profile_id
    WHERE audit_event.id IS NULL
      OR actor_profile.id IS NULL
      OR actor_membership.id IS NULL
      OR audit_event.organization_id IS DISTINCT FROM
        receipt.organization_id
      OR audit_event.request_id IS DISTINCT FROM receipt.request_id
      OR audit_event.resource_type IS DISTINCT FROM 'lead'
      OR audit_event.resource_id IS DISTINCT FROM receipt.lead_id
      OR audit_event.actor_kind IS DISTINCT FROM 'user'
      OR audit_event.actor_profile_id IS DISTINCT FROM
        receipt.actor_profile_id
      OR audit_event.actor_membership_id IS DISTINCT FROM
        receipt.actor_membership_id
      OR audit_event.actor_principal IS DISTINCT FROM
        'auth:' || actor_profile.auth_user_id::TEXT
      OR audit_event.action IS DISTINCT FROM
        'lead.sales.workflow.changed'
      OR audit_event.created_at IS DISTINCT FROM receipt.created_at
      OR audit_event.resulting_version IS DISTINCT FROM
        receipt.resulting_workflow_version
      OR receipt.resulting_workflow_version IS DISTINCT FROM
        receipt.expected_workflow_version + 1
      OR audit_event.reason IS DISTINCT FROM COALESCE(
        receipt.requested_reason,
        'sales_workflow_update'
      )
      OR audit_event.before_state IS NULL
      OR audit_event.before_state ->> 'stage_key' IS NULL
      OR NOT (
        audit_event.before_state @> pg_catalog.jsonb_build_object(
          'workflow_version', receipt.expected_workflow_version
        )
      )
      OR NOT (
        audit_event.after_state @> pg_catalog.jsonb_build_object(
          'stage_key', receipt.desired_stage_key,
          'current_owner_membership_id',
            receipt.desired_owner_membership_id,
          'next_action_text', receipt.desired_next_action_text,
          'next_action_due_date', receipt.desired_next_action_due_date,
          'workflow_version', receipt.resulting_workflow_version
        )
      )
      OR NOT (
        receipt.result @> pg_catalog.jsonb_build_object(
          'request_id', receipt.request_id,
          'organization_id', receipt.organization_id,
          'lead_id', receipt.lead_id,
          'stage_key', receipt.desired_stage_key,
          'current_owner_membership_id',
            receipt.desired_owner_membership_id,
          'next_action_text', receipt.desired_next_action_text,
          'next_action_due_date', receipt.desired_next_action_due_date,
          'workflow_version', receipt.resulting_workflow_version
        )
      )
      OR CASE
        WHEN pg_catalog.jsonb_typeof(receipt.result -> 'changed_at')
          IS DISTINCT FROM 'string'
        THEN TRUE
        WHEN NOT pg_catalog.pg_input_is_valid(
          receipt.result ->> 'changed_at',
          'timestamp with time zone'
        )
        THEN TRUE
        ELSE (receipt.result ->> 'changed_at')::TIMESTAMPTZ
          IS DISTINCT FROM receipt.created_at
      END
  ),
  audit_without_receipts AS (
    SELECT audit_event.request_id
    FROM visible_lead_scope AS scope
    JOIN platform.audit_events AS audit_event
      ON audit_event.organization_id = scope.organization_id
     AND audit_event.resource_type = 'lead'
     AND audit_event.resource_id = scope.lead_id
     AND audit_event.action = 'lead.sales.workflow.changed'
    LEFT JOIN platform_private.sales_lead_workflow_receipts AS receipt
      ON receipt.request_id = audit_event.request_id
    WHERE receipt.request_id IS NULL
      OR receipt.organization_id IS DISTINCT FROM
        audit_event.organization_id
      OR receipt.lead_id IS DISTINCT FROM audit_event.resource_id
  ),
  normalization_events AS (
    SELECT
      scope.organization_id,
      scope.lead_id,
      (
        audit_event.actor_kind = 'system'
        AND audit_event.actor_profile_id IS NULL
        AND audit_event.actor_membership_id IS NULL
        AND audit_event.actor_principal =
          'migration:086_platform_sales_workflow'
        AND audit_event.before_state IS NOT DISTINCT FROM
          pg_catalog.jsonb_build_object(
            'stage_key', 'new_inbound',
            'workflow_version', 1
          )
        AND audit_event.after_state IS NOT DISTINCT FROM
          pg_catalog.jsonb_build_object(
            'stage_key', 'new',
            'workflow_version', 2
          )
        AND audit_event.reason =
          'U4 normalizes the sole U3 legacy Sales stage'
        AND audit_event.resulting_version = 2
      ) AS is_exact
    FROM visible_lead_scope AS scope
    JOIN platform.audit_events AS audit_event
      ON audit_event.organization_id = scope.organization_id
     AND audit_event.resource_type = 'lead'
     AND audit_event.resource_id = scope.lead_id
     AND audit_event.action = 'lead.sales.stage.normalized'
  ),
  legacy_normalization_evidence AS (
    SELECT
      normalization.organization_id,
      normalization.lead_id,
      pg_catalog.count(*) AS event_count,
      pg_catalog.count(*) FILTER (
        WHERE normalization.is_exact
      ) AS exact_event_count
    FROM normalization_events AS normalization
    GROUP BY normalization.organization_id, normalization.lead_id
  ),
  current_state_mismatches AS (
    SELECT COALESCE(latest_receipt.request_id, lead.id) AS request_id
    FROM visible_lead_scope AS scope
    JOIN platform.leads AS lead
      ON lead.organization_id = scope.organization_id
     AND lead.id = scope.lead_id
    LEFT JOIN LATERAL (
      SELECT receipt.*
      FROM platform_private.sales_lead_workflow_receipts AS receipt
      WHERE receipt.organization_id = scope.organization_id
        AND receipt.lead_id = scope.lead_id
      ORDER BY
        receipt.resulting_workflow_version DESC,
        receipt.request_id DESC
      LIMIT 1
    ) AS latest_receipt ON TRUE
    LEFT JOIN legacy_normalization_evidence AS normalization
      ON normalization.organization_id = scope.organization_id
     AND normalization.lead_id = scope.lead_id
    WHERE (
        latest_receipt.request_id IS NULL
        AND NOT (
          (
            lead.workflow_version = 1
            AND lead.next_action_text IS NULL
            AND lead.next_action_due_date IS NULL
            AND normalization.lead_id IS NULL
          )
          OR (
            lead.workflow_version = 2
            AND lead.stage_key = 'new'
            AND lead.next_action_text IS NULL
            AND lead.next_action_due_date IS NULL
            AND COALESCE(normalization.event_count, 0) = 1
            AND COALESCE(normalization.exact_event_count, 0) = 1
          )
        )
      )
      OR (
        latest_receipt.request_id IS NOT NULL
        AND (
          latest_receipt.resulting_workflow_version IS DISTINCT FROM
            lead.workflow_version
          OR latest_receipt.desired_stage_key IS DISTINCT FROM lead.stage_key
          OR latest_receipt.desired_owner_membership_id IS DISTINCT FROM
            lead.current_owner_membership_id
          OR latest_receipt.desired_next_action_text IS DISTINCT FROM
            lead.next_action_text
          OR latest_receipt.desired_next_action_due_date IS DISTINCT FROM
            lead.next_action_due_date
        )
      )
  ),
  inconsistencies AS (
    SELECT mismatch.request_id
    FROM receipt_mismatches AS mismatch
    UNION ALL
    SELECT missing.request_id
    FROM audit_without_receipts AS missing
    UNION ALL
    SELECT current_state.request_id
    FROM current_state_mismatches AS current_state
  )
  SELECT inconsistency.request_id
  INTO inconsistent_request_id
  FROM inconsistencies AS inconsistency
  ORDER BY inconsistency.request_id
  LIMIT 1;

  IF inconsistent_request_id IS NOT NULL THEN
    RAISE EXCEPTION 'sales_stage_entry_evidence_inconsistent'
      USING ERRCODE = '23514';
  END IF;
END
$a368_guard_fn$;

-- ---------------------------------------------------------------------------
-- B. Очередь «Заявок» v3: видимые лиды один раз, право на анкеты по направлению, проверка журнала без страницы.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION platform.staff_requests_queue_v3(p_organization_id uuid, p_source text DEFAULT 'all'::text, p_status text DEFAULT 'waiting'::text, p_limit integer DEFAULT 50, p_cursor jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $a368_queue$
DECLARE
  actor RECORD;
  lead_state TEXT := 'forbidden';
  telephony_ui BOOLEAN := FALSE;
  application_state TEXT := 'forbidden';
  consultation_state TEXT := 'forbidden';
  application_org UUID;
  cursor_at TIMESTAMPTZ;
  cursor_kind TEXT;
  cursor_id UUID;
  backwards BOOLEAN := FALSE;
  result JSONB;
  visible_leads UUID[] := ARRAY[]::UUID[];
BEGIN
  SELECT * INTO actor FROM platform.current_actor_authority();
  IF actor.membership_id IS NULL OR actor.platform_role IS NOT DISTINCT FROM 'student'
    OR p_organization_id IS DISTINCT FROM actor.organization_id THEN
    RAISE EXCEPTION 'requests_queue_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_source IS NULL OR p_source NOT IN ('all','website','whatsapp','phone_call','platform_application','portal_consultation')
    OR p_status IS NULL OR p_status NOT IN ('waiting','all')
    OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'requests_queue_invalid_filter' USING ERRCODE = '22023';
  END IF;
  IF p_cursor IS NOT NULL THEN
    IF jsonb_typeof(p_cursor) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'requests_queue_invalid_cursor' USING ERRCODE = '22023';
    END IF;
    IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_cursor) k)
      IS DISTINCT FROM ARRAY['direction','id','kind','limit','source','status','timestamp','v']::TEXT[]
      OR p_cursor->'v' IS DISTINCT FROM '3'::JSONB
      OR p_cursor->'limit' IS DISTINCT FROM to_jsonb(p_limit)
      OR p_cursor->'source' IS DISTINCT FROM to_jsonb(p_source)
      OR p_cursor->'status' IS DISTINCT FROM to_jsonb(p_status)
      OR jsonb_typeof(p_cursor->'direction') IS DISTINCT FROM 'string'
      OR p_cursor->>'direction' NOT IN ('next','previous')
      OR jsonb_typeof(p_cursor->'kind') IS DISTINCT FROM 'string'
      OR p_cursor->>'kind' NOT IN ('lead','application','consultation')
      OR jsonb_typeof(p_cursor->'id') IS DISTINCT FROM 'string'
      OR p_cursor->>'id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR jsonb_typeof(p_cursor->'timestamp') IS DISTINCT FROM 'string'
      OR p_cursor->>'timestamp' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' THEN
      RAISE EXCEPTION 'requests_queue_invalid_cursor' USING ERRCODE = '22023';
    END IF;
    BEGIN
      cursor_at := (p_cursor->>'timestamp')::TIMESTAMPTZ;
      cursor_id := (p_cursor->>'id')::UUID;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation THEN
      RAISE EXCEPTION 'requests_queue_invalid_cursor' USING ERRCODE = '22023';
    END;
    cursor_kind := p_cursor->>'kind';
    IF p_source<>'all' AND cursor_kind<>(CASE WHEN p_source IN ('website','whatsapp','phone_call') THEN 'lead'
      WHEN p_source='platform_application' THEN 'application' ELSE 'consultation' END) THEN
      RAISE EXCEPTION 'requests_queue_invalid_cursor_kind' USING ERRCODE = '22023';
    END IF;
    backwards := p_cursor->>'direction' = 'previous';
  END IF;

  -- Every kind is evaluated whatever the tab: the tabs carry their counts.
  IF platform_private.staff_has_permission(actor.organization_id,actor.membership_id,'lead.read') THEN
    -- The complete 111 receipt/audit/current-workflow guard, as in v1. The
    -- returned limited row is discarded; 23514 is NOT caught or relabelled.
    -- 368: the ledger guard is the integrity check of that same call, run alone over the same visible leads
    -- (platform_private.staff_requests_ledger_guard_v1); the visible leads are decided once for the actor.
    visible_leads := ARRAY(SELECT v.id FROM platform_private.staff_visible_ids_v1(
      actor.organization_id,actor.membership_id,'lead.read','lead') AS v(id));
    PERFORM platform_private.staff_requests_ledger_guard_v1(actor.organization_id, visible_leads);
    lead_state := 'ready';
    -- Телефония T9: лиды `phone_call` и вкладка «Звонки» входят в чтение, только когда телефония включена
    -- для сотрудников (`ui_enabled`; нет строки настроек = выключено). Слияние кода ничего не открывает.
    telephony_ui := COALESCE((SELECT s.ui_enabled FROM platform_private.telephony_settings s
      WHERE s.organization_id=actor.organization_id), FALSE);
  END IF;
  BEGIN
    application_org := platform_private.student_application_staff_org();
    IF application_org IS DISTINCT FROM actor.organization_id THEN
      RAISE EXCEPTION 'requests_queue_authority_mismatch' USING ERRCODE = '23514';
    END IF;
    application_state := 'ready';
  EXCEPTION WHEN insufficient_privilege THEN
    application_state := 'forbidden';
  END;
  consultation_state := CASE WHEN private.platform_has_permission(actor.organization_id,'lead.read')
    THEN 'ready' ELSE 'forbidden' END;

  -- One STABLE statement snapshot; scope/source/status precede page selection.
  WITH lead_scope AS MATERIALIZED (
    SELECT l.id, l.created_at, l.source_key::TEXT AS source, l.current_owner_membership_id
    FROM platform.leads l
    WHERE lead_state='ready' AND l.organization_id=actor.organization_id
      AND l.lifecycle_state='open'
      AND (l.source_key IN ('website','whatsapp') OR (telephony_ui AND l.source_key='phone_call'))
      AND l.id IN (SELECT visible.id FROM unnest(visible_leads) AS visible(id))
  ), handed AS MATERIALIZED (
    SELECT h.lead_id FROM platform_private.sales_lead_handoffs(actor.organization_id,
      ARRAY(SELECT s.id FROM lead_scope s)) h
  ), application_directions AS MATERIALIZED (
    -- 368: the review right is decided once per direction in use, not once per application.
    SELECT d.direction, platform_private.student_application_can_manage(actor.organization_id,d.direction) AS manageable
    FROM (SELECT DISTINCT platform_private.student_application_direction(c.country) AS direction
      FROM platform_private.student_applications a
      CROSS JOIN LATERAL jsonb_array_elements_text(a.questionnaire->'destinationCountries') AS c(country)
      WHERE application_state='ready' AND a.organization_id=actor.organization_id) d
  ), scoped AS MATERIALIZED (
    SELECT s.created_at AS sort_at, 'lead'::TEXT COLLATE "C" AS kind, s.id, s.source,
      (s.current_owner_membership_id IS NULL AND NOT EXISTS(SELECT 1 FROM handed h WHERE h.lead_id=s.id)) AS waiting
    FROM lead_scope s
    UNION ALL
    SELECT a.submitted_at, 'application', a.id, 'platform_application', a.status='pending'
    FROM platform_private.student_applications a
    WHERE application_state='ready' AND a.organization_id=actor.organization_id
      AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(a.questionnaire->'destinationCountries') AS c(country)
        JOIN application_directions ad ON ad.manageable
          AND ad.direction IS NOT DISTINCT FROM platform_private.student_application_direction(c.country))
    UNION ALL
    SELECT r.created_at, 'consultation', r.id, 'portal_consultation', r.status='requested'
    FROM platform_private.portal_consultation_requests r
    JOIN platform.organization_memberships m ON m.organization_id=r.organization_id AND m.id=r.membership_id
    JOIN platform.profiles p ON p.id=m.profile_id
    WHERE consultation_state='ready' AND r.organization_id=actor.organization_id
  ), filtered AS MATERIALIZED (
    SELECT * FROM scoped s
    WHERE (p_source='all' OR s.source=p_source) AND (p_status='all' OR s.waiting)
  ), page AS MATERIALIZED (
    SELECT * FROM filtered f
    WHERE cursor_at IS NULL
      OR (NOT backwards AND (f.sort_at,f.kind,f.id)<(cursor_at,cursor_kind COLLATE "C",cursor_id))
      OR (backwards AND (f.sort_at,f.kind,f.id)>(cursor_at,cursor_kind COLLATE "C",cursor_id))
    ORDER BY CASE WHEN backwards THEN f.sort_at END ASC,
      CASE WHEN backwards THEN f.kind END ASC, CASE WHEN backwards THEN f.id END ASC,
      f.sort_at DESC,f.kind DESC,f.id DESC LIMIT p_limit
  ), rendered AS (
    SELECT q.sort_at,q.kind,q.id,jsonb_build_object('kind',q.kind,'id',q.id,'source',l.source_key,
      'occurredAt',to_char(q.sort_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'personName',COALESCE(c.display_name,c.email,c.phone,'Без имени'),
      'email',c.email,'phone',c.phone,'leadId',l.id,
      'owner',CASE WHEN l.current_owner_membership_id IS NULL THEN NULL
        ELSE jsonb_build_object('membershipId',l.current_owner_membership_id,'name',op.display_name) END,
      'handedOff',EXISTS(SELECT 1 FROM handed h WHERE h.lead_id=l.id),
      -- Exactly the owner checks of platform.mutate_sales_lead_workflow (156).
      'take',CASE WHEN q.waiting
        AND platform_private.staff_can_access(l.organization_id,actor.membership_id,'lead.sales.workflow.manage','lead',l.id)
        AND platform_private.staff_can_access(l.organization_id,actor.membership_id,'lead.sales.owner.assign','lead',l.id)
        AND platform_private.staff_can_receive_assignment(l.organization_id,actor.membership_id,'lead.read','lead',l.id)
        AND platform_private.staff_can_receive_assignment(l.organization_id,actor.membership_id,'lead.sales.workflow.manage','lead',l.id)
        THEN jsonb_build_object('workflowVersion',l.workflow_version::TEXT,'stageKey',l.stage_key,
          'nextActionText',l.next_action_text,'nextActionDueDate',to_char(l.next_action_due_date,'YYYY-MM-DD'))
        END) AS payload
    FROM page q JOIN platform.leads l ON q.kind='lead' AND l.id=q.id AND l.organization_id=actor.organization_id
    LEFT JOIN platform.clients c ON c.organization_id=l.organization_id AND c.id=l.client_id
    LEFT JOIN platform.organization_memberships om ON om.organization_id=l.organization_id AND om.id=l.current_owner_membership_id
    LEFT JOIN platform.profiles op ON op.id=om.profile_id
    UNION ALL
    SELECT q.sort_at,q.kind,q.id,jsonb_build_object('kind',q.kind,'id',q.id,'source','platform_application',
      'occurredAt',to_char(q.sort_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'personName',concat(a.questionnaire->>'firstName',' ',a.questionnaire->>'lastName'),
      'email',a.normalized_email,'leadId',a.canonical_lead_id,
      'application',platform_private.student_application_json(a.id))
    FROM page q JOIN platform_private.student_applications a ON q.kind='application' AND a.id=q.id AND a.organization_id=actor.organization_id
    UNION ALL
    SELECT q.sort_at,q.kind,q.id,jsonb_build_object('kind',q.kind,'id',q.id,'source','portal_consultation',
      'occurredAt',to_char(q.sort_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'personName',p.display_name,
      'consultation',jsonb_build_object('id',r.id,'status',r.status,'studentName',p.display_name,
        'institutionId',r.institution_id,
        'institutionName',CASE WHEN r.institution_id IS NULL THEN NULL ELSE
          platform_private.portal_consultation_institution_name(r.organization_id,r.institution_id) END,
        'note',r.note,'requestedAt',r.created_at,'handledAt',r.handled_at,'handledByName',hp.display_name))
    FROM page q JOIN platform_private.portal_consultation_requests r ON q.kind='consultation' AND r.id=q.id AND r.organization_id=actor.organization_id
    JOIN platform.organization_memberships m ON m.organization_id=r.organization_id AND m.id=r.membership_id
    JOIN platform.profiles p ON p.id=m.profile_id
    LEFT JOIN platform.organization_memberships hm ON hm.organization_id=r.organization_id AND hm.id=r.handled_by_membership_id
    LEFT JOIN platform.profiles hp ON hp.id=hm.profile_id
  ), bounds AS (
    SELECT 'previous'::TEXT AS direction, first_row.sort_at, first_row.kind, first_row.id
      FROM (SELECT sort_at,kind,id FROM page ORDER BY sort_at DESC,kind DESC,id DESC LIMIT 1) first_row
    UNION ALL
    SELECT 'next', last_row.sort_at,last_row.kind,last_row.id
      FROM (SELECT sort_at,kind,id FROM page ORDER BY sort_at,kind,id LIMIT 1) last_row
    UNION ALL
    -- A status/access change may empty a bookmarked page. Retain a route back
    -- to remaining rows without promising a snapshot across separate reads.
    SELECT CASE WHEN backwards THEN 'next' ELSE 'previous' END,cursor_at,cursor_kind,cursor_id
      WHERE cursor_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM page)
  ), cursors AS (
    SELECT b.direction,jsonb_build_object('v',3,'direction',b.direction,
      'source',p_source,'status',p_status,
      'limit',p_limit,'timestamp',to_char(b.sort_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'kind',b.kind,'id',b.id) AS value
    FROM bounds b WHERE EXISTS(SELECT 1 FROM filtered f WHERE
      (b.direction='next' AND (f.sort_at,f.kind,f.id)<(b.sort_at,b.kind COLLATE "C",b.id)) OR
      (b.direction='previous' AND (f.sort_at,f.kind,f.id)>(b.sort_at,b.kind COLLATE "C",b.id)))
  )
  SELECT jsonb_build_object('version',3,'organizationId',actor.organization_id,
    'phoneCalls',telephony_ui,'source',p_source,'status',p_status,'limit',p_limit,
    'states',jsonb_build_object('lead',lead_state,'application',application_state,'consultation',consultation_state),
    'counts',jsonb_build_object(
      'website',CASE WHEN lead_state='ready' THEN (SELECT count(*) FROM scoped s
        WHERE s.source='website' AND (p_status='all' OR s.waiting)) END,
      'whatsapp',CASE WHEN lead_state='ready' THEN (SELECT count(*) FROM scoped s
        WHERE s.source='whatsapp' AND (p_status='all' OR s.waiting)) END,
      'phone_call',CASE WHEN telephony_ui THEN (SELECT count(*) FROM scoped s
        WHERE s.source='phone_call' AND (p_status='all' OR s.waiting)) END,
      'application',CASE WHEN application_state='ready' THEN (SELECT count(*) FROM scoped s
        WHERE s.kind='application' AND (p_status='all' OR s.waiting)) END,
      'consultation',CASE WHEN consultation_state='ready' THEN (SELECT count(*) FROM scoped s
        WHERE s.kind='consultation' AND (p_status='all' OR s.waiting)) END),
    'latestAt',(SELECT to_char(max(s.sort_at) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      FROM scoped s WHERE p_source='all' OR s.source=p_source),
    'rows',COALESCE((SELECT jsonb_agg(payload ORDER BY sort_at DESC,kind DESC,id DESC) FROM rendered),'[]'::JSONB),
    'nextCursor',(SELECT value FROM cursors WHERE direction='next'),
    'previousCursor',(SELECT value FROM cursors WHERE direction='previous')) INTO result;
  RETURN result;
END
$a368_queue$;


-- ---------------------------------------------------------------------------
-- C. Строки звонков по нескольким лидам одним ответом (исход последнего звонка в «Заявки → Звонки»).
-- Ответ: объект «id лида → то, что отдаёт telephony_lead_calls_v1 этому лиду»; лида, которого звонящий не читает, в нём нет.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.telephony_lead_calls_batch_v1(
  p_organization_id UUID,
  p_lead_ids UUID[],
  p_limit_per_lead INTEGER DEFAULT 1
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $a368_batch$
DECLARE
  v_actor RECORD;
  v_settings platform_private.telephony_settings;
  v_result_on BOOLEAN;
  v_all BOOLEAN;
  v_now TIMESTAMPTZ := statement_timestamp();
  v_visible UUID[];
  v_result JSONB;
BEGIN
  -- Параметры: как у одиночной (организация, лимит 1..100), плюс число лидов не больше 50 и ни одного пустого.
  IF p_organization_id IS NULL OR p_lead_ids IS NULL OR p_limit_per_lead IS NULL OR p_limit_per_lead NOT BETWEEN 1 AND 100
     OR cardinality(p_lead_ids) > 50 OR array_position(p_lead_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'telephony_calls_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT a.membership_id INTO v_actor FROM platform.current_actor_authority() a
   WHERE a.organization_id = p_organization_id AND a.platform_role IS DISTINCT FROM 'student' LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'telephony_calls_forbidden' USING ERRCODE = '42501';
  END IF;
  -- Видимость строки звонка следует lead.read по лиду (план §11): множество 310 по заданным лидам, один раз.
  -- Лид, которого нет в организации, и лид, которого звонящий не читает, одинаково отсутствуют в ответе.
  v_visible := ARRAY(SELECT v.id FROM platform_private.staff_visible_ids_v1(
    p_organization_id, v_actor.membership_id, 'lead.read', 'lead', p_lead_ids) AS v(id));
  IF cardinality(v_visible) = 0 THEN
    RETURN '{}'::JSONB;
  END IF;

  SELECT * INTO v_settings FROM platform_private.telephony_settings s WHERE s.organization_id = p_organization_id;
  -- Нет строки настроек или выключен ui_enabled: телефонии в интерфейсе нет (§9.1); каждый видимый лид получает тот же ответ.
  IF NOT FOUND OR NOT v_settings.ui_enabled THEN
    RETURN (SELECT COALESCE(jsonb_object_agg(l.id::TEXT,
      jsonb_build_object('enabled', FALSE, 'canSetResult', FALSE, 'hasMore', FALSE, 'calls', '[]'::JSONB)), '{}'::JSONB)
      FROM platform.leads l WHERE l.organization_id = p_organization_id AND l.id = ANY (v_visible));
  END IF;

  v_result_on := v_settings.dial_enabled
    AND platform_private.staff_can_access(p_organization_id, v_actor.membership_id, 'telephony.call.dial',
      'organization', p_organization_id);
  v_all := platform_private.staff_can_access(p_organization_id, v_actor.membership_id, 'telephony.manage',
    'organization', p_organization_id);

  -- Звонки лида и звонки его клиента (и склеенных в него), у которых лида на момент звонка не было, по каждому лиду:
  -- выражение строки и отбор дословно те же, что у telephony_lead_calls_v1; на лид берётся лимит + 1 строка.
  SELECT COALESCE(jsonb_object_agg(per.lead_id::TEXT, jsonb_build_object(
    'enabled', TRUE,
    'canSetResult', v_result_on,
    'hasMore', per.n > p_limit_per_lead,
    'calls', per.calls)), '{}'::JSONB) INTO v_result
  FROM (
    SELECT lead.id AS lead_id,
      count(r.id) AS n,
      COALESCE(jsonb_agg(r.obj ORDER BY r.started_at DESC, r.id DESC) FILTER (WHERE r.rn <= p_limit_per_lead), '[]'::JSONB) AS calls
    FROM platform.leads lead
    LEFT JOIN LATERAL (
      SELECT x.id, x.started_at, x.obj, row_number() OVER (ORDER BY x.started_at DESC, x.id DESC) AS rn
      FROM (
        SELECT c.id, c.started_at, jsonb_build_object(
          'callId', c.id,
          'direction', c.direction,
          'state', c.state,
          'outcome', c.outcome,
          'outcomeSource', c.outcome_source,
          'startedAt', c.started_at,
          'answeredAt', c.answered_at,
          'endedAt', c.ended_at,
          'talkSeconds', c.talk_seconds,
          'phone', CASE WHEN c.client_phone IS NULL THEN NULL
            ELSE platform_private.whatsapp_masked_phone(ltrim(c.client_phone, '+')) END,
          'managerName', mp.display_name,
          'participants', COALESCE(parts.items, '[]'::JSONB),
          'recording', c.recording_state,
          'resultCode', c.result_code,
          'resultAt', c.result_at,
          'resultByName', rp.display_name,
          'callbackOn', c.result_callback_on,
          'resultEditable', COALESCE(
            v_result_on
            AND platform_private.telephony_result_window_open(c.outcome, c.created_via, c.started_at, c.result_code,
              c.result_at, v_now)
            AND (v_all OR platform_private.telephony_call_taken_by(c.organization_id, c.id, v_actor.membership_id)),
            FALSE)
        ) AS obj
        FROM platform_private.telephony_calls c
        LEFT JOIN platform.organization_memberships mm
          ON mm.organization_id = c.organization_id AND mm.id = c.membership_id
        LEFT JOIN platform.profiles mp ON mp.id = mm.profile_id
        LEFT JOIN platform.organization_memberships rm
          ON rm.organization_id = c.organization_id AND rm.id = c.result_by
        LEFT JOIN platform.profiles rp ON rp.id = rm.profile_id
        LEFT JOIN LATERAL (
          SELECT jsonb_agg(jsonb_build_object('name', leg.display_name, 'state', leg.state)
            ORDER BY leg.leg_started_at, leg.display_name, leg.id) AS items
          FROM (
            SELECT l.id, l.leg_started_at, l.state, lp.display_name
            FROM platform_private.telephony_call_legs l
            JOIN platform.organization_memberships lm
              ON lm.organization_id = l.organization_id AND lm.id = l.membership_id
            JOIN platform.profiles lp ON lp.id = lm.profile_id
            WHERE l.organization_id = c.organization_id AND l.call_id = c.id AND l.membership_id IS NOT NULL
            ORDER BY l.leg_started_at, lp.display_name, l.id
            LIMIT 6
          ) leg
        ) parts ON TRUE
        WHERE c.organization_id = p_organization_id
          AND (c.lead_id = lead.id OR (c.lead_id IS NULL
            AND c.client_id = ANY (platform_private.client_merged_ids(p_organization_id, lead.client_id))))
        ORDER BY c.started_at DESC, c.id DESC
        LIMIT p_limit_per_lead + 1
      ) x
    ) r ON TRUE
    WHERE lead.organization_id = p_organization_id AND lead.id = ANY (v_visible)
    GROUP BY lead.id
  ) per;

  RETURN v_result;
END
$a368_batch$;

REVOKE ALL ON FUNCTION
  platform_private.staff_requests_ledger_guard_v1(UUID, UUID[]),
  platform.telephony_lead_calls_batch_v1(UUID, UUID[], INTEGER)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
GRANT EXECUTE ON FUNCTION platform.telephony_lead_calls_batch_v1(UUID, UUID[], INTEGER) TO authenticated;

COMMENT ON FUNCTION platform_private.staff_requests_ledger_guard_v1(UUID, UUID[]) IS
  'Migration 368: the sales-ledger integrity check of private.staff_sales_lead_page (111/119) without the page, over the given visible leads; 23514 sales_stage_entry_evidence_inconsistent. Mirrors that body: change together.';
COMMENT ON FUNCTION platform.telephony_lead_calls_batch_v1(UUID, UUID[], INTEGER) IS
  'Migration 368: telephony_lead_calls_v1 for up to 50 leads in one answer (lead id to that function''s object); a lead without lead.read is absent. Mirrors telephony_lead_calls_v1: change together.';
DO $a368_comments$
DECLARE pair RECORD;
BEGIN
  FOR pair IN SELECT * FROM (VALUES
    ('private.staff_sales_lead_page(integer,timestamp with time zone,uuid,text,text,text,uuid,text,text)'::REGPROCEDURE,
     ' Its ledger integrity check is mirrored by platform_private.staff_requests_ledger_guard_v1 (368): change together.'),
    ('platform.telephony_lead_calls_v1(uuid,uuid,integer,timestamp with time zone,timestamp with time zone)'::REGPROCEDURE,
     ' Mirrored for many leads by platform.telephony_lead_calls_batch_v1 (368): change together.')
  ) AS t(proc, note) LOOP
    EXECUTE format('COMMENT ON FUNCTION %s IS %L', pair.proc,
      COALESCE(obj_description(pair.proc::OID, 'pg_proc'), '') || pair.note);
  END LOOP;
END
$a368_comments$;

-- Самопроверка: права и posture новых и заменённой функций.
DO $a368_verify$
DECLARE p pg_catalog.pg_proc%ROWTYPE; f REGPROCEDURE;
BEGIN
  FOR f IN SELECT unnest(ARRAY[
    'platform_private.staff_requests_ledger_guard_v1(uuid,uuid[])',
    'platform.telephony_lead_calls_batch_v1(uuid,uuid[],integer)',
    'platform.staff_requests_queue_v3(uuid,text,text,integer,jsonb)']::REGPROCEDURE[]) LOOP
    SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid = f;
    IF NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[] OR p.provolatile <> 's'
      OR pg_get_userbyid(p.proowner) <> 'postgres'
      OR has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('service_role', f, 'EXECUTE')
      OR has_function_privilege('supabase_auth_admin', f, 'EXECUTE') OR has_function_privilege('evo_ai_agent', f, 'EXECUTE')
      OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
      OR has_function_privilege('authenticated', f, 'EXECUTE') IS DISTINCT FROM (f::TEXT LIKE 'platform.%') THEN
      RAISE EXCEPTION 'a368_function_posture: %', f USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$a368_verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
