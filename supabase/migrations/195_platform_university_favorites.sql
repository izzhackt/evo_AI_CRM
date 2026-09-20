-- PORT-3b «Избранное каталога» (план docs/EVO_PORTAL_WEB_IPHONE_PLAN_2026-09-19.md
-- §6 «Избранное», §8.5 «Личные данные»; решение PORT-0
-- docs/design/portal/port-0-contracts.md «Избранное v1 — на уровне вуза …
-- таблица student-owned + RPC add/remove/list + batch-by-ids чтение карточек;
-- та же RPC-only изоляция, что у каталога»; запись PLAN_CHANGES 2026-09-19
-- «PORT-3b: избранное каталога и сравнение (миграция 195)»).
--
-- Intent. Избранное — личные данные ученика (план §8.5): staff не получает
-- ни чтения, ни записи. Уровень доступа — approved (общая возможность,
-- план §4), поэтому guard всех трёх RPC — ровно guard каталога 148
-- (`student_university_catalog`): platform_role='student' + portal.read.self,
-- СОЗНАТЕЛЬНО без проверки состояния кейса (case-независимость; НЕ
-- case-scoped гейты 192). Организация и membership выводятся из
-- current_actor_authority() внутри функции — никакой параметр не адресует
-- чужой membership.
--
-- Idempotency by construction: set_university_favorite_v1 — INSERT … ON
-- CONFLICT DO NOTHING / DELETE без request-ledger'а. Повтор запроса (retry
-- сети, двойное нажатие) не меняет состояние и возвращает то же фактическое
-- состояние + счётчик — ledger-таблица тут была бы лишней сущностью (148/187
-- ведут ledger, потому что их повтор с другим payload'ом опасен; здесь
-- payload и есть целевое состояние).
--
-- Row shape by_ids: та же, что у student_university_catalog
-- (items: id/version/publishedAt/content, nextOffset NULL) — клиент
-- переиспользует parseUniversityPage. Потолок 30 id зеркалит страницу
-- каталога (LIMIT 30 в university_catalog_page).
BEGIN;

CREATE TABLE platform_private.university_favorites (
  organization_id UUID NOT NULL REFERENCES platform.organizations(id),
  membership_id UUID NOT NULL,
  institution_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organization_id, membership_id, institution_id),
  FOREIGN KEY (organization_id, membership_id)
    REFERENCES platform.organization_memberships(organization_id, id),
  FOREIGN KEY (organization_id, institution_id)
    REFERENCES platform.catalog_institutions(organization_id, id)
);

ALTER TABLE platform_private.university_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.university_favorites FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform_private.university_favorites
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Идемпотентная запись собственного избранного. Возвращает фактическое
-- состояние после операции и текущий счётчик записей ученика.
CREATE FUNCTION platform.set_university_favorite_v1(p_institution_id UUID, p_favored BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a RECORD; favored BOOLEAN; total BIGINT;
BEGIN
  SELECT * INTO a FROM platform.current_actor_authority() WHERE platform_role = 'student';
  IF NOT FOUND OR NOT private.platform_has_permission(a.organization_id, 'portal.read.self') THEN
    RAISE EXCEPTION 'Favourites unavailable' USING ERRCODE = '42501';
  END IF;
  IF p_institution_id IS NULL OR p_favored IS NULL THEN
    RAISE EXCEPTION 'Invalid favourite command' USING ERRCODE = '22023';
  END IF;
  -- Институция обязана принадлежать организации актора и иметь published-
  -- публикацию; несуществующий, чужой и неопубликованный id неразличимы
  -- (стиль 148 'Institution is unavailable').
  IF NOT EXISTS (
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
  IF p_favored THEN
    INSERT INTO platform_private.university_favorites (organization_id, membership_id, institution_id)
    VALUES (a.organization_id, a.membership_id, p_institution_id)
    ON CONFLICT (organization_id, membership_id, institution_id) DO NOTHING;
  ELSE
    DELETE FROM platform_private.university_favorites f
    WHERE f.organization_id = a.organization_id
      AND f.membership_id = a.membership_id
      AND f.institution_id = p_institution_id;
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM platform_private.university_favorites f
    WHERE f.organization_id = a.organization_id
      AND f.membership_id = a.membership_id
      AND f.institution_id = p_institution_id
  ) INTO favored;
  SELECT count(*) INTO total FROM platform_private.university_favorites f
  WHERE f.organization_id = a.organization_id AND f.membership_id = a.membership_id;
  RETURN jsonb_build_object(
    'institutionId', p_institution_id, 'favored', favored, 'favoritesCount', total
  );
END $$;

-- Только собственные записи актора; свежие — первыми.
CREATE FUNCTION platform.student_university_favorites_v1()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a RECORD;
BEGIN
  SELECT * INTO a FROM platform.current_actor_authority() WHERE platform_role = 'student';
  IF NOT FOUND OR NOT private.platform_has_permission(a.organization_id, 'portal.read.self') THEN
    RAISE EXCEPTION 'Favourites unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object('institutionId', f.institution_id, 'createdAt', f.created_at)
      ORDER BY f.created_at DESC, f.institution_id
    )
    FROM platform_private.university_favorites f
    WHERE f.organization_id = a.organization_id AND f.membership_id = a.membership_id
  ), '[]'::JSONB);
