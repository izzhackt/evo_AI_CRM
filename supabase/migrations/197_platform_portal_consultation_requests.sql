-- PORT-5b «Запрос консультации» (план docs/EVO_PORTAL_WEB_IPHONE_PLAN_2026-09-19.md
-- §5 п.6, §6 строка «Консультация», §10 PORT-5; запись PLAN_CHANGES 2026-09-19
-- «PORT-5b: запрос консультации из кабинета (миграция 197)»).
--
-- Intent. Approved-пользователь отправляет короткий запрос на консультацию —
-- из карточки вуза (с institution_id) или из профиля (без) — в существующую
-- staff-очередь «Заявки». Повтор не создаёт дубль; ученик видит фактическое
-- состояние запроса, сотрудник — нужный контекст (план §6).
--
-- Guard студенческих RPC — ровно guard каталога/избранного 148/195/196:
-- platform_role='student' + portal.read.self, СОЗНАТЕЛЬНО case-НЕзависимый
-- (общая возможность обоих tier'ов, план §4). Организация и membership
-- выводятся из current_actor_authority() — параметры не адресуют чужой
-- membership.
--
-- Staff-guard — РЕАЛЬНОЕ разрешение очереди «Заявки»: маршрут /v3/requests
-- гейтится capability sales.read = permission 'lead.read'
-- (src/lib/platform-access.ts; Sales-шаблон 173 держит lead.read; admin
-- проходит через admin-байпас platform_private.staff_has_permission).
-- Новых permission-ключей не вводится; студенты исключены явно.
--
-- Идемпотентность (план §8.7): повтор того же request_id возвращает исходный
-- receipt в любом статусе; один ОТКРЫТЫЙ запрос на участника — частичный
-- уникальный индекс (инвариант в БД, паттерн 196), второй create при
-- открытом запросе возвращает открытый receipt; после handled новый запрос
-- разрешён. handle: requested→handled, повтор с p_expected_status='handled' —
-- идемпотентный replay без перезаписи, несовпадение статуса — PT409
-- (конвенция 178/186/194: бизнес-конфликт не ретраится PostgREST'ом).
--
-- ПРИВАТНОСТЬ (план §6 «Тесты», §14): запрос НЕ прикрепляет результаты и
-- ответы тестов ни в каком виде; note — свободный текст ученика; вуз — его
-- явный выбор; staff-строка несёт ровно объявленный набор ключей.
BEGIN;

CREATE TABLE platform_private.portal_consultation_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations(id),
  membership_id UUID NOT NULL,
  request_id UUID NOT NULL,
  institution_id UUID,
  note TEXT CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 500),
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'handled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  handled_at TIMESTAMPTZ,
  handled_by_membership_id UUID,
  CHECK (
    (status = 'requested'
      AND handled_at IS NULL AND handled_by_membership_id IS NULL)
    OR (status = 'handled'
      AND handled_at IS NOT NULL AND handled_by_membership_id IS NOT NULL)
  ),
  UNIQUE (organization_id, membership_id, request_id),
  FOREIGN KEY (organization_id, membership_id)
    REFERENCES platform.organization_memberships(organization_id, id),
  FOREIGN KEY (organization_id, handled_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id),
  FOREIGN KEY (organization_id, institution_id)
    REFERENCES platform.catalog_institutions(organization_id, id)
);

-- «Один открытый запрос на участника» — инвариант в самой БД (паттерн 196).
CREATE UNIQUE INDEX portal_consultation_requests_one_open_idx
  ON platform_private.portal_consultation_requests (organization_id, membership_id)
  WHERE status = 'requested';

ALTER TABLE platform_private.portal_consultation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.portal_consultation_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform_private.portal_consultation_requests
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Имя вуза — из последней published-публикации каталога организации (то же
-- разрешённое подмножество каталога, что читает student_university_catalog).
CREATE FUNCTION platform_private.portal_consultation_institution_name(
  p_organization_id UUID, p_institution_id UUID
) RETURNS TEXT LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p.content ->> 'name'
  FROM platform_private.university_catalog_publications p
  WHERE p.organization_id = p_organization_id
    AND p.institution_id = p_institution_id AND p.status = 'published'
  ORDER BY p.version DESC LIMIT 1
$$;

-- Единая форма receipt для студента: create и own-список отдают одно и то же.
CREATE FUNCTION platform_private.portal_consultation_receipt(
  r platform_private.portal_consultation_requests
) RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'requestId', r.request_id,
    'status', r.status,
    'institutionId', r.institution_id,
    'institutionName', CASE WHEN r.institution_id IS NULL THEN NULL
      ELSE platform_private.portal_consultation_institution_name(r.organization_id, r.institution_id) END,
    'note', r.note,
    'requestedAt', r.created_at,
    'handledAt', r.handled_at
  )
