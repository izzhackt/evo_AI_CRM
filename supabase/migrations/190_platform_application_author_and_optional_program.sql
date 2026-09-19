-- ============================================================
-- 190_platform_application_author_and_optional_program.sql
--
-- OTH-4 «Uni & knowledge base» (Other staff-UX plan).
-- docs/EVO_OTHER_FABLE_PLAN_2026-09-19.md §«Uni & knowledge base»
-- («Куратор открывает дело → «Вузы и программы» → «Добавить вуз».
-- Небольшое окно поиска открывается поверх дела... программу указать
-- сразу либо позже... Показывать автора добавления, когда он известен.
-- Добавленный вуз означает «рассматриваем». Фактическая подача
-- отмечается отдельно.»).
--
-- Zero-degradation, additive only. Two independent, unrelated changes:
--
-- (a) OPTIONAL PROGRAM. `platform.university_applications.program_name`
--     (042:298-332) is `TEXT NOT NULL CHECK (btrim(program_name) <> '')`
--     and was never altered by any later migration (checked: grep for
--     `program_name` across every migration after 042 turns up only reads/
--     projections -- 052, 078, 089, 107, 112, 124, 127, 137, 145, 146, 169
--     -- and the two 118 create paths this migration edits; none of them
--     touch nullability). Dropping NOT NULL is enough on its own: for a
--     NULL value, `btrim(NULL) <> ''` evaluates to NULL, and PostgreSQL
--     CHECK constraints are satisfied by a NULL result (only FALSE
--     violates them) -- https://www.postgresql.org/docs/current/ddl-constraints.html
--     ("a check constraint is satisfied if the check expression evaluates
--     to true or the null value"). The existing CHECK is therefore already
--     tolerant of NULL; it is kept verbatim, unaltered.
--
--     The two create paths (`platform.create_university_application`,
--     `platform.create_catalog_university_application`) are thin
--     `SECURITY INVOKER` SQL wrappers (118:842-916) that only forward every
--     argument to a private `SECURITY DEFINER` implementation; they need no
--     change themselves. The private implementations --
--     `private.platform_create_university_application` (118:49-308) and
--     `private.platform_create_catalog_university_application`
--     (118:310-585) -- are `CREATE OR REPLACE`d here with the exact 118
--     body, signatures untouched, minus the "program is required" half of
--     their validation and with `''` normalized to `NULL` (matching how the
--     same functions already normalize evidence/note/country/degree via
--     `NULLIF(btrim(...), '')`).
--
--     LIVE-BODY CHECK (required by the slice brief): grepped migration 156
--     (`platform_scoped_staff_consumers`) and every migration 119-188 for
--     `platform_create_university_application` /
--     `platform_create_catalog_university_application` /
--     `platform_staff_application_snapshot` by name -- zero matches outside
--     118 itself. Neither create function nor the snapshot reader was ever
--     text-patched after 118; the on-disk 118 body IS the live body for all
--     three, and is reproduced here unmodified except for the program-name
--     edit described above.
--
-- (b) AUTHOR ATTRIBUTION. `university_applications.created_by_membership_id`
--     has existed since the table was created (042:298, `NOT NULL`, FK to
--     `organization_memberships` `ON DELETE RESTRICT` -- the referenced
--     membership row can never disappear out from under an application) but
--     the staff read projections never surfaced it. Per the slice brief,
--     the OLD RPCs (`platform.staff_application_page`,
--     `platform.staff_application_snapshot`, and their `private.platform_*`
--     implementations, all 118:1003-1293) are left completely untouched --
--     old application code keeps working unmodified between this migration
--     applying and the release that switches the TS layer over. Two NEW
--     functions are added instead: `platform.staff_application_page_v2` and
--     `platform.staff_application_snapshot_v2` (plus their
--     `private.platform_*_v2` implementations), each the OLD projection's
--     column set plus `created_by_membership_id` and
--     `created_by_display_name`, via the same
--     `organization_memberships` -> `profiles` LEFT JOIN pattern already
--     used here for `current_curator_display_name` (118:1142-1146).
--
--     LIVE-BODY CHECK for the read side: grepped every migration 119-188 for
--     `platform_staff_application_page` by name. Migration 176
--     (`platform_docs_student_intake`, its `DO $readers$` block,
--     176:184-213) DOES text-patch the live catalog body of
--     `private.platform_staff_application_page` -- via
--     `pg_get_functiondef()` + `overlay()` -- turning its FIRST
--     `sales_membership`/`sales_profile` join pair from `JOIN` into
--     `LEFT JOIN`, so a case with no Sales owner still returns its
--     applications with a NULL `responsible_sales_display_name` instead of
--     being dropped from the page entirely. Migration 177
--     (`platform_public_student_applications`, its `DO $sales_projection$`
--     block, 177:211-232) re-derives the SAME live catalog body again and
--     only asserts that exact `LEFT JOIN` shape (`RAISE EXCEPTION
--     'student_application_sales_projection_source_drift'` on mismatch) --
--     it does not patch anything further. `private.platform_staff_
--     application_snapshot` (which only ever delegates to
--     `platform_staff_application_page`, 118:1187-1197) was never itself
--     patched by either migration. No migration after 177 touches either
--     function. The LIVE body of `private.platform_staff_application_page`
--     is therefore: the 118 text, with the first
--     `JOIN platform.organization_memberships AS sales_membership` and the
--     first `JOIN platform.profiles AS sales_profile` each turned into a
--     `LEFT JOIN`, and everything else byte-identical.
--
--     The new `_v2` functions below are written from THAT live body (not
--     from the stale on-disk 118 text) plus the new author join/columns --
--     using the on-disk 118 INNER-JOIN text for `_v2` would silently regress
--     it, dropping every application on a Sales-less case from the new
--     projection the TS layer is about to switch to. `created_by_
--     membership_id` is NOT NULL on the table and FK-protected, so it is
--     read straight off `application.created_by_membership_id` with no
--     join; only the display name needs the new LEFT JOIN (LEFT, not INNER,
--     matching the safety of the existing curator join -- never drop an
--     application row over a missing profile).
--
-- ============================================================

BEGIN;

-- --------------------------------------------------------------------------
-- (a) Optional program: DROP NOT NULL only. See header for why the existing
-- length/blank CHECK (042:298) already tolerates NULL and needs no ALTER.
-- --------------------------------------------------------------------------
ALTER TABLE platform.university_applications
  ALTER COLUMN program_name DROP NOT NULL;

COMMENT ON COLUMN platform.university_applications.program_name IS
  'OTH-4: nullable since 189 -- the case''s university selector may set the '
  'program now or leave it for later (docs/EVO_OTHER_FABLE_PLAN_2026-09-19.md '
  '§«Uni & knowledge base»). The pre-existing CHECK (btrim(program_name) <> '''') '
  'is satisfied by NULL under standard PostgreSQL CHECK semantics and was not '
  'altered.';

-- --------------------------------------------------------------------------
-- (a) Both private create implementations, CREATE OR REPLACE, signatures
-- byte-identical to 118. Every line is the 118 body except:
--   - normalized_program_name := NULLIF(btrim(p_program_name), '') instead
--     of := btrim(p_program_name) (empty input now normalizes to NULL,
--     matching evidence/note/country/degree's existing convention);
--   - the "program is required" half of the big validation IF is replaced
--     with the same NULL-tolerant "IF present, validate length/control
--     chars" shape the country/degree/evidence/note checks already use two
--     lines below it.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.platform_create_university_application(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_institution_name TEXT,
  p_program_name TEXT,
  p_status platform.application_status,
  p_evidence_reference TEXT,
  p_note TEXT,
  p_is_primary BOOLEAN,
  p_university_deadline_on DATE,
  p_country TEXT,
  p_degree TEXT,
  p_expected_version BIGINT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  target_case platform.student_cases%ROWTYPE;
  previous_primary RECORD;
  created_application_id UUID := gen_random_uuid();
  normalized_institution_name TEXT := btrim(p_institution_name);
  normalized_program_name TEXT := NULLIF(btrim(p_program_name), '');
  normalized_evidence_reference TEXT := NULLIF(btrim(p_evidence_reference), '');
  normalized_note TEXT := NULLIF(btrim(p_note), '');
  normalized_country TEXT := NULLIF(btrim(p_country), '');
  normalized_degree TEXT := NULLIF(btrim(p_degree), '');
  replayed JSONB;
  replay_shape JSONB;
  result JSONB;
  audit_before JSONB;
  changed_at TIMESTAMPTZ;
  demoted_primary_application_id UUID;
  demoted_primary_application_previous_version BIGINT;
  demoted_primary_application_version BIGINT;
  fixed_reason CONSTANT TEXT := 'University application created';
BEGIN
  PERFORM platform_private.lock_p2d_request(p_request_id);

  IF p_expected_version IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'admissions_version_conflict'
      USING ERRCODE = 'PT409';
  END IF;
  IF p_organization_id IS NULL
    OR p_student_case_id IS NULL
    OR normalized_institution_name IS NULL
    OR normalized_institution_name = ''
    OR char_length(normalized_institution_name) > 300
    OR normalized_institution_name ~ '[[:cntrl:]]'
    OR (
      normalized_program_name IS NOT NULL
      AND (
        char_length(normalized_program_name) > 300
        OR normalized_program_name ~ '[[:cntrl:]]'
      )
    )
    OR p_status IS NULL
    OR p_is_primary IS NULL
    OR (
      p_university_deadline_on IS NOT NULL
      AND (
        NOT pg_catalog.isfinite(p_university_deadline_on)
        OR p_university_deadline_on < DATE '0001-01-01'
        OR p_university_deadline_on > DATE '9999-12-31'
      )
    )
    OR (
      normalized_country IS NOT NULL
      AND normalized_country NOT IN ('CN', 'MY', 'AE', 'TR', 'IT', 'CZ')
    )
    OR (
      normalized_degree IS NOT NULL
      AND (
        char_length(normalized_degree) > 160
        OR normalized_degree ~ '[[:cntrl:]]'
      )
    )
    OR (
      normalized_evidence_reference IS NOT NULL
      AND (
        char_length(normalized_evidence_reference) > 1000
        OR normalized_evidence_reference ~ '[[:cntrl:]]'
      )
    )
    OR (
      normalized_note IS NOT NULL
      AND (
        char_length(normalized_note) > 1000
        OR normalized_note ~ '[[:cntrl:]]'
      )
    )
    OR (
      platform_private.application_status_needs_evidence(p_status)
      AND normalized_evidence_reference IS NULL
    )
  THEN
    RAISE EXCEPTION
      'Application fields, geography, priority, deadline and required evidence are invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    p_student_case_id,
    'application.manage'
  );

  replay_shape := jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'institution_name', normalized_institution_name,
    'program_name', normalized_program_name,
    'status', p_status,
    'evidence_reference', normalized_evidence_reference,
    'note', normalized_note,
    'is_primary', p_is_primary,
    'university_deadline_on', p_university_deadline_on,
    'country', normalized_country,
    'degree', normalized_degree,
    'actor_membership_id', actor.actor_membership_id,
    'request_id', p_request_id,
    'expected_version', p_expected_version::TEXT
  );
  replayed := platform_private.replay_audit(
    p_request_id,
    'application.create',
    'university_application',
    NULL,
    fixed_reason,
    replay_shape
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  -- The case row serializes creates and details updates for one case. Every
  -- application row is then locked in UUID order before a primary switch.
  SELECT * INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student case is unavailable'
      USING ERRCODE = '42501';
  END IF;

  IF p_is_primary THEN
    PERFORM application.id
    FROM platform.university_applications AS application
    WHERE application.organization_id = p_organization_id
      AND application.student_case_id = p_student_case_id
    ORDER BY application.id
    FOR UPDATE;
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    p_student_case_id,
    'application.manage'
  );
  replay_shape := replay_shape || jsonb_build_object(
    'actor_membership_id', actor.actor_membership_id
  );
  replayed := platform_private.replay_audit(
    p_request_id,
    'application.create',
    'university_application',
    NULL,
    fixed_reason,
    replay_shape
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  IF p_is_primary THEN
    SELECT application.id, application.version
    INTO previous_primary
    FROM platform.university_applications AS application
    WHERE application.organization_id = p_organization_id
      AND application.student_case_id = p_student_case_id
      AND application.is_primary
    ORDER BY application.id
    LIMIT 1;

    IF FOUND THEN
      IF previous_primary.version = 9223372036854775807 THEN
        RAISE EXCEPTION 'admissions_version_conflict'
          USING ERRCODE = 'PT409';
      END IF;

      demoted_primary_application_id := previous_primary.id;
      demoted_primary_application_previous_version := previous_primary.version;
      UPDATE platform.university_applications AS application
      SET is_primary = FALSE,
          version = application.version + 1
      WHERE application.organization_id = p_organization_id
        AND application.id = previous_primary.id
      RETURNING application.version
      INTO demoted_primary_application_version;
    END IF;
  END IF;

  INSERT INTO platform.university_applications (
    id, organization_id, student_case_id, institution_name, program_name,
    status, latest_evidence_reference, created_by_membership_id, version,
    is_primary, university_deadline_on, country, degree
  ) VALUES (
    created_application_id, p_organization_id, p_student_case_id,
    normalized_institution_name, normalized_program_name, p_status,
    normalized_evidence_reference, actor.actor_membership_id, 1,
    p_is_primary, p_university_deadline_on, normalized_country,
    normalized_degree
  )
  RETURNING updated_at INTO changed_at;

  INSERT INTO platform.university_application_events (
    organization_id, application_id, student_case_id, previous_status,
    new_status, evidence_reference, note, actor_membership_id, request_id
  ) VALUES (
    p_organization_id, created_application_id, p_student_case_id, NULL,
    p_status, normalized_evidence_reference, normalized_note,
    actor.actor_membership_id, p_request_id
  );

  result := replay_shape || jsonb_build_object(
    'university_application_id', created_application_id,
    'version', 1::BIGINT::TEXT,
    'changed_at', changed_at,
    'demoted_primary_application_id', demoted_primary_application_id,
    'demoted_primary_application_version',
      demoted_primary_application_version::TEXT
  );
  IF demoted_primary_application_id IS NOT NULL THEN
    audit_before := jsonb_build_object(
      'demoted_primary_application_id', demoted_primary_application_id,
      'demoted_primary_application_version',
        demoted_primary_application_previous_version::TEXT,
      'demoted_primary_is_primary', TRUE
    );
  END IF;

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal, action,
    resource_type, resource_id, before_state, after_state, reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT, 'application.create',
    'university_application', created_application_id, audit_before, result,
    fixed_reason, p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION private.platform_create_catalog_university_application(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_catalog_institution_id UUID,
  p_program_name TEXT,
  p_status platform.application_status,
  p_evidence_reference TEXT,
  p_note TEXT,
  p_is_primary BOOLEAN,
  p_university_deadline_on DATE,
  p_country TEXT,
  p_degree TEXT,
  p_expected_version BIGINT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  target_case platform.student_cases%ROWTYPE;
  catalog_row platform.catalog_institutions%ROWTYPE;
  previous_primary RECORD;
  normalized_program_name TEXT := NULLIF(btrim(p_program_name), '');
  normalized_evidence_reference TEXT := NULLIF(btrim(p_evidence_reference), '');
  normalized_note TEXT := NULLIF(btrim(p_note), '');
  normalized_country TEXT := NULLIF(btrim(p_country), '');
  normalized_degree TEXT := NULLIF(btrim(p_degree), '');
  input_sha256 TEXT;
  replayed JSONB;
  replay_shape JSONB;
  created_application_id UUID := gen_random_uuid();
  result JSONB;
  audit_before JSONB;
  changed_at TIMESTAMPTZ;
  demoted_primary_application_id UUID;
  demoted_primary_application_previous_version BIGINT;
  demoted_primary_application_version BIGINT;
  fixed_reason CONSTANT TEXT :=
    'Catalog-backed university application created';
BEGIN
  PERFORM platform_private.lock_bw5_request(p_request_id);

  IF p_expected_version IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'admissions_version_conflict'
      USING ERRCODE = 'PT409';
  END IF;
  IF p_organization_id IS NULL
    OR p_student_case_id IS NULL
    OR p_catalog_institution_id IS NULL
    OR (
      normalized_program_name IS NOT NULL
      AND (
        char_length(normalized_program_name) > 300
        OR normalized_program_name ~ '[[:cntrl:]]'
      )
    )
    OR p_status IS NULL
    OR p_is_primary IS NULL
    OR (
      p_university_deadline_on IS NOT NULL
      AND (
        NOT pg_catalog.isfinite(p_university_deadline_on)
        OR p_university_deadline_on < DATE '0001-01-01'
        OR p_university_deadline_on > DATE '9999-12-31'
      )
    )
    OR (
      normalized_country IS NOT NULL
      AND normalized_country NOT IN ('CN', 'MY', 'AE', 'TR', 'IT', 'CZ')
    )
    OR (
      normalized_degree IS NOT NULL
      AND (
        char_length(normalized_degree) > 160
        OR normalized_degree ~ '[[:cntrl:]]'
      )
    )
    OR (
      normalized_evidence_reference IS NOT NULL
      AND (
        char_length(normalized_evidence_reference) > 1000
        OR normalized_evidence_reference ~ '[[:cntrl:]]'
      )
    )
    OR (
      normalized_note IS NOT NULL
      AND (
        char_length(normalized_note) > 1000
        OR normalized_note ~ '[[:cntrl:]]'
      )
    )
    OR (
      platform_private.application_status_needs_evidence(p_status)
      AND normalized_evidence_reference IS NULL
    )
  THEN
    RAISE EXCEPTION
      'Catalog application fields, geography, priority, deadline and evidence are invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    p_student_case_id,
    'application.manage'
  );

  input_sha256 := platform_private.bw5_input_sha256(jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'catalog_institution_id', p_catalog_institution_id,
    'program_name', normalized_program_name,
    'status', p_status,
    'evidence_reference', normalized_evidence_reference,
    'note', normalized_note,
    'is_primary', p_is_primary,
    'university_deadline_on', p_university_deadline_on,
    'country', normalized_country,
    'degree', normalized_degree
  ));
  replay_shape := jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'catalog_institution_id', p_catalog_institution_id,
    'program_name', normalized_program_name,
    'status', p_status,
    'evidence_reference', normalized_evidence_reference,
    'note', normalized_note,
    'is_primary', p_is_primary,
    'university_deadline_on', p_university_deadline_on,
    'country', normalized_country,
    'degree', normalized_degree,
    'actor_membership_id', actor.actor_membership_id,
    'input_sha256', input_sha256,
    'request_id', p_request_id,
    'expected_version', p_expected_version::TEXT
  );

  replayed := platform_private.replay_audit(
    p_request_id, 'application.create', 'university_application',
    NULL, fixed_reason, replay_shape
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT * INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student case is unavailable'
      USING ERRCODE = '42501';
  END IF;

  IF p_is_primary THEN
    PERFORM application.id
    FROM platform.university_applications AS application
    WHERE application.organization_id = p_organization_id
      AND application.student_case_id = p_student_case_id
    ORDER BY application.id
    FOR UPDATE;
  END IF;

  SELECT * INTO catalog_row
  FROM platform.catalog_institutions AS institution
  WHERE institution.organization_id = p_organization_id
    AND institution.id = p_catalog_institution_id
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approved catalog institution is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    p_student_case_id,
    'application.manage'
  );
  replay_shape := replay_shape || jsonb_build_object(
    'institution_name', catalog_row.institution_name,
    'actor_membership_id', actor.actor_membership_id
  );
  replayed := platform_private.replay_audit(
    p_request_id, 'application.create', 'university_application',
    NULL, fixed_reason, replay_shape
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  IF p_is_primary THEN
    SELECT application.id, application.version
    INTO previous_primary
    FROM platform.university_applications AS application
    WHERE application.organization_id = p_organization_id
      AND application.student_case_id = p_student_case_id
      AND application.is_primary
    ORDER BY application.id
    LIMIT 1;

    IF FOUND THEN
      IF previous_primary.version = 9223372036854775807 THEN
        RAISE EXCEPTION 'admissions_version_conflict'
          USING ERRCODE = 'PT409';
      END IF;

      demoted_primary_application_id := previous_primary.id;
      demoted_primary_application_previous_version := previous_primary.version;
      UPDATE platform.university_applications AS application
      SET is_primary = FALSE,
          version = application.version + 1
      WHERE application.organization_id = p_organization_id
        AND application.id = previous_primary.id
      RETURNING application.version
      INTO demoted_primary_application_version;
    END IF;
  END IF;

  INSERT INTO platform.university_applications (
    id, organization_id, student_case_id, catalog_institution_id,
    institution_name, program_name, status, latest_evidence_reference,
    created_by_membership_id, version, is_primary, university_deadline_on,
    country, degree
  ) VALUES (
    created_application_id, p_organization_id, p_student_case_id,
    p_catalog_institution_id, catalog_row.institution_name,
    normalized_program_name, p_status, normalized_evidence_reference,
    actor.actor_membership_id, 1, p_is_primary, p_university_deadline_on,
    normalized_country, normalized_degree
  )
  RETURNING updated_at INTO changed_at;

  INSERT INTO platform.university_application_events (
    organization_id, application_id, student_case_id, previous_status,
    new_status, evidence_reference, note, actor_membership_id, request_id
  ) VALUES (
    p_organization_id, created_application_id, p_student_case_id, NULL, p_status,
    normalized_evidence_reference, normalized_note,
    actor.actor_membership_id, p_request_id
  );

  result := replay_shape || jsonb_build_object(
    'university_application_id', created_application_id,
    'version', 1::BIGINT::TEXT,
    'changed_at', changed_at,
    'demoted_primary_application_id', demoted_primary_application_id,
    'demoted_primary_application_version',
      demoted_primary_application_version::TEXT
  );
  IF demoted_primary_application_id IS NOT NULL THEN
    audit_before := jsonb_build_object(
      'demoted_primary_application_id', demoted_primary_application_id,
      'demoted_primary_application_version',
        demoted_primary_application_previous_version::TEXT,
      'demoted_primary_is_primary', TRUE
    );
  END IF;

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal, action,
    resource_type, resource_id, before_state, after_state, reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT, 'application.create',
    'university_application', created_application_id, audit_before, result,
    fixed_reason, p_request_id
  );

  RETURN result;
END
$$;

-- Grants already exist on these two signatures from 118 and are untouched by
-- CREATE OR REPLACE.

-- --------------------------------------------------------------------------
-- (b) NEW author-attribution read RPCs. The old platform.staff_application_
-- page/snapshot and their private.platform_* implementations (118) are left
-- completely alone -- not one line below touches them.
-- --------------------------------------------------------------------------
CREATE FUNCTION private.platform_staff_application_page_v2(
  p_limit INTEGER,
  p_before_updated_at TIMESTAMPTZ DEFAULT NULL,
  p_before_application_id UUID DEFAULT NULL,
  p_status platform.application_status DEFAULT NULL,
  p_student_case_id UUID DEFAULT NULL,
  p_application_id UUID DEFAULT NULL
)
RETURNS TABLE (
  organization_id UUID,
  university_application_id UUID,
  version TEXT,
  student_case_id UUID,
  student_display_name TEXT,
  target_country TEXT,
  target_degree TEXT,
  program_direction TEXT,
  intake TEXT,
  institution_name TEXT,
  program_name TEXT,
  status platform.application_status,
  latest_evidence_reference TEXT,
  is_primary BOOLEAN,
  university_deadline_on DATE,
  country TEXT,
  degree TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  responsible_sales_display_name TEXT,
  current_curator_display_name TEXT,
  document_count BIGINT,
  open_document_count BIGINT,
  task_count BIGINT,
  open_task_count BIGINT,
  payment_obligation_count BIGINT,
  outstanding_payment_obligation_count BIGINT,
  created_by_membership_id UUID,
  created_by_display_name TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 101 THEN
    RAISE EXCEPTION 'Invalid page limit' USING ERRCODE = '22023';
  END IF;
  IF (p_before_updated_at IS NULL) <> (p_before_application_id IS NULL) THEN
    RAISE EXCEPTION 'Incomplete application cursor' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH page AS MATERIALIZED (
    SELECT application.*
    FROM platform.current_actor_authority() AS authority
    JOIN platform.university_applications AS application
      ON application.organization_id = authority.organization_id
    WHERE private.platform_can_read_student_case(
      application.organization_id,
      application.student_case_id
    )
      AND (p_status IS NULL OR application.status = p_status)
      AND (
        p_student_case_id IS NULL
        OR application.student_case_id = p_student_case_id
      )
      AND (p_application_id IS NULL OR application.id = p_application_id)
      AND (
        p_before_updated_at IS NULL
        OR (application.updated_at, application.id)
          < (p_before_updated_at, p_before_application_id)
      )
    ORDER BY application.updated_at DESC, application.id DESC
    LIMIT p_limit
  )
  SELECT
    application.organization_id,
    application.id,
    application.version::TEXT,
    application.student_case_id,
    student_case.student_display_name,
    student_case.target_country,
    student_case.target_degree,
    student_case.program_direction,
    student_case.intake,
    application.institution_name,
    application.program_name,
    application.status,
    application.latest_evidence_reference,
    application.is_primary,
    application.university_deadline_on,
    application.country,
    application.degree,
    application.created_at,
    application.updated_at,
    sales_profile.display_name,
    curator_profile.display_name,
    (
      SELECT count(*) FROM platform.document_slots AS slot
      WHERE slot.organization_id = application.organization_id
        AND slot.student_case_id = application.student_case_id
    ),
    (
      SELECT count(*) FROM platform.document_slots AS slot
      WHERE slot.organization_id = application.organization_id
        AND slot.student_case_id = application.student_case_id
        AND slot.status <> 'approved'
    ),
    (
      SELECT count(*) FROM platform.case_tasks AS task
      WHERE task.organization_id = application.organization_id
        AND task.student_case_id = application.student_case_id
    ),
    (
      SELECT count(*) FROM platform.case_tasks AS task
      WHERE task.organization_id = application.organization_id
        AND task.student_case_id = application.student_case_id
        AND task.status NOT IN ('done', 'cancelled')
    ),
    (
      SELECT count(*) FROM platform.payment_obligations AS obligation
      WHERE obligation.organization_id = application.organization_id
        AND obligation.student_case_id = application.student_case_id
    ),
    (
      SELECT count(*) FROM platform.payment_obligations AS obligation
      WHERE obligation.organization_id = application.organization_id
        AND obligation.student_case_id = application.student_case_id
        AND obligation.total_paid_minor - obligation.total_refunded_minor
          < obligation.amount_minor
    ),
    application.created_by_membership_id,
    created_by_profile.display_name
  FROM page AS application
  JOIN platform.student_cases AS student_case
    ON student_case.organization_id = application.organization_id
    AND student_case.id = application.student_case_id
  -- LEFT, not INNER: reproduces migration 176's live in-place patch of the
  -- OLD private.platform_staff_application_page (176:184-213) -- a case with
  -- no Sales owner must still surface its applications here, exactly as it
  -- already does through the old, still-live projection. See header (b).
  LEFT JOIN platform.organization_memberships AS sales_membership
    ON sales_membership.organization_id = student_case.organization_id
    AND sales_membership.id = student_case.responsible_sales_membership_id
  LEFT JOIN platform.profiles AS sales_profile
    ON sales_profile.id = sales_membership.profile_id
  LEFT JOIN platform.organization_memberships AS curator_membership
    ON curator_membership.organization_id = student_case.organization_id
    AND curator_membership.id = student_case.current_curator_membership_id
  LEFT JOIN platform.profiles AS curator_profile
    ON curator_profile.id = curator_membership.profile_id
  -- New for OTH-4: author attribution. created_by_membership_id is NOT NULL
  -- and FK-protected (ON DELETE RESTRICT, 042:298/318) so the membership row
  -- always exists; the join (and the profile join beyond it) stays LEFT so a
  -- missing/edge-case profile can never drop an application row, matching
  -- the curator join's own safety margin above.
  LEFT JOIN platform.organization_memberships AS created_by_membership
    ON created_by_membership.organization_id = application.organization_id
    AND created_by_membership.id = application.created_by_membership_id
  LEFT JOIN platform.profiles AS created_by_profile
    ON created_by_profile.id = created_by_membership.profile_id
  ORDER BY application.updated_at DESC, application.id DESC;
END
$$;

CREATE FUNCTION private.platform_staff_application_snapshot_v2(
  p_university_application_id UUID
)
RETURNS TABLE (
  organization_id UUID,
  university_application_id UUID,
  version TEXT,
  student_case_id UUID,
  student_display_name TEXT,
  target_country TEXT,
  target_degree TEXT,
  program_direction TEXT,
  intake TEXT,
  institution_name TEXT,
  program_name TEXT,
  status platform.application_status,
  latest_evidence_reference TEXT,
  is_primary BOOLEAN,
  university_deadline_on DATE,
  country TEXT,
  degree TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  responsible_sales_display_name TEXT,
  current_curator_display_name TEXT,
  document_count BIGINT,
  open_document_count BIGINT,
  task_count BIGINT,
  open_task_count BIGINT,
  payment_obligation_count BIGINT,
  outstanding_payment_obligation_count BIGINT,
  created_by_membership_id UUID,
  created_by_display_name TEXT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT page.*
  FROM private.platform_staff_application_page_v2(
    1,
    NULL,
    NULL,
    NULL,
    NULL,
    p_university_application_id
  ) AS page
$$;

CREATE FUNCTION platform.staff_application_page_v2(
  p_limit INTEGER,
  p_before_updated_at TIMESTAMPTZ DEFAULT NULL,
  p_before_application_id UUID DEFAULT NULL,
  p_status platform.application_status DEFAULT NULL,
  p_student_case_id UUID DEFAULT NULL,
  p_application_id UUID DEFAULT NULL
)
RETURNS TABLE (
  organization_id UUID,
  university_application_id UUID,
  version TEXT,
  student_case_id UUID,
  student_display_name TEXT,
  target_country TEXT,
  target_degree TEXT,
  program_direction TEXT,
  intake TEXT,
  institution_name TEXT,
  program_name TEXT,
  status platform.application_status,
  latest_evidence_reference TEXT,
  is_primary BOOLEAN,
  university_deadline_on DATE,
  country TEXT,
  degree TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  responsible_sales_display_name TEXT,
  current_curator_display_name TEXT,
  document_count BIGINT,
  open_document_count BIGINT,
  task_count BIGINT,
  open_task_count BIGINT,
  payment_obligation_count BIGINT,
  outstanding_payment_obligation_count BIGINT,
  created_by_membership_id UUID,
  created_by_display_name TEXT
)
LANGUAGE SQL
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT page.*
  FROM private.platform_staff_application_page_v2(
    p_limit,
    p_before_updated_at,
    p_before_application_id,
    p_status,
    p_student_case_id,
    p_application_id
  ) AS page
$$;

CREATE FUNCTION platform.staff_application_snapshot_v2(
  p_university_application_id UUID
)
RETURNS TABLE (
  organization_id UUID,
  university_application_id UUID,
  version TEXT,
  student_case_id UUID,
  student_display_name TEXT,
  target_country TEXT,
  target_degree TEXT,
  program_direction TEXT,
  intake TEXT,
  institution_name TEXT,
  program_name TEXT,
  status platform.application_status,
  latest_evidence_reference TEXT,
  is_primary BOOLEAN,
  university_deadline_on DATE,
  country TEXT,
  degree TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  responsible_sales_display_name TEXT,
  current_curator_display_name TEXT,
  document_count BIGINT,
  open_document_count BIGINT,
  task_count BIGINT,
  open_task_count BIGINT,
  payment_obligation_count BIGINT,
  outstanding_payment_obligation_count BIGINT,
  created_by_membership_id UUID,
  created_by_display_name TEXT
)
LANGUAGE SQL
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT snapshot.*
  FROM private.platform_staff_application_snapshot_v2(
    p_university_application_id
  ) AS snapshot
$$;

REVOKE ALL ON FUNCTION private.platform_staff_application_page_v2(
  INTEGER, TIMESTAMPTZ, UUID, platform.application_status, UUID, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.platform_staff_application_page_v2(
  INTEGER, TIMESTAMPTZ, UUID, platform.application_status, UUID, UUID
) TO authenticated;
REVOKE ALL ON FUNCTION private.platform_staff_application_snapshot_v2(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.platform_staff_application_snapshot_v2(UUID)
  TO authenticated;

REVOKE ALL ON FUNCTION platform.staff_application_page_v2(
  INTEGER, TIMESTAMPTZ, UUID, platform.application_status, UUID, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_application_page_v2(
  INTEGER, TIMESTAMPTZ, UUID, platform.application_status, UUID, UUID
) TO authenticated;
REVOKE ALL ON FUNCTION platform.staff_application_snapshot_v2(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_application_snapshot_v2(UUID)
  TO authenticated;

COMMENT ON FUNCTION platform.staff_application_page_v2(
  INTEGER, TIMESTAMPTZ, UUID, platform.application_status, UUID, UUID
) IS
  'OTH-4: platform.staff_application_page + created_by_membership_id/created_by_display_name. '
  'The old platform.staff_application_page (118) is untouched and stays live for old app code.';
COMMENT ON FUNCTION platform.staff_application_snapshot_v2(UUID) IS
  'OTH-4: platform.staff_application_snapshot + created_by_membership_id/created_by_display_name. '
  'The old platform.staff_application_snapshot (118) is untouched and stays live for old app code.';

COMMIT;