END $$;

-- Batch-чтение карточек по списку id: та же форма строк и тот же публичный
-- DTO, что у student_university_catalog (только validated content и
-- id/version/publishedAt — без staff-метаданных). Только published и только
-- организация актора; любой неизвестный/чужой/неопубликованный id — отказ
-- всего вызова.
CREATE FUNCTION platform.student_university_catalog_by_ids_v1(p_institution_ids UUID[])
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a RECORD; ids UUID[]; result JSONB;
BEGIN
  SELECT * INTO a FROM platform.current_actor_authority() WHERE platform_role = 'student';
  IF NOT FOUND OR NOT private.platform_has_permission(a.organization_id, 'portal.read.self') THEN
    RAISE EXCEPTION 'Catalogue unavailable' USING ERRCODE = '42501';
  END IF;
  IF p_institution_ids IS NULL OR cardinality(p_institution_ids) > 30
    OR EXISTS (SELECT 1 FROM unnest(p_institution_ids) AS id WHERE id IS NULL)
  THEN
    RAISE EXCEPTION 'Invalid catalogue filter' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(array_agg(DISTINCT id), '{}'::UUID[]) INTO ids
  FROM unnest(p_institution_ids) AS id;
  IF EXISTS (
    SELECT 1 FROM unnest(ids) AS requested(id)
    WHERE NOT EXISTS (
      SELECT 1 FROM platform.catalog_institutions i
      WHERE i.organization_id = a.organization_id AND i.id = requested.id
        AND EXISTS (
          SELECT 1 FROM platform_private.university_catalog_publications p
          WHERE p.organization_id = i.organization_id
            AND p.institution_id = i.id AND p.status = 'published'
        )
    )
  ) THEN
    RAISE EXCEPTION 'Institution is unavailable' USING ERRCODE = '42501';
  END IF;
  WITH latest AS (
    SELECT DISTINCT ON (p.institution_id) p.institution_id, p.version, p.content, p.reviewed_at
    FROM platform_private.university_catalog_publications p
    JOIN platform.catalog_institutions i
      ON i.id = p.institution_id AND i.organization_id = p.organization_id
    WHERE p.organization_id = a.organization_id AND p.status = 'published'
      AND p.institution_id = ANY (ids)
    ORDER BY p.institution_id, p.version DESC
  )
  SELECT jsonb_build_object(
    'items', COALESCE(jsonb_agg(
      jsonb_build_object('id', institution_id, 'version', version,
        'publishedAt', reviewed_at, 'content', content)
      ORDER BY content->>'name', institution_id
    ), '[]'::JSONB),
    'nextOffset', NULL
  ) INTO result FROM latest;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION
  platform.set_university_favorite_v1(UUID, BOOLEAN),
  platform.student_university_favorites_v1(),
  platform.student_university_catalog_by_ids_v1(UUID[])
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION
  platform.set_university_favorite_v1(UUID, BOOLEAN),
  platform.student_university_favorites_v1(),
  platform.student_university_catalog_by_ids_v1(UUID[])
TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