$$;

REVOKE ALL ON FUNCTION
  platform_private.portal_consultation_institution_name(UUID, UUID),
  platform_private.portal_consultation_receipt(platform_private.portal_consultation_requests)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Создание запроса. Идемпотентно по request_id; при открытом запросе повтор
-- с новым request_id возвращает ОТКРЫТЫЙ receipt (без дубля, честное
-- состояние); после handled новый запрос разрешён.
CREATE FUNCTION platform.create_portal_consultation_request_v1(
  p_request_id UUID, p_institution_id UUID DEFAULT NULL, p_note TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a RECORD; note TEXT; existing platform_private.portal_consultation_requests%ROWTYPE;
BEGIN
  SELECT * INTO a FROM platform.current_actor_authority() WHERE platform_role = 'student';
  IF NOT FOUND OR NOT private.platform_has_permission(a.organization_id, 'portal.read.self') THEN
    RAISE EXCEPTION 'Consultation unavailable' USING ERRCODE = '42501';
  END IF;
  note := NULLIF(btrim(p_note), '');
  -- Перенос строки и табуляция в свободном тексте допустимы, остальные
  -- управляющие символы — нет (стиль 177 для staff-facing текста).
  IF p_request_id IS NULL
    OR (note IS NOT NULL AND (char_length(note) > 500
      OR regexp_replace(note, '[' || E'\n\r\t' || ']', '', 'g') ~ '[[:cntrl:]]'))
  THEN
    RAISE EXCEPTION 'Invalid consultation request' USING ERRCODE = '22023';
  END IF;
  -- Институция при наличии обязана принадлежать организации актора и иметь
  -- published-публикацию; несуществующий, чужой и неопубликованный id
  -- неразличимы (стиль 148/195 'Institution is unavailable').
  IF p_institution_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM platform.catalog_institutions i
    WHERE i.organization_id = a.organization_id AND i.id = p_institution_id
      AND EXISTS (
        SELECT 1 FROM platform_private.university_catalog_publications p
        WHERE p.organization_id = i.organization_id
          AND p.institution_id = i.id AND p.status = 'published'
      )
  ) THEN
    RAISE EXCEPTION 'Institution is unavailable' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'evo:portal-consultation:' || a.organization_id::TEXT || ':' || a.membership_id::TEXT, 0));
  -- Точный повтор той же команды: тот же receipt в любом статусе.
  SELECT * INTO existing FROM platform_private.portal_consultation_requests r
  WHERE r.organization_id = a.organization_id
    AND r.membership_id = a.membership_id AND r.request_id = p_request_id;
  IF NOT FOUND THEN
    -- Уже есть открытый запрос — возвращаем его, второй ряд не создаётся.
    SELECT * INTO existing FROM platform_private.portal_consultation_requests r
    WHERE r.organization_id = a.organization_id
      AND r.membership_id = a.membership_id AND r.status = 'requested'
    ORDER BY r.created_at DESC LIMIT 1;
  END IF;
  IF NOT FOUND THEN
    INSERT INTO platform_private.portal_consultation_requests (
      organization_id, membership_id, request_id, institution_id, note
    ) VALUES (a.organization_id, a.membership_id, p_request_id, p_institution_id, note)
    RETURNING * INTO existing;
  END IF;
  RETURN platform_private.portal_consultation_receipt(existing);
END $$;

-- Только собственные запросы актора; свежие первыми, потолок 20.
CREATE FUNCTION platform.own_portal_consultation_requests_v1()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a RECORD;
BEGIN
  SELECT * INTO a FROM platform.current_actor_authority() WHERE platform_role = 'student';
  IF NOT FOUND OR NOT private.platform_has_permission(a.organization_id, 'portal.read.self') THEN
    RAISE EXCEPTION 'Consultation unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(
      platform_private.portal_consultation_receipt(x.r)
      ORDER BY (x.r).created_at DESC, (x.r).id
    )
    FROM (
      SELECT r FROM platform_private.portal_consultation_requests r
      WHERE r.organization_id = a.organization_id AND r.membership_id = a.membership_id
      ORDER BY r.created_at DESC, r.id LIMIT 20
    ) x
  ), '[]'::JSONB);
END $$;

