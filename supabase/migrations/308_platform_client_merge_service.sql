-- Склейка подтверждённых дублей клиентов и закрытие лида «уже студент» служебными функциями
-- (слова владельца 18.10.2026: «Склей подтверждённые пары сам через служебную функцию с dry-run»).
-- docs/PLAN_CHANGES.md «2026-10-18 · Склейка дублей клиентов и закрытие лида «уже студент»
-- служебными функциями (миграция 308, запись до кода)». Номер 308 - следующий за 307 на origin/main
-- 85ab6c83e; сверяется ещё раз перед слиянием.
--
-- Forward-only. Приложение не меняется. Все выпущенные функции остаются прежними по сигнатуре, правам и
-- ответу; единственная правка выпущенного объекта - platform.resolve_client_duplicate (084/156): её
-- внутренность вынесена в две частные функции (а ниже), публичная вызывает ровно их, порядок проверок,
-- коды, сообщения и ключи ответа прежние. SECURITY DEFINER с пустым search_path; клиентские функции только
-- в `platform`.
--
--  a) Одна реализация слияния. platform_private.client_duplicate_open_candidate (блокировка и проверка
--     кандидата: существует, открыт, пара совпадает) и platform_private.client_duplicate_apply_resolution
--     (двое живых клиентов без алиасов; запись решения; алиас; перенос лидов, дел и переписок; закрытие
--     остальных кандидатов склеенного; статус `merged`). Публичная resolve_client_duplicate вызывает их
--     после своей проверки прав по JWT; служебная merge_clients_owner_confirmed_v1 - после своей
--     служебной проверки. Второго пути слияния нет.
--  b) Что переносится (то, что делает 084, без изменений): platform.leads.client_id,
--     platform.student_cases.canonical_client_id, platform.communication_conversations.canonical_client_id;
--     строки телефонии следуют за лидом (ON UPDATE CASCADE, 288). Внешние идентификаторы
--     (platform.external_identifiers) и происхождение (platform.subject_provenance) остаются строками
--     склеенного клиента (таблицы append-only) и читаются через алиас на выжившего
--     (platform_private.resolve_canonical_client_id; create_or_link_client по внешнему идентификатору
--     склеенного возвращает выжившего). Склеенный клиент остаётся неизменяемой строкой `merged`, вне
--     поиска активных клиентов. Склейка необратима: решение и алиас append-only.
--  c) Контакты (доработка по итогам проверки пар, не часть 084). Телефон и почта склеенного не пропадают:
--     после склейки (склеенный уже не `active`, поэтому уникальный индекс активных клиентов
--     clients_active_strong_identity_key не мешает) пустое поле выжившего заполняется значением
--     склеенного (телефон в форме admissions_direct_phone, почта как есть); если у выжившего поле уже
--     есть и оно другое (телефон сравнивается по platform_private.person_phone_match_keys, почта по
--     normalized_email), выживший не трогается, значение склеенного кладётся в закрытый before_state
--     квитанции и заметкой к активному делу выжившего «Второй телефон / Вторая почта (из склеенного
--     клиента): …» (platform.case_notes и журнал `note.create` без текста, путь 287). Если заполнение
--     дало бы пару (почта, телефон), которая уже есть у другого активного клиента, поле не копируется
--     и идёт тем же путём конфликта. Две склейки подряд в одного выжившего: вторая видит уже
--     заполненное поле первой и пишет заметкой, ничего не перезаписывая.
--  d) Общая закрытая таблица квитанций platform_private.client_merge_service_receipts обеих служебных
--     функций: ключ (организация, источник, ссылка), md5 тела, актёр, ответ и before_state (что было у
--     обоих клиентов, с контактами; квитанция - закрытая таблица БД, журнал значений ПДн не получает).
--  e) platform.merge_clients_owner_confirmed_v1: только service_role без `sub`, актёр - активное
--     Admin-членство с client.duplicate.resolve. Dry-run: вызов внутри транзакции с ROLLBACK, ответ
--     перечисляет, что сдвинулось бы; сигнатура без флага (как у 281/287/304/307).
--  f) platform.close_sales_lead_already_student_v1: тот же способ закрытия, что platform.set_lead_closed_v1
--     (246: lifecycle_state = 'disqualified', событие `lead.lifecycle.change`, исход `duplicate`), но для
--     служебного пути: set_lead_closed_v1 берёт актёра из JWT (current_actor_authority) и потому не
--     вызывается без `sub`. Закрывается только открытый лид клиента, у которого есть дело студента.
BEGIN;

-- ---------------------------------------------------------------------------
-- Якоря: что читается и что заменяется - живые определения 001-307.
-- ---------------------------------------------------------------------------
DO $a308_anchor$
BEGIN
  IF (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p
      WHERE p.oid = to_regprocedure('platform.resolve_client_duplicate(uuid,uuid,uuid,text,uuid)'))
        IS DISTINCT FROM '6a8b40b3bbb26ef0a429a9e6e84157f1'
    OR to_regprocedure('platform_private.resolve_canonical_client_id(uuid,uuid)') IS NULL
    OR to_regprocedure('platform_private.staff_membership_identity(uuid,uuid)') IS NULL
    OR to_regprocedure('platform_private.staff_has_permission(uuid,uuid,text)') IS NULL
    OR to_regprocedure('platform_private.staff_can_access(uuid,uuid,text,text,uuid)') IS NULL
    OR to_regprocedure('platform_private.lock_p2d_request(uuid)') IS NULL
    OR to_regprocedure('platform_private.lock_student_case_note_assignment_domain(uuid)') IS NULL
    OR to_regprocedure('platform_private.block_append_only_mutation()') IS NULL
    OR to_regprocedure('platform_private.admissions_direct_phone(text)') IS NULL
    OR to_regprocedure('platform_private.person_phone_match_keys(text)') IS NULL
    OR to_regprocedure('platform_private.normalize_person_phone(text)') IS NULL
    OR to_regprocedure('platform_private.sales_lead_handoffs(uuid,uuid[])') IS NULL
    OR to_regprocedure('public.uuid_generate_v5(uuid,text)') IS NULL
    OR to_regclass('platform.case_notes') IS NULL
    -- 246: the lifecycle the closure uses, and the reasons its read accepts.
    OR strpos(pg_get_functiondef('platform_private.guard_lead_mutation()'::regprocedure),
      $q$NEW.lifecycle_state NOT IN ('open', 'disqualified', 'archived')$q$) = 0
    OR to_regprocedure('platform.set_lead_closed_v1(uuid,uuid,bigint,boolean,text,text,uuid)') IS NULL
    OR to_regprocedure('platform.staff_closed_leads_v1(integer,text,uuid)') IS NULL
    -- 084: the candidate basis list this migration widens.
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
      WHERE c.conrelid = 'platform_private.client_duplicate_candidates'::regclass
        AND c.conname = 'client_duplicate_candidates_match_basis_check'
        AND pg_get_constraintdef(c.oid) LIKE '%multiple_weak%')
  THEN
    RAISE EXCEPTION 'a308_anchor_drift';
  END IF;