-- Staff-очередь консультаций: страница 50 строк, открытые первыми, затем
-- свежие. Контекст строки — имя студента, выбранный вуз (если был), note,
-- даты и кто обработал. РОВНО этот набор ключей: никакие результаты тестов
-- и личный учебный прогресс сюда не попадают (план §6/§14, стандарт 135).
CREATE FUNCTION platform.staff_portal_consultation_requests_v1(p_offset BIGINT DEFAULT 0)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a RECORD; items JSONB; total BIGINT; open_count BIGINT;
BEGIN
  SELECT * INTO a FROM platform.current_actor_authority();
  IF a.membership_id IS NULL OR a.platform_role = 'student'
    OR NOT private.platform_has_permission(a.organization_id, 'lead.read') THEN
    RAISE EXCEPTION 'Consultation requests unavailable' USING ERRCODE = '42501';
  END IF;
  IF p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'Invalid consultation page' USING ERRCODE = '22023';
  END IF;
  SELECT count(*), count(*) FILTER (WHERE r.status = 'requested')
  INTO total, open_count
  FROM platform_private.portal_consultation_requests r
  WHERE r.organization_id = a.organization_id;
  SELECT jsonb_agg(jsonb_build_object(
    'id', x.id,
    'status', x.status,
    'studentName', x.student_name,
    'institutionId', x.institution_id,
    'institutionName', CASE WHEN x.institution_id IS NULL THEN NULL
      ELSE platform_private.portal_consultation_institution_name(x.organization_id, x.institution_id) END,
    'note', x.note,
    'requestedAt', x.created_at,
    'handledAt', x.handled_at,
    'handledByName', x.handled_by_name
  ) ORDER BY x.is_open DESC, x.created_at DESC, x.id)
  INTO items
  FROM (
    SELECT r.id, r.status, r.organization_id, r.institution_id, r.note,
      r.created_at, r.handled_at, (r.status = 'requested') AS is_open,
      p.display_name AS student_name, hp.display_name AS handled_by_name
    FROM platform_private.portal_consultation_requests r
    JOIN platform.organization_memberships m
      ON m.organization_id = r.organization_id AND m.id = r.membership_id
    JOIN platform.profiles p ON p.id = m.profile_id
    LEFT JOIN platform.organization_memberships hm
      ON hm.organization_id = r.organization_id AND hm.id = r.handled_by_membership_id
    LEFT JOIN platform.profiles hp ON hp.id = hm.profile_id
    WHERE r.organization_id = a.organization_id
    ORDER BY (r.status = 'requested') DESC, r.created_at DESC, r.id
    OFFSET p_offset LIMIT 50
  ) x;
  RETURN jsonb_build_object(
    'items', COALESCE(items, '[]'::JSONB),
    'nextOffset', CASE WHEN total > p_offset + 50 THEN p_offset + 50 END,
    'openCount', open_count
  );
END $$;

-- Обработка запроса: requested→handled с фиксацией кто/когда. Повтор с
-- p_expected_status='handled' — идемпотентный replay (ничего не
-- переписывается); несовпадение статуса — PT409 (стейл-интерфейс честно
-- узнаёт о конфликте и перечитывает список, конвенция 178/186/194).
CREATE FUNCTION platform.handle_portal_consultation_request_v1(
  p_row_id UUID, p_expected_status TEXT
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a RECORD; req platform_private.portal_consultation_requests%ROWTYPE;
BEGIN
  SELECT * INTO a FROM platform.current_actor_authority();
  IF a.membership_id IS NULL OR a.platform_role = 'student'
    OR NOT private.platform_has_permission(a.organization_id, 'lead.read') THEN
    RAISE EXCEPTION 'Consultation requests unavailable' USING ERRCODE = '42501';
  END IF;
  IF p_row_id IS NULL OR p_expected_status IS NULL
    OR p_expected_status NOT IN ('requested', 'handled') THEN
    RAISE EXCEPTION 'Invalid consultation command' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO req FROM platform_private.portal_consultation_requests r
  WHERE r.organization_id = a.organization_id AND r.id = p_row_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Consultation requests unavailable' USING ERRCODE = '42501';
  END IF;
  IF req.status <> p_expected_status THEN
    RAISE EXCEPTION 'consultation_request_conflict' USING ERRCODE = 'PT409';
  END IF;
  IF req.status = 'requested' THEN
    UPDATE platform_private.portal_consultation_requests SET
      status = 'handled',
      handled_at = clock_timestamp(),
      handled_by_membership_id = a.membership_id
    WHERE id = req.id RETURNING * INTO req;
  END IF;
  RETURN jsonb_build_object('id', req.id, 'status', req.status, 'handledAt', req.handled_at);
END $$;

REVOKE ALL ON FUNCTION
  platform.create_portal_consultation_request_v1(UUID, UUID, TEXT),
  platform.own_portal_consultation_requests_v1(),
  platform.staff_portal_consultation_requests_v1(BIGINT),
  platform.handle_portal_consultation_request_v1(UUID, TEXT)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION
  platform.create_portal_consultation_request_v1(UUID, UUID, TEXT),
  platform.own_portal_consultation_requests_v1(),
  platform.staff_portal_consultation_requests_v1(BIGINT),
  platform.handle_portal_consultation_request_v1(UUID, TEXT)
TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