END
$a308_anchor$;

-- ---------------------------------------------------------------------------
-- 1. The basis of a candidate the owner confirmed himself
-- ---------------------------------------------------------------------------
-- The basis is informational (name / email / phone / several weak matches found by the system). A pair
-- the owner confirmed by hand has none of them to name; `owner_confirmed` says so. No read or screen
-- returns match_basis.
ALTER TABLE platform_private.client_duplicate_candidates
  DROP CONSTRAINT client_duplicate_candidates_match_basis_check,
  ADD CONSTRAINT client_duplicate_candidates_match_basis_check
    CHECK (match_basis IN ('name', 'email', 'phone', 'multiple_weak', 'owner_confirmed'));

-- ---------------------------------------------------------------------------
-- 2. The receipts of the service calls (merge and lead closure)
-- ---------------------------------------------------------------------------
CREATE TABLE platform_private.client_merge_service_receipts (
  organization_id UUID NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  operation TEXT NOT NULL CHECK (operation IN ('merge', 'close_lead')),
  import_source TEXT NOT NULL CHECK (import_source ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  external_ref TEXT NOT NULL CHECK (char_length(external_ref) BETWEEN 1 AND 200 AND external_ref !~ '[[:cntrl:]]'),
  actor_membership_id UUID NOT NULL,
  payload_md5 TEXT NOT NULL CHECK (payload_md5 ~ '^[0-9a-f]{32}$'),
  keep_client_id UUID,
  merge_client_id UUID,
  lead_id UUID,
  -- The caller's own note of a lead closure; it never reaches the audit journal.
  note TEXT CHECK (note IS NULL OR (char_length(note) BETWEEN 1 AND 500 AND note !~ '[[:cntrl:]]')),
  result JSONB NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  -- What the call changed, as it was: both clients (with their contacts) for a merge, the lead for a closure.
  before_state JSONB NOT NULL CHECK (jsonb_typeof(before_state) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  receipt_seq BIGINT GENERATED ALWAYS AS IDENTITY,
  PRIMARY KEY (organization_id, import_source, external_ref),
  CONSTRAINT client_merge_service_receipts_shape CHECK (
    (operation = 'merge' AND keep_client_id IS NOT NULL AND merge_client_id IS NOT NULL
      AND keep_client_id <> merge_client_id AND lead_id IS NULL AND note IS NULL)
    OR (operation = 'close_lead' AND lead_id IS NOT NULL AND keep_client_id IS NULL AND merge_client_id IS NULL)),
  FOREIGN KEY (organization_id, actor_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, keep_client_id)
    REFERENCES platform.clients(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, merge_client_id)
    REFERENCES platform.clients(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, lead_id)
    REFERENCES platform.leads(organization_id, id) ON DELETE RESTRICT
);
ALTER TABLE platform_private.client_merge_service_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.client_merge_service_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE platform_private.client_merge_service_receipts
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
CREATE TRIGGER client_merge_service_receipts_append_only
  BEFORE UPDATE OR DELETE ON platform_private.client_merge_service_receipts
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER client_merge_service_receipts_no_truncate
  BEFORE TRUNCATE ON platform_private.client_merge_service_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
COMMENT ON TABLE platform_private.client_merge_service_receipts IS
  'Migration 308: one row per accepted merge_clients_owner_confirmed_v1 / close_sales_lead_already_student_v1 call (idempotency by organization, import source and external reference; payload md5, actor, the subject, the answer and the before_state). Backend only, append-only.';

-- ---------------------------------------------------------------------------
-- 3. The shared merge, taken out of platform.resolve_client_duplicate (084/156)
-- ---------------------------------------------------------------------------
-- (a) The candidate: exists, is open, is the pair. Messages and codes as 084. Locks the row.
CREATE FUNCTION platform_private.client_duplicate_open_candidate(
  p_candidate_id UUID, p_survivor_client_id UUID, p_superseded_client_id UUID
) RETURNS platform_private.client_duplicate_candidates
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  candidate platform_private.client_duplicate_candidates%ROWTYPE;
BEGIN
  SELECT duplicate_candidate.*
  INTO candidate
  FROM platform_private.client_duplicate_candidates AS duplicate_candidate
  WHERE duplicate_candidate.id = p_candidate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Duplicate candidate does not exist'
      USING ERRCODE = 'P0002';
  END IF;

  IF candidate.status <> 'open' THEN
    RAISE EXCEPTION 'Duplicate candidate is stale or already resolved'
      USING ERRCODE = '55000';
  END IF;

  IF NOT (
    (
      candidate.left_client_id = p_survivor_client_id
      AND candidate.right_client_id = p_superseded_client_id
    )
    OR (
      candidate.right_client_id = p_survivor_client_id
      AND candidate.left_client_id = p_superseded_client_id
    )
  ) THEN
    RAISE EXCEPTION 'Resolution clients do not match the candidate pair'
      USING ERRCODE = '23514';
  END IF;

  RETURN candidate;
END
$$;

-- The pair rule of 084: two clients of the candidate's organization, both `active`, neither already an alias.
CREATE FUNCTION platform_private.client_duplicate_pair_is_live(
  p_organization_id UUID, p_survivor_client_id UUID, p_superseded_client_id UUID
) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM platform.clients AS survivor
    JOIN platform.clients AS superseded
      ON superseded.organization_id = survivor.organization_id
    WHERE survivor.organization_id = p_organization_id
      AND survivor.id = p_survivor_client_id
      AND survivor.lifecycle_state = 'active'
      AND superseded.id = p_superseded_client_id
      AND superseded.lifecycle_state = 'active'
  )
    AND NOT EXISTS (
      SELECT 1
      FROM platform_private.client_aliases AS alias
      WHERE alias.organization_id = p_organization_id
        AND alias.superseded_client_id IN (
          p_survivor_client_id,
          p_superseded_client_id
        )
    )
$$;

-- (b) The merge itself: the actor is already authorized by the caller. Returns 084's answer plus `moved`
-- (the numbers of rows moved), which the public function leaves out.
CREATE FUNCTION platform_private.client_duplicate_apply_resolution(
  p_candidate_id UUID, p_survivor_client_id UUID, p_superseded_client_id UUID, p_reason TEXT, p_request_id UUID,
  p_actor_profile_id UUID, p_actor_membership_id UUID
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  candidate platform_private.client_duplicate_candidates%ROWTYPE;
  resolution_id UUID;
  resolution_timestamp TIMESTAMPTZ;
  moved_leads BIGINT;
  moved_cases BIGINT;
  moved_conversations BIGINT;
  staled_candidates BIGINT;
BEGIN
  SELECT duplicate_candidate.*
  INTO candidate
  FROM platform_private.client_duplicate_candidates AS duplicate_candidate
  WHERE duplicate_candidate.id = p_candidate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Duplicate candidate does not exist'
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT platform_private.client_duplicate_pair_is_live(
    candidate.organization_id, p_survivor_client_id, p_superseded_client_id
  ) THEN
    RAISE EXCEPTION 'Resolution requires two live unaliased clients'
      USING ERRCODE = '55000';
  END IF;

  resolution_id := gen_random_uuid();
  resolution_timestamp := statement_timestamp();

  INSERT INTO platform_private.client_duplicate_resolutions (
    id,
    organization_id,
    candidate_id,
    survivor_client_id,
    superseded_client_id,
    actor_profile_id,
    actor_membership_id,
    reason,
    request_id,
    resolved_at
  ) VALUES (
    resolution_id,
    candidate.organization_id,
    candidate.id,
    p_survivor_client_id,
    p_superseded_client_id,
    p_actor_profile_id,
    p_actor_membership_id,
    btrim(p_reason),
    p_request_id,
    resolution_timestamp
  );

  INSERT INTO platform_private.client_aliases (
    superseded_client_id,
    organization_id,
    canonical_client_id,
    resolution_id,
    created_at
  ) VALUES (
    p_superseded_client_id,
    candidate.organization_id,
    p_survivor_client_id,
    resolution_id,
    resolution_timestamp
  );

  UPDATE platform.leads AS lead
  SET client_id = p_survivor_client_id
  WHERE lead.organization_id = candidate.organization_id
    AND lead.client_id = p_superseded_client_id;
  GET DIAGNOSTICS moved_leads = ROW_COUNT;

  UPDATE platform.student_cases AS student_case
  SET canonical_client_id = p_survivor_client_id
  WHERE student_case.organization_id = candidate.organization_id
    AND student_case.canonical_client_id = p_superseded_client_id;
  GET DIAGNOSTICS moved_cases = ROW_COUNT;

  UPDATE platform.communication_conversations AS conversation
  SET canonical_client_id = p_survivor_client_id
  WHERE conversation.organization_id = candidate.organization_id
    AND conversation.canonical_client_id = p_superseded_client_id;
  GET DIAGNOSTICS moved_conversations = ROW_COUNT;

  UPDATE platform_private.client_duplicate_candidates AS stale_candidate
  SET status = 'stale', resolved_at = resolution_timestamp
  WHERE stale_candidate.organization_id = candidate.organization_id
    AND stale_candidate.status = 'open'
    AND stale_candidate.id <> candidate.id
    AND (
      stale_candidate.left_client_id = p_superseded_client_id
      OR stale_candidate.right_client_id = p_superseded_client_id
    );
  GET DIAGNOSTICS staled_candidates = ROW_COUNT;

  UPDATE platform_private.client_duplicate_candidates AS resolved_candidate
  SET status = 'resolved', resolved_at = resolution_timestamp
  WHERE resolved_candidate.id = candidate.id;

  UPDATE platform.clients AS superseded
  SET lifecycle_state = 'merged'
  WHERE superseded.organization_id = candidate.organization_id
    AND superseded.id = p_superseded_client_id;

  UPDATE platform.clients AS survivor
  SET display_name = survivor.display_name
  WHERE survivor.organization_id = candidate.organization_id
    AND survivor.id = p_survivor_client_id;

  RETURN jsonb_build_object(
    'resolution_id', resolution_id,
    'candidate_id', candidate.id,
    'organization_id', candidate.organization_id,
    'survivor_client_id', p_survivor_client_id,
    'superseded_client_id', p_superseded_client_id,
    'resolved_at', resolution_timestamp,
    'request_id', p_request_id,
    'moved', jsonb_build_object(
      'leads', moved_leads,
      'student_cases', moved_cases,
      'conversations', moved_conversations,
      'candidates_staled', staled_candidates)
  );
END
$$;

REVOKE ALL ON FUNCTION platform_private.client_duplicate_open_candidate(UUID, UUID, UUID),
  platform_private.client_duplicate_pair_is_live(UUID, UUID, UUID),
  platform_private.client_duplicate_apply_resolution(UUID, UUID, UUID, TEXT, UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- The public function: 084/156 as before - the same checks in the same order with the same messages and
-- the same answer - its middle and its end now call the shared (a) and (b).
CREATE OR REPLACE FUNCTION platform.resolve_client_duplicate(
  p_candidate_id UUID,
  p_survivor_client_id UUID,
  p_superseded_client_id UUID,
  p_reason TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  candidate platform_private.client_duplicate_candidates%ROWTYPE;
  existing_resolution platform_private.client_duplicate_resolutions%ROWTYPE;
  actor RECORD;
BEGIN
  IF p_candidate_id IS NULL
    OR p_survivor_client_id IS NULL
    OR p_superseded_client_id IS NULL
    OR p_request_id IS NULL
    OR p_survivor_client_id = p_superseded_client_id
    OR p_reason IS NULL
    OR btrim(p_reason) = ''
    OR length(p_reason) > 2000
  THEN
    RAISE EXCEPTION 'Malformed client duplicate resolution'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'u2:client-duplicate-resolution:' || p_request_id::TEXT,
      0
    )
  );

  SELECT resolution.*
  INTO existing_resolution
  FROM platform_private.client_duplicate_resolutions AS resolution
  WHERE resolution.request_id = p_request_id;

  IF FOUND THEN
    SELECT authority.*
    INTO actor
    FROM platform.current_actor_authority() AS authority
    WHERE authority.organization_id = existing_resolution.organization_id
      AND platform_private.staff_can_access(authority.organization_id,authority.membership_id,
      'client.duplicate.resolve','client',platform_private.resolve_canonical_client_id(authority.organization_id,p_survivor_client_id))
      AND platform_private.staff_can_access(authority.organization_id,authority.membership_id,
      'client.duplicate.resolve','client',platform_private.resolve_canonical_client_id(authority.organization_id,p_superseded_client_id))
      AND private.platform_has_permission(
        existing_resolution.organization_id,
        'client.duplicate.resolve'
      );

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'Active Admin duplicate-resolution authority is required'
        USING ERRCODE = '42501';
    END IF;

    IF existing_resolution.candidate_id <> p_candidate_id
      OR existing_resolution.survivor_client_id <> p_survivor_client_id
      OR existing_resolution.superseded_client_id <>
        p_superseded_client_id
      OR existing_resolution.reason <> btrim(p_reason)
    THEN
      RAISE EXCEPTION 'Duplicate resolution request UUID conflicts'
        USING ERRCODE = '23505';
    END IF;

    RETURN jsonb_build_object(
      'resolution_id', existing_resolution.id,
      'candidate_id', existing_resolution.candidate_id,
      'organization_id', existing_resolution.organization_id,
      'survivor_client_id', existing_resolution.survivor_client_id,
      'superseded_client_id', existing_resolution.superseded_client_id,
      'resolved_at', existing_resolution.resolved_at,
      'request_id', existing_resolution.request_id
    );
  END IF;

  candidate := platform_private.client_duplicate_open_candidate(
    p_candidate_id, p_survivor_client_id, p_superseded_client_id
  );

  SELECT authority.*
  INTO actor
  FROM platform.current_actor_authority() AS authority
  WHERE authority.organization_id = candidate.organization_id
    AND platform_private.staff_can_access(authority.organization_id,authority.membership_id,
      'client.duplicate.resolve','client',platform_private.resolve_canonical_client_id(authority.organization_id,p_survivor_client_id))
      AND platform_private.staff_can_access(authority.organization_id,authority.membership_id,
      'client.duplicate.resolve','client',platform_private.resolve_canonical_client_id(authority.organization_id,p_superseded_client_id))
    AND private.platform_has_permission(
      candidate.organization_id,
      'client.duplicate.resolve'
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active Admin duplicate-resolution authority is required'
      USING ERRCODE = '42501';
  END IF;

  RETURN platform_private.client_duplicate_apply_resolution(
    candidate.id, p_survivor_client_id, p_superseded_client_id, p_reason, p_request_id,
    actor.profile_id, actor.membership_id
  ) - 'moved';
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Helpers of the service calls
-- ---------------------------------------------------------------------------
-- The shared gate: no end-user identity, an active Admin membership holding every named permission
-- (an Admin holds every non-sensitive key; the actor is the owner's Admin), as 307's.
CREATE FUNCTION platform_private.client_merge_service_actor(
  p_organization_id UUID, p_actor_membership_id UUID, p_permissions TEXT[]
) RETURNS TABLE(profile_id UUID, membership_id UUID)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_organization_id IS NULL OR p_actor_membership_id IS NULL THEN
    RAISE EXCEPTION 'client_merge_forbidden' USING ERRCODE = '42501';
  END IF;
  -- Service path only: no end-user identity may reach it (the grants already exclude anon and authenticated).
  IF NULLIF(current_setting('request.jwt.claims', TRUE), '')::JSONB ->> 'sub' IS NOT NULL
    OR COALESCE(NULLIF(current_setting('request.jwt.claims', TRUE), '')::JSONB ->> 'role', '') IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'client_merge_forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT i.profile_id, i.membership_id
    FROM platform_private.staff_membership_identity(p_organization_id, p_actor_membership_id) i
    WHERE i.system_role = 'admin'
      AND NOT EXISTS (SELECT 1 FROM unnest(p_permissions) k
        WHERE NOT platform_private.staff_has_permission(p_organization_id, i.membership_id, k));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'client_merge_forbidden' USING ERRCODE = '42501';
  END IF;
END
$$;

-- What a client was before a merge: ids and counts, and the contacts (the receipt is a closed table).
CREATE FUNCTION platform_private.client_merge_snapshot(p_organization_id UUID, p_client_id UUID)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'client_id', c.id,
    'lifecycle_state', c.lifecycle_state::TEXT,
    'phone', c.phone,
    'normalized_phone', c.normalized_phone,
    'email', c.email,
    'normalized_email', c.normalized_email,
    'lead_ids', COALESCE((SELECT jsonb_agg(l.id ORDER BY l.created_at, l.id) FROM platform.leads l
      WHERE l.organization_id = c.organization_id AND l.client_id = c.id), '[]'::JSONB),
    'student_case_ids', COALESCE((SELECT jsonb_agg(sc.id ORDER BY sc.created_at, sc.id) FROM platform.student_cases sc
      WHERE sc.organization_id = c.organization_id AND sc.canonical_client_id = c.id), '[]'::JSONB),
    'conversation_ids', COALESCE((SELECT jsonb_agg(cv.id ORDER BY cv.created_at, cv.id) FROM platform.communication_conversations cv
      WHERE cv.organization_id = c.organization_id AND cv.canonical_client_id = c.id), '[]'::JSONB),
    'external_identifier_count', (SELECT count(*) FROM platform.external_identifiers e
      WHERE e.organization_id = c.organization_id AND e.client_id = c.id),
    'provenance_count', (SELECT count(*) FROM platform.subject_provenance s
      WHERE s.organization_id = c.organization_id AND s.client_id = c.id),
    'open_candidate_ids', COALESCE((SELECT jsonb_agg(d.id ORDER BY d.id) FROM platform_private.client_duplicate_candidates d
      WHERE d.organization_id = c.organization_id AND d.status = 'open'
        AND c.id IN (d.left_client_id, d.right_client_id)), '[]'::JSONB))
  FROM platform.clients c
  WHERE c.organization_id = p_organization_id AND c.id = p_client_id
$$;

-- Whether a client has a student cabinet: a case of the client (or of one of its leads) whose student
-- account (membership) is bound and active.
CREATE FUNCTION platform_private.client_has_student_cabinet(p_organization_id UUID, p_client_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM platform.student_cases sc
    JOIN platform.organization_memberships m
      ON m.organization_id = sc.organization_id AND m.id = sc.student_membership_id AND m.status = 'active'
    WHERE sc.organization_id = p_organization_id
      AND sc.student_membership_id IS NOT NULL
      AND (sc.canonical_client_id = p_client_id
        OR sc.canonical_lead_id IN (SELECT l.id FROM platform.leads l
          WHERE l.organization_id = p_organization_id AND l.client_id = p_client_id)))
$$;

REVOKE ALL ON FUNCTION platform_private.client_merge_service_actor(UUID, UUID, TEXT[]),
  platform_private.client_merge_snapshot(UUID, UUID),
  platform_private.client_has_student_cabinet(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- 5. platform.merge_clients_owner_confirmed_v1
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.merge_clients_owner_confirmed_v1(
  p_organization_id UUID, p_actor_membership_id UUID, p_import_source TEXT, p_external_ref TEXT,
  p_keep_client_id UUID, p_merge_client_id UUID, p_reason TEXT
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c_principal CONSTANT TEXT := 'service:client-merge';
  c_namespace CONSTANT UUID := '6ba7b811-9dad-11d1-80b4-00c04fd430c8';
  v_ref TEXT := btrim(p_external_ref);
  v_reason TEXT := btrim(p_reason);
  v_actor RECORD;
  v_base UUID;
  v_hash TEXT;
  v_prior platform_private.client_merge_service_receipts%ROWTYPE;
  v_locked INTEGER;
  v_keep platform.clients%ROWTYPE;
  v_merge platform.clients%ROWTYPE;
  v_left UUID;
  v_right UUID;
  v_candidate platform_private.client_duplicate_candidates%ROWTYPE;
  v_candidate_created BOOLEAN := FALSE;
  v_before JSONB;
  v_applied JSONB;
  v_constraint TEXT;
  -- contacts
  v_phone_status TEXT := 'none';
  v_email_status TEXT := 'none';
  v_new_phone TEXT;
  v_new_phone_norm TEXT;
  v_new_email TEXT;
  v_new_email_norm TEXT;
  v_result_phone TEXT;
  v_result_email TEXT;
  v_blocked BOOLEAN := FALSE;
  v_note_case UUID;
  v_notes INTEGER := 0;
  v_note_id UUID;
  v_note_body TEXT;
  v_field TEXT;
  v_result JSONB;
BEGIN
  SELECT * INTO v_actor FROM platform_private.client_merge_service_actor(p_organization_id, p_actor_membership_id,
    ARRAY['client.duplicate.resolve']);
  IF p_import_source IS NULL OR p_import_source !~ '^[a-z][a-z0-9_.-]{1,63}$' THEN
    RAISE EXCEPTION 'client_merge_invalid:importSource' USING ERRCODE = '22023';
  END IF;
  IF v_ref IS NULL OR char_length(v_ref) NOT BETWEEN 1 AND 200 OR v_ref ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'client_merge_invalid:externalRef' USING ERRCODE = '22023';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 1 AND 500 OR v_reason ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'client_merge_invalid:reason' USING ERRCODE = '22023';
  END IF;
  IF p_keep_client_id IS NULL THEN
    RAISE EXCEPTION 'client_merge_invalid:keepClientId' USING ERRCODE = '22023';
  END IF;
  IF p_merge_client_id IS NULL THEN
    RAISE EXCEPTION 'client_merge_invalid:mergeClientId' USING ERRCODE = '22023';
  END IF;
  IF p_keep_client_id = p_merge_client_id THEN
    RAISE EXCEPTION 'client_merge_invalid:sameClient' USING ERRCODE = '22023';
  END IF;

  -- One call, one request: the same pair of keys is the same request. The note path's domain lock first
  -- (the order of 287), then the request lock.
  v_base := public.uuid_generate_v5(c_namespace,
    'evo:client-merge:' || p_organization_id::TEXT || ':' || p_import_source || ':' || v_ref);
  v_hash := md5(jsonb_build_object('operation', 'merge', 'actor', p_actor_membership_id,
    'keep', p_keep_client_id, 'merge', p_merge_client_id, 'reason', v_reason)::TEXT);
  PERFORM platform_private.lock_student_case_note_assignment_domain(p_organization_id);
  PERFORM platform_private.lock_p2d_request(v_base);
  SELECT * INTO v_prior FROM platform_private.client_merge_service_receipts r
  WHERE r.organization_id = p_organization_id AND r.import_source = p_import_source AND r.external_ref = v_ref;
  IF FOUND THEN
    IF v_prior.operation <> 'merge' OR v_prior.payload_md5 <> v_hash OR v_prior.actor_membership_id <> v_actor.membership_id THEN
      RAISE EXCEPTION 'client_merge_request_conflict' USING ERRCODE = 'PT409';
    END IF;
    RETURN v_prior.result || jsonb_build_object('replayed', TRUE);
  END IF;

  -- Both clients, locked in one order (two merges of the same clients cannot cross).
  SELECT count(*) INTO v_locked FROM (
    SELECT c.id FROM platform.clients c WHERE c.id IN (p_keep_client_id, p_merge_client_id) ORDER BY c.id FOR UPDATE) l;
  IF v_locked <> 2 THEN
    RAISE EXCEPTION 'client_merge_client_missing' USING ERRCODE = 'PT404';
  END IF;
  SELECT * INTO v_keep FROM platform.clients c WHERE c.id = p_keep_client_id;
  SELECT * INTO v_merge FROM platform.clients c WHERE c.id = p_merge_client_id;
  IF v_keep.organization_id <> p_organization_id OR v_merge.organization_id <> p_organization_id THEN
    RAISE EXCEPTION 'client_merge_invalid:organization' USING ERRCODE = '22023';
  END IF;
  -- The authority 156 gives resolve_client_duplicate, on both clients.
  IF NOT platform_private.staff_can_access(p_organization_id, v_actor.membership_id, 'client.duplicate.resolve', 'client',
      platform_private.resolve_canonical_client_id(p_organization_id, p_keep_client_id))
    OR NOT platform_private.staff_can_access(p_organization_id, v_actor.membership_id, 'client.duplicate.resolve', 'client',
      platform_private.resolve_canonical_client_id(p_organization_id, p_merge_client_id)) THEN
    RAISE EXCEPTION 'client_merge_forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT platform_private.client_duplicate_pair_is_live(p_organization_id, p_keep_client_id, p_merge_client_id) THEN
    RAISE EXCEPTION 'client_merge_not_allowed:not_live' USING ERRCODE = '55000';
  END IF;
  -- A service-only caution (resolve_client_duplicate has no such rule): two student accounts are not
  -- tied to one person silently.
  IF platform_private.client_has_student_cabinet(p_organization_id, p_keep_client_id)
    AND platform_private.client_has_student_cabinet(p_organization_id, p_merge_client_id) THEN
    RAISE EXCEPTION 'client_merge_not_allowed:student_cabinets' USING ERRCODE = '55000';
  END IF;

  v_before := jsonb_build_object('keep', platform_private.client_merge_snapshot(p_organization_id, p_keep_client_id),
    'merge', platform_private.client_merge_snapshot(p_organization_id, p_merge_client_id));

  -- The candidate: an open row of the pair is used; a closed one refuses; none is made with the basis
  -- `owner_confirmed` (the pair order of 084: left < right).
  v_left := LEAST(p_keep_client_id, p_merge_client_id);
  v_right := GREATEST(p_keep_client_id, p_merge_client_id);
  SELECT * INTO v_candidate FROM platform_private.client_duplicate_candidates d
  WHERE d.organization_id = p_organization_id AND d.left_client_id = v_left AND d.right_client_id = v_right FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO platform_private.client_duplicate_candidates (organization_id, left_client_id, right_client_id, match_basis)
    VALUES (p_organization_id, v_left, v_right, 'owner_confirmed')
    RETURNING * INTO v_candidate;
    v_candidate_created := TRUE;
  ELSIF v_candidate.status <> 'open' THEN
    RAISE EXCEPTION 'client_merge_not_allowed:candidate_closed' USING ERRCODE = '55000';
  END IF;

  -- The shared merge. A foreign key that pins a lead of the merged client (088 handoff, 254 report link:
  -- no ON UPDATE CASCADE) is a refusal in words; nothing of the call stays.
  v_candidate := platform_private.client_duplicate_open_candidate(v_candidate.id, p_keep_client_id, p_merge_client_id);
  BEGIN
    v_applied := platform_private.client_duplicate_apply_resolution(v_candidate.id, p_keep_client_id, p_merge_client_id,
      v_reason, public.uuid_generate_v5(v_base, 'client-merge:resolution'), v_actor.profile_id, v_actor.membership_id);
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    RAISE EXCEPTION 'client_merge_not_allowed:linked_records' USING ERRCODE = '55000', DETAIL = v_constraint;
  END;

  -- Contacts of the merged client, now that it is no longer `active` (the unique index of active clients
  -- by email and phone does not see it).
  v_result_phone := v_keep.phone;
  v_result_email := v_keep.email;
  v_new_phone_norm := v_keep.normalized_phone;
  v_new_email_norm := v_keep.normalized_email;
  IF v_merge.phone IS NOT NULL THEN
    IF v_keep.phone IS NULL THEN
      v_new_phone := COALESCE(platform_private.admissions_direct_phone(v_merge.phone), v_merge.phone);
      v_phone_status := 'copied';
    ELSIF platform_private.person_phone_match_keys(v_keep.normalized_phone)
        && platform_private.person_phone_match_keys(v_merge.normalized_phone) THEN
      v_phone_status := 'same';
    ELSE
      v_phone_status := 'conflict';
    END IF;
  END IF;
  IF v_merge.email IS NOT NULL THEN
    IF v_keep.email IS NULL THEN
      v_new_email := v_merge.email;
      v_email_status := 'copied';
    ELSIF v_keep.normalized_email = v_merge.normalized_email THEN
      v_email_status := 'same';
    ELSE
      v_email_status := 'conflict';
    END IF;
  END IF;
  IF v_phone_status = 'copied' THEN v_new_phone_norm := platform_private.normalize_person_phone(v_new_phone); END IF;
  IF v_email_status = 'copied' THEN v_new_email_norm := platform_private.normalize_person_email(v_new_email); END IF;
  -- The pair (email, phone) the keeper would hold must not already be another active client's.
  IF (v_phone_status = 'copied' OR v_email_status = 'copied')
    AND v_new_phone_norm IS NOT NULL AND v_new_email_norm IS NOT NULL
    AND EXISTS (SELECT 1 FROM platform.clients o
      WHERE o.organization_id = p_organization_id AND o.id <> p_keep_client_id AND o.lifecycle_state = 'active'
        AND o.normalized_phone = v_new_phone_norm AND o.normalized_email = v_new_email_norm) THEN
    v_blocked := TRUE;
    IF v_phone_status = 'copied' THEN v_phone_status := 'conflict'; END IF;
    IF v_email_status = 'copied' THEN v_email_status := 'conflict'; END IF;
  END IF;
  IF v_phone_status = 'copied' OR v_email_status = 'copied' THEN
    UPDATE platform.clients c SET
      phone = CASE WHEN v_phone_status = 'copied' THEN v_new_phone ELSE c.phone END,
      normalized_phone = CASE WHEN v_phone_status = 'copied' THEN v_new_phone_norm ELSE c.normalized_phone END,
      email = CASE WHEN v_email_status = 'copied' THEN v_new_email ELSE c.email END,
      normalized_email = CASE WHEN v_email_status = 'copied' THEN v_new_email_norm ELSE c.normalized_email END
    WHERE c.organization_id = p_organization_id AND c.id = p_keep_client_id;
  END IF;

  -- A contact the keeper already has and that differs: a note to the keeper's active case (the path of 287);
  -- without such a case the value lives in the receipt only.
  IF v_phone_status = 'conflict' OR v_email_status = 'conflict' THEN
    SELECT sc.id INTO v_note_case
    FROM platform.student_cases sc
    WHERE sc.organization_id = p_organization_id AND sc.state = 'active'
      AND (sc.canonical_client_id = p_keep_client_id
        OR sc.canonical_lead_id IN (SELECT l.id FROM platform.leads l
          WHERE l.organization_id = p_organization_id AND l.client_id = p_keep_client_id))
    ORDER BY sc.created_at DESC, sc.id DESC
    LIMIT 1;
    IF v_note_case IS NOT NULL THEN
      IF NOT platform_private.staff_can_access(p_organization_id, v_actor.membership_id, 'case.update.append',
          'student_case', v_note_case) THEN
        RAISE EXCEPTION 'client_merge_forbidden' USING ERRCODE = '42501';
      END IF;
      FOREACH v_field IN ARRAY ARRAY['phone', 'email'] LOOP
        IF (v_field = 'phone' AND v_phone_status = 'conflict') OR (v_field = 'email' AND v_email_status = 'conflict') THEN
          v_note_body := CASE WHEN v_field = 'phone'
            THEN 'Второй телефон (из склеенного клиента): ' || v_merge.phone
            ELSE 'Вторая почта (из склеенного клиента): ' || v_merge.email END;
          v_note_id := gen_random_uuid();
          INSERT INTO platform.case_notes (id, organization_id, student_case_id, body, created_by_membership_id)
          VALUES (v_note_id, p_organization_id, v_note_case, v_note_body, v_actor.membership_id);
          -- The journal names the note and its length, never its text.
          INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal, actor_membership_id,
            action, resource_type, resource_id, before_state, after_state, reason, request_id)
          VALUES (p_organization_id, 'user', v_actor.profile_id, c_principal, v_actor.membership_id, 'note.create',
            'student_case', v_note_case, NULL,
            jsonb_build_object('case_note_id', v_note_id, 'student_case_id', v_note_case,
              'body_chars', char_length(v_note_body)),
            v_reason, public.uuid_generate_v5(v_base, 'client-merge:note:' || v_field));
          v_notes := v_notes + 1;
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- No name, phone, e-mail or note of a person reaches the journal: ids, numbers, the contact statuses.
  INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal, actor_membership_id,
    action, resource_type, resource_id, before_state, after_state, reason, request_id)
  VALUES (p_organization_id, 'user', v_actor.profile_id, c_principal, v_actor.membership_id, 'client.duplicate.merge',
    'client', p_keep_client_id,
    jsonb_build_object('keep_lifecycle_state', v_keep.lifecycle_state::TEXT, 'merge_lifecycle_state', v_merge.lifecycle_state::TEXT),
    jsonb_build_object('survivor_client_id', p_keep_client_id, 'superseded_client_id', p_merge_client_id,
      'resolution_id', v_applied -> 'resolution_id', 'candidate_id', v_candidate.id,
      'candidate_created', v_candidate_created, 'moved', v_applied -> 'moved',
      'contacts', jsonb_build_object('phone', v_phone_status, 'email', v_email_status, 'notes_written', v_notes),
      'import_source', p_import_source, 'external_ref', v_ref),
    v_reason, public.uuid_generate_v5(v_base, 'client-merge:merge'));

  v_result := jsonb_build_object(
    'organization_id', p_organization_id,
    'operation', 'merge',
    'status', 'merged',
    'import_source', p_import_source,
    'external_ref', v_ref,
    'keep_client_id', p_keep_client_id,
    'merge_client_id', p_merge_client_id,
    'resolution_id', v_applied -> 'resolution_id',
    'candidate_id', v_candidate.id,
    'candidate_created', v_candidate_created,
    'moved', v_applied -> 'moved',
    -- Read through the alias on the survivor from now on; the rows stay on the merged client.
    'carried_by_alias', jsonb_build_object(
      'external_identifiers', (v_before -> 'merge' -> 'external_identifier_count'),
      'provenance', (v_before -> 'merge' -> 'provenance_count')),
    'contacts', jsonb_build_object('phone', v_phone_status, 'email', v_email_status,
      'blocked_by_other_client', v_blocked, 'notes_written', v_notes, 'note_case_id', v_note_case),
    'replayed', FALSE);
  INSERT INTO platform_private.client_merge_service_receipts (organization_id, operation, import_source, external_ref,
    actor_membership_id, payload_md5, keep_client_id, merge_client_id, result, before_state)
  VALUES (p_organization_id, 'merge', p_import_source, v_ref, v_actor.membership_id, v_hash,
    p_keep_client_id, p_merge_client_id, v_result - 'replayed', v_before);
  RETURN v_result;
END
$$;

-- ---------------------------------------------------------------------------
-- 6. platform.close_sales_lead_already_student_v1
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.close_sales_lead_already_student_v1(
  p_organization_id UUID, p_actor_membership_id UUID, p_import_source TEXT, p_external_ref TEXT,
  p_lead_id UUID, p_note TEXT, p_reason TEXT
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c_principal CONSTANT TEXT := 'service:lead-already-student';
  c_namespace CONSTANT UUID := '6ba7b811-9dad-11d1-80b4-00c04fd430c8';
  -- 246's fixed reasons are the only ones its reads accept; «Дубликат» is the nearest to «уже студент».
  c_closure_reason CONSTANT TEXT := 'duplicate';
  v_ref TEXT := btrim(p_external_ref);
  v_reason TEXT := btrim(p_reason);
  v_note TEXT := NULLIF(btrim(p_note, E' \t\r\n'), '');
  v_actor RECORD;
  v_base UUID;
  v_hash TEXT;
  v_prior platform_private.client_merge_service_receipts%ROWTYPE;
  v_lead platform.leads%ROWTYPE;
  v_changed platform.leads%ROWTYPE;
  v_client UUID;
  v_cases UUID[];
  v_before JSONB;
  v_result JSONB;
BEGIN
  SELECT * INTO v_actor FROM platform_private.client_merge_service_actor(p_organization_id, p_actor_membership_id,
    ARRAY['lead.sales.workflow.manage', 'lead.read']);
  IF p_import_source IS NULL OR p_import_source !~ '^[a-z][a-z0-9_.-]{1,63}$' THEN
    RAISE EXCEPTION 'lead_close_invalid:importSource' USING ERRCODE = '22023';
  END IF;
  IF v_ref IS NULL OR char_length(v_ref) NOT BETWEEN 1 AND 200 OR v_ref ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'lead_close_invalid:externalRef' USING ERRCODE = '22023';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 1 AND 500 OR v_reason ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'lead_close_invalid:reason' USING ERRCODE = '22023';
  END IF;
  IF p_lead_id IS NULL THEN
    RAISE EXCEPTION 'lead_close_invalid:leadId' USING ERRCODE = '22023';
  END IF;
  IF v_note IS NOT NULL AND (char_length(v_note) > 500 OR v_note ~ U&'[\0001-\001F\007F-\009F\2028\2029]') THEN
    RAISE EXCEPTION 'lead_close_invalid:note' USING ERRCODE = '22023';
  END IF;

  v_base := public.uuid_generate_v5(c_namespace,
    'evo:lead-already-student:' || p_organization_id::TEXT || ':' || p_import_source || ':' || v_ref);
  v_hash := md5(jsonb_build_object('operation', 'close_lead', 'actor', p_actor_membership_id,
    'lead', p_lead_id, 'note', v_note, 'reason', v_reason)::TEXT);
  PERFORM platform_private.lock_p2d_request(v_base);
  SELECT * INTO v_prior FROM platform_private.client_merge_service_receipts r
  WHERE r.organization_id = p_organization_id AND r.import_source = p_import_source AND r.external_ref = v_ref;
  IF FOUND THEN
    IF v_prior.operation <> 'close_lead' OR v_prior.payload_md5 <> v_hash OR v_prior.actor_membership_id <> v_actor.membership_id THEN
      RAISE EXCEPTION 'lead_close_request_conflict' USING ERRCODE = 'PT409';
    END IF;
    RETURN v_prior.result || jsonb_build_object('replayed', TRUE);
  END IF;

  -- The workflow command's organization lock mode (086), then the lead row, as 246: the stage form, the
  -- handoff, the closure and this call serialize on the lead.
  PERFORM 1 FROM platform.organizations o WHERE o.id = p_organization_id FOR KEY SHARE;
  SELECT * INTO v_lead FROM platform.leads l
  WHERE l.organization_id = p_organization_id AND l.id = p_lead_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lead_close_lead_missing' USING ERRCODE = 'PT404';
  END IF;
  IF NOT platform_private.staff_can_access(p_organization_id, v_actor.membership_id, 'lead.sales.workflow.manage', 'lead', v_lead.id)
    OR NOT platform_private.staff_can_access(p_organization_id, v_actor.membership_id, 'lead.read', 'lead', v_lead.id) THEN
    RAISE EXCEPTION 'client_merge_forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_lead.lifecycle_state <> 'open' THEN
    RAISE EXCEPTION 'lead_close_state_conflict' USING ERRCODE = 'PT409';
  END IF;

  -- A completed handoff is a sale (246 refuses closing it): the one definition of 247.
  IF EXISTS (SELECT 1 FROM platform_private.sales_lead_handoffs(p_organization_id, ARRAY[v_lead.id])) THEN
    RAISE EXCEPTION 'lead_close_not_allowed:handed_off' USING ERRCODE = '55000';
  END IF;
  -- A lead a case was opened on is that case's own lead, not a second enquiry.
  IF EXISTS (SELECT 1 FROM platform.student_cases sc
    WHERE sc.organization_id = p_organization_id AND sc.canonical_lead_id = v_lead.id) THEN
    RAISE EXCEPTION 'lead_close_not_allowed:case_of_this_lead' USING ERRCODE = '55000';
  END IF;
  IF v_lead.client_id IS NULL THEN
    RAISE EXCEPTION 'lead_close_not_allowed:no_student_case' USING ERRCODE = '55000';
  END IF;
  v_client := platform_private.resolve_canonical_client_id(p_organization_id, v_lead.client_id);
  -- The person is a student: a case of the client in work (pending, active), or finished as «Поступил»
  -- (the outcome of 246, read as staff_student_case_closure_v1 reads it). A case finished otherwise does not
  -- make a person a student.
  SELECT COALESCE(array_agg(sc.id ORDER BY sc.created_at, sc.id), ARRAY[]::UUID[]) INTO v_cases
  FROM platform.student_cases sc
  WHERE sc.organization_id = p_organization_id
    AND (sc.canonical_client_id = v_client
      OR sc.canonical_lead_id IN (SELECT l.id FROM platform.leads l
        WHERE l.organization_id = p_organization_id AND l.client_id = v_client))
    AND (sc.state IN ('pending', 'active')
      OR (sc.state = 'closed' AND (SELECT audit.after_state ->> 'outcome'
        FROM platform.student_case_lifecycle_events event
        LEFT JOIN platform.audit_events audit
          ON audit.request_id = event.request_id AND audit.action = 'case.lifecycle.change'
         AND audit.resource_type = 'student_case' AND audit.resource_id = event.student_case_id
        WHERE event.organization_id = sc.organization_id AND event.student_case_id = sc.id
          AND event.event_type = 'closed'
        ORDER BY event.created_at DESC, event.id DESC
        LIMIT 1) = 'enrolled'));
  IF cardinality(v_cases) = 0 THEN
    RAISE EXCEPTION 'lead_close_not_allowed:no_student_case' USING ERRCODE = '55000';
  END IF;

  v_before := jsonb_build_object('lead_id', v_lead.id, 'client_id', v_lead.client_id, 'canonical_client_id', v_client,
    'lifecycle_state', v_lead.lifecycle_state::TEXT, 'stage_key', v_lead.stage_key,
    'workflow_version', v_lead.workflow_version::TEXT, 'student_case_ids', to_jsonb(v_cases));

  -- 246's closure: only lifecycle_state changes; stage, owner and next step stay, workflow_version is checked
  -- but not bumped (111).
  UPDATE platform.leads l SET lifecycle_state = 'disqualified'::platform.lead_lifecycle_state
  WHERE l.organization_id = v_lead.organization_id AND l.id = v_lead.id
  RETURNING * INTO v_changed;

  INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal, actor_membership_id,
    action, resource_type, resource_id, before_state, after_state, reason, request_id)
  VALUES (p_organization_id, 'user', v_actor.profile_id, c_principal, v_actor.membership_id, 'lead.lifecycle.change',
    'lead', v_lead.id,
    jsonb_build_object('lifecycle', 'open', 'lifecycle_state', v_lead.lifecycle_state::TEXT,
      'workflow_version', v_lead.workflow_version::TEXT),
    jsonb_build_object('lifecycle', 'closed', 'lifecycle_state', v_changed.lifecycle_state::TEXT,
      'reason', c_closure_reason, 'note', NULL, 'stage_key', v_changed.stage_key,
      'workflow_version', v_changed.workflow_version::TEXT,
      'import_source', p_import_source, 'external_ref', v_ref),
    v_reason, public.uuid_generate_v5(v_base, 'lead-already-student:close'));

  v_result := jsonb_build_object(
    'organization_id', p_organization_id,
    'operation', 'close_lead',
    'status', 'closed',
    'lead_id', v_changed.id,
    'client_id', v_client,
    'lifecycle', 'closed',
    'reason', c_closure_reason,
    'stage_key', v_changed.stage_key,
    'workflow_version', v_changed.workflow_version::TEXT,
    'student_case_ids', to_jsonb(v_cases),
    'import_source', p_import_source,
    'external_ref', v_ref,
    'replayed', FALSE);
  INSERT INTO platform_private.client_merge_service_receipts (organization_id, operation, import_source, external_ref,
    actor_membership_id, payload_md5, lead_id, note, result, before_state)
  VALUES (p_organization_id, 'close_lead', p_import_source, v_ref, v_actor.membership_id, v_hash,
    v_lead.id, v_note, v_result - 'replayed', v_before);
  RETURN v_result;
END
$$;

REVOKE ALL ON FUNCTION platform.merge_clients_owner_confirmed_v1(UUID, UUID, TEXT, TEXT, UUID, UUID, TEXT),
  platform.close_sales_lead_already_student_v1(UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.merge_clients_owner_confirmed_v1(UUID, UUID, TEXT, TEXT, UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION platform.close_sales_lead_already_student_v1(UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT) TO service_role;
COMMENT ON FUNCTION platform.merge_clients_owner_confirmed_v1(UUID, UUID, TEXT, TEXT, UUID, UUID, TEXT) IS
  'Migration 308: service-only merge of two duplicate clients the owner confirmed (service_role without a user JWT; actor: an active Admin membership holding client.duplicate.resolve). Uses the open candidate of the pair or makes one with the basis owner_confirmed, then the same merge as resolve_client_duplicate (leads, cases and conversations move to the kept client; the merged client becomes immutable; irreversible); fills the kept client''s empty phone / e-mail from the merged one, a differing one goes to a note on the kept client''s active case and to the receipt. Refuses a client of another organization, the same client, a client that is not live, a closed candidate, two student cabinets and a lead pinned by a handoff or a report link. Idempotent by (organization, import source, external reference); dry-run = call inside a transaction and ROLLBACK.';
COMMENT ON FUNCTION platform.close_sales_lead_already_student_v1(UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT) IS
  'Migration 308: service-only closure of an open sales lead whose client already has a student case (service_role without a user JWT; actor: an active Admin membership). The lifecycle change of 246 (disqualified, reason duplicate, event lead.lifecycle.change); refuses a lead that is not open, a handed-off lead, the lead a case was opened on, and a client without a case in work or finished as enrolled. Idempotent by (organization, import source, external reference).';

-- ---------------------------------------------------------------------------
-- Self-check: definer, empty search_path, service_role-only EXECUTE on the two calls, nothing on the helpers,
-- the public function keeps its grant, the receipts are private.
-- ---------------------------------------------------------------------------
DO $a308_verify$
DECLARE routine RECORD;
BEGIN
  FOR routine IN SELECT p.oid, p.prosecdef, p.proconfig FROM pg_catalog.pg_proc p WHERE p.oid IN (
      'platform.merge_clients_owner_confirmed_v1(uuid,uuid,text,text,uuid,uuid,text)'::regprocedure,
      'platform.close_sales_lead_already_student_v1(uuid,uuid,text,text,uuid,text,text)'::regprocedure) LOOP
    IF NOT routine.prosecdef OR routine.proconfig IS DISTINCT FROM ARRAY['search_path=""']
      OR NOT has_function_privilege('service_role', routine.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', routine.oid, 'EXECUTE')
      OR has_function_privilege('anon', routine.oid, 'EXECUTE')
    THEN
      RAISE EXCEPTION 'a308_verification_failed: %', routine.oid::regprocedure;
    END IF;
  END LOOP;
  IF has_function_privilege('service_role', 'platform_private.client_duplicate_apply_resolution(uuid,uuid,uuid,text,uuid,uuid,uuid)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'platform_private.client_duplicate_open_candidate(uuid,uuid,uuid)', 'EXECUTE')
    OR has_function_privilege('service_role', 'platform_private.client_merge_service_actor(uuid,uuid,text[])', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'platform.resolve_client_duplicate(uuid,uuid,uuid,text,uuid)', 'EXECUTE')
    OR has_function_privilege('service_role', 'platform.resolve_client_duplicate(uuid,uuid,uuid,text,uuid)', 'EXECUTE')
    OR has_table_privilege('service_role', 'platform_private.client_merge_service_receipts', 'SELECT')
    OR has_table_privilege('authenticated', 'platform_private.client_merge_service_receipts', 'SELECT')
    OR NOT (SELECT c.relforcerowsecurity FROM pg_catalog.pg_class c
      WHERE c.oid = 'platform_private.client_merge_service_receipts'::regclass)
  THEN
    RAISE EXCEPTION 'a308_verification_failed: posture';
  END IF;
END
$a308_verify$;

NOTIFY pgrst, 'reload schema';
COMMIT;
