-- Дописать и закрыть дела прямого импорта (поручение владельца 17.10.2026).
-- docs/PLAN_CHANGES.md «2026-10-17 · Поступление: дописать и закрыть
-- импортированные дела (миграция 287, запись до кода)».
--
-- Forward-only and additive: one table, two helper functions and one
-- client-facing function; nothing existing is replaced (the migration 281
-- objects it reuses are only read and called). SECURITY DEFINER with the empty
-- search_path throughout; the one callable function lives in `platform`.
--
-- Why: migration 281 imports a person once and never applies a later row to the
-- same case (the same external reference replays its receipt). The owner asked
-- on 17.10.2026 to complete 24 already imported cases with amoCRM data (amoCRM
-- is the truth, the stage and the curator included) and to close the students
-- that finished successfully. This is the same service-only boundary and the
-- same actor (the owner's Admin membership), for cases that already exist.
--
--  a) platform_private.admissions_direct_case_updates: the idempotency receipt
--     of one update (organization, update source, external reference) with the
--     fingerprint of what was sent, the result returned and the before_state:
--     the previous values of exactly the parts the call changed (client name,
--     phone and e-mail, birth date, the анкета fields touched, route and
--     education, board stage and position version, curator, the case state
--     before the closing), kept for a rollback. Append-only, forced RLS, no
--     client grant (like 281's receipts); the before_state is never returned by
--     the function and never written to platform.audit_events.
--  b) platform_private.admissions_direct_update_object: a strict key check that
--     names the offending key (281's helper names the object).
--  c) platform.update_admissions_direct_case_v1 (service_role only, no user JWT):
--     for a case created by the direct IMPORT (a receipt with an import source)
--     it overwrites the student's contact data, parents, education, route, the
--     board stage and the curator with what the payload carries (an absent,
--     null or blank value changes nothing), binds the amoCRM lead id, adds a
--     case note and, last, closes the case. One call is one transaction. A
--     phone or e-mail that already belongs to ANOTHER client is not written and
--     is reported as contact_conflict (no personal data in the report); the
--     other parts apply. Money (cost, tranches, payments) is not accepted: this
--     function never touches finance.
--  d) Journal: every change writes platform.audit_events with the principal
--     `service:admissions-import`, the Admin actor's profile and the reason of
--     the call, request ids derived from the call (the 281 pattern). Existing
--     P7A actions are reused (student.profile.upsert, case.route.change,
--     case.pipeline.move, note.create, case.lifecycle.change; the curator row
--     case.curator.set is written by the shared e1 as auth:<Admin>, exactly as
--     in 281). One new action, lead.amocrm.link, is written for the amoCRM
--     binding; it is not in the Admin journal allowlist (no existing action
--     fits), so platform_private.p7a_safe_audit_actions and
--     src/lib/platform-audit.ts stay untouched in this slice.
BEGIN;

-- ---------------------------------------------------------------------------
-- Anchors: the objects this migration reuses are the live 281 / 246 / 251
-- definitions (fail before creating anything if a later migration moved them).
-- ---------------------------------------------------------------------------
DO $a287_anchor$
BEGIN
  IF to_regprocedure('platform_private.admissions_direct_text(jsonb,text,integer,boolean)') IS NULL
    OR to_regprocedure('platform_private.admissions_direct_phone(text)') IS NULL
    OR to_regprocedure('platform_private.admissions_direct_phone_keys(text)') IS NULL
    OR to_regprocedure('platform_private.admissions_direct_date(jsonb,text,date,date,text)') IS NULL
    OR to_regprocedure('platform_private.admissions_direct_actor_may_name(uuid,uuid,uuid,text)') IS NULL
    OR to_regclass('platform_private.admissions_direct_case_receipts') IS NULL
    OR to_regprocedure('platform_private.assign_student_case_curator_authorized_e1(uuid,uuid,uuid,text,uuid,uuid,uuid,uuid)') IS NULL
    OR to_regprocedure('platform_private.lock_student_case_note_assignment_domain(uuid)') IS NULL
    OR to_regprocedure('platform_private.lock_external_identity(uuid,text,text,text)') IS NULL
    OR to_regprocedure('platform_private.staff_membership_identity(uuid,uuid)') IS NULL
    OR to_regprocedure('platform_private.staff_can_access(uuid,uuid,text,text,uuid)') IS NULL
    -- 246: a case moves only active -> closed (never pending -> closed).
    OR strpos(pg_get_functiondef('platform_private.guard_student_case_transition()'::regprocedure),
      $q$OR (OLD.state = 'active' AND NEW.state = 'closed')$q$) = 0
    -- 251: the server owns the board position counter.
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
      WHERE t.tgrelid = 'platform.student_cases'::regclass AND t.tgname = 'student_cases_pipeline_version'
        AND NOT t.tgisinternal)
    -- 281: the direct origin and its receipts carry the import provenance.
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'platform_private' AND c.table_name = 'admissions_direct_case_receipts'
        AND c.column_name = 'import_source')
  THEN
    RAISE EXCEPTION 'a287_anchor_drift';
  END IF;
END
$a287_anchor$;

-- ---------------------------------------------------------------------------
-- a) The receipt of one update (idempotency by source and external reference)
-- ---------------------------------------------------------------------------
CREATE TABLE platform_private.admissions_direct_case_updates (
  organization_id UUID NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  update_source TEXT NOT NULL CHECK (update_source ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  external_ref TEXT NOT NULL CHECK (char_length(external_ref) BETWEEN 1 AND 200 AND external_ref !~ '[[:cntrl:]]'),
  student_case_id UUID NOT NULL,
  actor_membership_id UUID NOT NULL,
  payload_md5 TEXT NOT NULL CHECK (payload_md5 ~ '^[0-9a-f]{32}$'),
  result JSONB NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  -- The previous values of what the call changed ('{}' when it changed nothing).
  before_state JSONB NOT NULL CHECK (jsonb_typeof(before_state) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (organization_id, update_source, external_ref),
  FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, actor_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX admissions_direct_case_updates_case_idx
  ON platform_private.admissions_direct_case_updates (organization_id, student_case_id, created_at);
ALTER TABLE platform_private.admissions_direct_case_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.admissions_direct_case_updates FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE platform_private.admissions_direct_case_updates
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
CREATE TRIGGER admissions_direct_case_updates_append_only
  BEFORE UPDATE OR DELETE ON platform_private.admissions_direct_case_updates
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER admissions_direct_case_updates_no_truncate
  BEFORE TRUNCATE ON platform_private.admissions_direct_case_updates
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
COMMENT ON TABLE platform_private.admissions_direct_case_updates IS
  'Migration 287: one row per accepted update_admissions_direct_case_v1 call (idempotency by organization, update source and external reference; fingerprint, result and the before_state with the previous values of what the call changed, for a rollback). Backend only, append-only.';

-- ---------------------------------------------------------------------------
-- b) Strict keys, naming the offending key
-- ---------------------------------------------------------------------------
-- An object (or absent/null) whose keys are all in p_allowed. The refusal
-- names the first offending key (sorted), so a forbidden key such as `country`
-- or `payments` is reported by its own name; a key that is not a plain word
-- is reported as the object (nothing a caller typed is echoed back).
CREATE FUNCTION platform_private.admissions_direct_update_object(p_value JSONB, p_label TEXT, p_allowed TEXT[])
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE offending TEXT;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) = 'null' THEN RETURN NULL; END IF;
  IF jsonb_typeof(p_value) <> 'object' THEN
    RAISE EXCEPTION 'admissions_direct_invalid:%', p_label USING ERRCODE = '22023';
  END IF;
  SELECT min(k) INTO offending FROM jsonb_object_keys(p_value) k WHERE NOT (k = ANY (p_allowed));
  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'admissions_direct_invalid:%',
      CASE WHEN offending ~ '^[A-Za-z][A-Za-z0-9_]{0,39}$' THEN offending ELSE p_label END
      USING ERRCODE = '22023';
  END IF;
  RETURN p_value;
END $$;
REVOKE ALL ON FUNCTION platform_private.admissions_direct_update_object(JSONB, TEXT, TEXT[])
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- c) The service-only update
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.update_admissions_direct_case_v1(
  p_organization_id UUID, p_actor_membership_id UUID, p_student_case_id UUID,
  p_update_source TEXT, p_external_ref TEXT, p_payload JSONB, p_reason TEXT
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  ref TEXT := btrim(p_external_ref);
  today DATE := (statement_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE;
  stages CONSTANT TEXT[] := ARRAY['new', 'shortlist', 'documents', 'ready_to_submit', 'awaiting_decision',
    'confirmed', 'visa', 'predeparture', 'arrived'];
  space_chars CONSTANT TEXT :=
    U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
  principal CONSTANT TEXT := 'service:admissions-import';
  actor RECORD;
  base_request UUID;
  request_fingerprint TEXT;
  prior platform_private.admissions_direct_case_updates%ROWTYPE;
  receipt platform_private.admissions_direct_case_receipts%ROWTYPE;
  case_row platform.student_cases%ROWTYPE;
  client_row platform.clients%ROWTYPE;
  profile_row platform.student_profiles%ROWTYPE;
  -- parsed payload
  payload JSONB; student JSONB; parents JSONB; mother JSONB; father JSONB; education JSONB; route JSONB; close_spec JSONB;
  first_name TEXT; last_name TEXT; explicit_name TEXT; phone_raw TEXT; phone_norm TEXT; email_raw TEXT; email_norm TEXT;
  birth_date DATE;
  mother_first TEXT; mother_last TEXT; mother_phone_raw TEXT; mother_phone TEXT;
  father_first TEXT; father_last TEXT; father_phone_raw TEXT; father_phone TEXT;
  education_current TEXT; english_text TEXT; chinese_text TEXT;
  degree_text TEXT; program_text TEXT; intake_text TEXT;
  stage TEXT; curator UUID; curator_raw TEXT; amo_id TEXT; note_text TEXT; note_body TEXT;
  close_outcome TEXT; close_note TEXT;
  phone_keys TEXT[] := ARRAY[]::TEXT[];
  profile_values JSONB := '[]'::JSONB;
  field RECORD; field_value TEXT; lock_value TEXT;
  -- state of the apply phase
  contact_conflicts JSONB := '[]'::JSONB;
  phone_blocked BOOLEAN := FALSE; email_blocked BOOLEAN := FALSE;
  other_client UUID;
  current_first TEXT; current_last TEXT; norm_first TEXT; norm_last TEXT; current_english TEXT; current_chinese TEXT; current_value TEXT; current_review TEXT; current_rev BIGINT; field_found BOOLEAN;
  new_display TEXT; new_language TEXT; new_education TEXT; new_preferred TEXT; new_birth DATE;
  next_revision BIGINT; profile_changed BOOLEAN := FALSE;
  student_names TEXT[] := ARRAY[]::TEXT[]; parent_names TEXT[] := ARRAY[]::TEXT[];
  education_names TEXT[] := ARRAY[]::TEXT[]; route_names TEXT[] := ARRAY[]::TEXT[];
  case_route_names TEXT[] := ARRAY[]::TEXT[]; profile_audit_names TEXT[] := ARRAY[]::TEXT[];
  new_client_name TEXT; new_client_phone TEXT; new_client_email TEXT; client_changed BOOLEAN;
  new_degree TEXT; new_program TEXT; new_intake TEXT; new_assumption TEXT; new_case_name TEXT;
  changed_parts TEXT[] := ARRAY[]::TEXT[];
  stage_before TEXT; hidden_before BOOLEAN;
  ext platform.external_identifiers%ROWTYPE;
  observed CONSTANT TIMESTAMPTZ := statement_timestamp();
  note_id UUID;
  closed_case platform.student_cases%ROWTYPE;
  playbook_outcome TEXT;
  closed_now BOOLEAN := FALSE; already_closed BOOLEAN := FALSE;
  before JSONB := '{}'::JSONB;
  result JSONB;
BEGIN
  IF p_organization_id IS NULL OR p_actor_membership_id IS NULL OR p_student_case_id IS NULL THEN
    RAISE EXCEPTION 'admissions_direct_forbidden' USING ERRCODE = '42501';
  END IF;
  -- Service path only: no end-user identity may reach it (the grants already
  -- exclude anon and authenticated).
  IF NULLIF(current_setting('request.jwt.claims', TRUE), '')::JSONB ->> 'sub' IS NOT NULL
    OR COALESCE(NULLIF(current_setting('request.jwt.claims', TRUE), '')::JSONB ->> 'role', '') IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'admissions_direct_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_update_source IS NULL OR p_update_source !~ '^[a-z][a-z0-9_.-]{1,63}$' THEN
    RAISE EXCEPTION 'admissions_direct_invalid:updateSource' USING ERRCODE = '22023';
  END IF;
  IF ref IS NULL OR char_length(ref) NOT BETWEEN 1 AND 200 OR ref ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'admissions_direct_invalid:externalRef' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 500 OR btrim(p_reason) ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'admissions_direct_invalid:reason' USING ERRCODE = '22023';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' OR pg_column_size(p_payload) > 40000 THEN
    RAISE EXCEPTION 'admissions_direct_invalid:payload' USING ERRCODE = '22023';
  END IF;

  -- The actor first: the owner's Admin membership (the import's actor), holding
  -- the permission the import checks.
  SELECT * INTO actor FROM platform_private.staff_membership_identity(p_organization_id, p_actor_membership_id);
  IF NOT FOUND OR actor.system_role IS DISTINCT FROM 'admin'
    OR NOT platform_private.staff_has_permission(p_organization_id, actor.membership_id, 'case.create.direct') THEN
    RAISE EXCEPTION 'admissions_direct_forbidden' USING ERRCODE = '42501';
  END IF;

  -- ---- payload (strict; every value in the form 281 gives it) ---------------------------
  payload := platform_private.admissions_direct_update_object(p_payload, 'payload',
    ARRAY['student', 'parents', 'education', 'route', 'pipelineStage', 'curatorMembershipId', 'amoLeadId', 'note', 'close']);
  student := platform_private.admissions_direct_update_object(payload -> 'student', 'student',
    ARRAY['firstName', 'lastName', 'name', 'phone', 'email', 'birthDate']);
  parents := platform_private.admissions_direct_update_object(payload -> 'parents', 'parents', ARRAY['mother', 'father']);
  mother := platform_private.admissions_direct_update_object(parents -> 'mother', 'mother', ARRAY['firstName', 'lastName', 'phone']);
  father := platform_private.admissions_direct_update_object(parents -> 'father', 'father', ARRAY['firstName', 'lastName', 'phone']);
  education := platform_private.admissions_direct_update_object(payload -> 'education', 'education', ARRAY['current', 'english', 'chinese']);
  route := platform_private.admissions_direct_update_object(payload -> 'route', 'route', ARRAY['degree', 'program', 'intake']);
  close_spec := platform_private.admissions_direct_update_object(payload -> 'close', 'close', ARRAY['outcome', 'note']);

  first_name := platform_private.admissions_direct_text(student, 'firstName', 60);
  last_name := platform_private.admissions_direct_text(student, 'lastName', 60);
  explicit_name := platform_private.admissions_direct_text(student, 'name', 200);
  phone_raw := platform_private.admissions_direct_text(student, 'phone', 40);
  IF phone_raw IS NOT NULL THEN
    phone_norm := platform_private.admissions_direct_phone(phone_raw);
    IF phone_norm IS NULL THEN
      RAISE EXCEPTION 'admissions_direct_invalid:phone' USING ERRCODE = '22023';
    END IF;
    phone_keys := platform_private.admissions_direct_phone_keys(phone_norm);
  END IF;
  email_raw := platform_private.admissions_direct_text(student, 'email', 120);
  IF email_raw IS NOT NULL THEN
    email_norm := platform_private.normalize_person_email(email_raw);
    IF email_norm IS NULL OR email_norm !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
      RAISE EXCEPTION 'admissions_direct_invalid:email' USING ERRCODE = '22023';
    END IF;
  END IF;
  birth_date := platform_private.admissions_direct_date(student, 'birthDate', DATE '1940-01-01', today, 'birthDate');

  mother_first := platform_private.admissions_direct_text(mother, 'firstName', 60);
  mother_last := platform_private.admissions_direct_text(mother, 'lastName', 60);
  mother_phone_raw := platform_private.admissions_direct_text(mother, 'phone', 40);
  IF mother_phone_raw IS NOT NULL THEN
    mother_phone := platform_private.admissions_direct_phone(mother_phone_raw);
    IF mother_phone IS NULL THEN RAISE EXCEPTION 'admissions_direct_invalid:motherPhone' USING ERRCODE = '22023'; END IF;
  END IF;
  father_first := platform_private.admissions_direct_text(father, 'firstName', 60);
  father_last := platform_private.admissions_direct_text(father, 'lastName', 60);
  father_phone_raw := platform_private.admissions_direct_text(father, 'phone', 40);
  IF father_phone_raw IS NOT NULL THEN
    father_phone := platform_private.admissions_direct_phone(father_phone_raw);
    IF father_phone IS NULL THEN RAISE EXCEPTION 'admissions_direct_invalid:fatherPhone' USING ERRCODE = '22023'; END IF;
  END IF;

  education_current := platform_private.admissions_direct_text(education, 'current', 100);
  english_text := platform_private.admissions_direct_text(education, 'english', 60);
  chinese_text := platform_private.admissions_direct_text(education, 'chinese', 40);
  degree_text := platform_private.admissions_direct_text(route, 'degree', 60);
  program_text := platform_private.admissions_direct_text(route, 'program', 100);
  intake_text := platform_private.admissions_direct_text(route, 'intake', 30);

  stage := platform_private.admissions_direct_text(payload, 'pipelineStage', 40);
  IF stage IS NOT NULL AND NOT (stage = ANY (stages)) THEN
    RAISE EXCEPTION 'admissions_direct_invalid:pipelineStage' USING ERRCODE = '22023';
  END IF;
  curator_raw := platform_private.admissions_direct_text(payload, 'curatorMembershipId', 36);
  IF curator_raw IS NOT NULL THEN
    IF curator_raw !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'admissions_direct_invalid:curator' USING ERRCODE = '22023';
    END IF;
    curator := curator_raw::UUID;
  END IF;
  IF payload ? 'amoLeadId' AND jsonb_typeof(payload -> 'amoLeadId') <> 'null' THEN
    IF jsonb_typeof(payload -> 'amoLeadId') NOT IN ('string', 'number') THEN
      RAISE EXCEPTION 'admissions_direct_invalid:amoLeadId' USING ERRCODE = '22023';
    END IF;
    amo_id := btrim(payload ->> 'amoLeadId');
    IF amo_id !~ '^[1-9][0-9]{0,19}$' THEN
      RAISE EXCEPTION 'admissions_direct_invalid:amoLeadId' USING ERRCODE = '22023';
    END IF;
  END IF;
  note_text := platform_private.admissions_direct_text(payload, 'note', 3500, TRUE);
  note_body := NULLIF(btrim(note_text, space_chars), '');

  IF close_spec IS NOT NULL THEN
    close_outcome := platform_private.admissions_direct_text(close_spec, 'outcome', 20);
    IF close_outcome IS NULL OR close_outcome NOT IN ('enrolled', 'declined', 'not_admitted', 'other') THEN
      RAISE EXCEPTION 'admissions_direct_invalid:outcome' USING ERRCODE = '22023';
    END IF;
    -- 246: «other» carries its one-line reason, the other outcomes carry none.
    IF close_spec ? 'note' AND jsonb_typeof(close_spec -> 'note') <> 'null' THEN
      IF jsonb_typeof(close_spec -> 'note') <> 'string' THEN
        RAISE EXCEPTION 'admissions_direct_invalid:closeNote' USING ERRCODE = '22023';
      END IF;
      close_note := NULLIF(btrim(close_spec ->> 'note', space_chars), '');
    END IF;
    IF (close_outcome = 'other' AND close_note IS NULL)
      OR (close_outcome <> 'other' AND close_note IS NOT NULL)
      OR char_length(close_note) > 500
      OR close_note ~ U&'[\0001-\001F\007F-\009F\2028\2029]' THEN
      RAISE EXCEPTION 'admissions_direct_invalid:closeNote' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- The fields of the анкета, in the form the анкета itself stores
  -- (normalize_student_profile_field_value, the rule of every анкета write).
  FOR field IN SELECT * FROM (VALUES
    ('student_first_name', first_name, 'firstName'), ('student_last_name', last_name, 'lastName'),
    ('mobile_phone', phone_norm, 'phone'), ('student_email', email_raw, 'email'),
    ('current_study_status', education_current, 'current'), ('english_level', english_text, 'english'),
    ('chinese_level_hsk', chinese_text, 'chinese'),
    ('program_level', degree_text, 'degree'), ('field_major', program_text, 'program'),
    ('mother_first_name', mother_first, 'motherFirstName'), ('mother_last_name', mother_last, 'motherLastName'),
    ('mother_mobile_phone', mother_phone, 'motherPhone'),
    ('father_first_name', father_first, 'fatherFirstName'), ('father_last_name', father_last, 'fatherLastName'),
    ('father_mobile_phone', father_phone, 'fatherPhone')
  ) AS fields(key, value, label)
  WHERE fields.value IS NOT NULL LOOP
    BEGIN
      field_value := platform_private.normalize_student_profile_field_value(field.key, field.value);
    EXCEPTION WHEN invalid_parameter_value THEN
      RAISE EXCEPTION 'admissions_direct_invalid:%', field.label USING ERRCODE = '22023';
    END;
    profile_values := profile_values || jsonb_build_array(jsonb_build_object('key', field.key, 'value', field_value));
  END LOOP;

  -- ---- one call, one request: locks, replay ------------------------------------------
  base_request := public.uuid_generate_v5('6ba7b811-9dad-11d1-80b4-00c04fd430c8'::UUID,
    'evo:admissions-direct-update:' || p_organization_id::TEXT || ':' || p_update_source || ':' || ref);
  -- The order of the case commands (246/117): the organization's case domain,
  -- the request, then the case row.
  PERFORM platform_private.lock_student_case_note_assignment_domain(p_organization_id);
  PERFORM platform_private.lock_p2d_request(base_request);
  request_fingerprint := md5(jsonb_build_object('studentCaseId', p_student_case_id, 'payload', p_payload,
    'reason', btrim(p_reason), 'actor', p_actor_membership_id)::TEXT);
  SELECT * INTO prior FROM platform_private.admissions_direct_case_updates u
  WHERE u.organization_id = p_organization_id AND u.update_source = p_update_source AND u.external_ref = ref;
  IF FOUND THEN
    IF prior.payload_md5 <> request_fingerprint THEN
      RAISE EXCEPTION 'admissions_direct_update_conflict' USING ERRCODE = 'PT409';
    END IF;
    RETURN prior.result || jsonb_build_object('replayed', TRUE);
  END IF;

  -- ---- only a case the IMPORT created ---------------------------------------------------
  SELECT * INTO receipt FROM platform_private.admissions_direct_case_receipts r
  WHERE r.organization_id = p_organization_id AND r.student_case_id = p_student_case_id AND r.import_source IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admissions_direct_update_not_imported_case' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO case_row FROM platform.student_cases c
  WHERE c.organization_id = p_organization_id AND c.id = p_student_case_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admissions_direct_update_not_imported_case' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO profile_row FROM platform.student_profiles p
  WHERE p.organization_id = p_organization_id AND p.student_case_id = p_student_case_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admissions_direct_update_profile_missing' USING ERRCODE = '55000';
  END IF;
  next_revision := profile_row.revision + 1;

  -- ---- student: contacts, name, birth date --------------------------------------------------
  -- The contact locks of 281 and of the manual sales lead (143), in the same
  -- sorted order: a lead or a case created for the same contact serializes.
  FOR lock_value IN SELECT DISTINCT v FROM unnest(phone_keys || ARRAY[email_norm]) v WHERE v IS NOT NULL ORDER BY v LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('manual-lead-contact:' || p_organization_id::TEXT || ':' || lock_value, 0));
  END LOOP;
  SELECT * INTO client_row FROM platform.clients cl
  WHERE cl.organization_id = p_organization_id AND cl.id = case_row.canonical_client_id FOR UPDATE;
  IF NOT FOUND OR client_row.lifecycle_state <> 'active' THEN
    RAISE EXCEPTION 'admissions_direct_update_client_not_active' USING ERRCODE = '55000';
  END IF;
  IF phone_norm IS NOT NULL OR email_norm IS NOT NULL OR first_name IS NOT NULL OR last_name IS NOT NULL
    OR explicit_name IS NOT NULL OR birth_date IS NOT NULL THEN
    IF NOT platform_private.staff_can_access(p_organization_id, actor.membership_id, 'profile.manage', 'student_case', p_student_case_id) THEN
      RAISE EXCEPTION 'admissions_direct_forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- A number that already belongs to ANOTHER active client is not written;
  -- it is reported (no personal data) and the other parts still apply.
  IF phone_norm IS NOT NULL AND client_row.normalized_phone IS DISTINCT FROM phone_norm THEN
    SELECT cl.id INTO other_client FROM platform.clients cl
    WHERE cl.organization_id = p_organization_id AND cl.lifecycle_state = 'active' AND cl.id <> client_row.id
      AND cl.normalized_phone = ANY (phone_keys)
    ORDER BY cl.created_at, cl.id LIMIT 1;
    IF FOUND THEN
      phone_blocked := TRUE;
      contact_conflicts := contact_conflicts || jsonb_build_array(jsonb_build_object('field', 'phone', 'other_client_id', other_client));
    END IF;
  END IF;
  IF email_norm IS NOT NULL AND client_row.normalized_email IS DISTINCT FROM email_norm THEN
    SELECT cl.id INTO other_client FROM platform.clients cl
    WHERE cl.organization_id = p_organization_id AND cl.lifecycle_state = 'active' AND cl.id <> client_row.id
      AND cl.normalized_email = email_norm
    ORDER BY cl.created_at, cl.id LIMIT 1;
    IF FOUND THEN
      email_blocked := TRUE;
      contact_conflicts := contact_conflicts || jsonb_build_array(jsonb_build_object('field', 'email', 'other_client_id', other_client));
    END IF;
  END IF;

  -- The display name: the full name when sent; else first and last name when
  -- both are known (one half alone never shortens a name that has both).
  SELECT f.value INTO current_first FROM platform.student_profile_fields f
  WHERE f.organization_id = p_organization_id AND f.student_profile_id = profile_row.id AND f.field_key = 'student_first_name';
  SELECT f.value INTO current_last FROM platform.student_profile_fields f
  WHERE f.organization_id = p_organization_id AND f.student_profile_id = profile_row.id AND f.field_key = 'student_last_name';
  -- Derived only when a name part really changes (the parts in their анкета form).
  SELECT f ->> 'value' INTO norm_first FROM jsonb_array_elements(profile_values) f WHERE f ->> 'key' = 'student_first_name';
  SELECT f ->> 'value' INTO norm_last FROM jsonb_array_elements(profile_values) f WHERE f ->> 'key' = 'student_last_name';
  new_display := COALESCE(explicit_name,
    CASE WHEN ((norm_first IS NOT NULL AND norm_first IS DISTINCT FROM current_first)
          OR (norm_last IS NOT NULL AND norm_last IS DISTINCT FROM current_last))
        AND COALESCE(norm_first, current_first) IS NOT NULL AND COALESCE(norm_last, current_last) IS NOT NULL
      THEN btrim(concat_ws(' ', COALESCE(norm_first, current_first), COALESCE(norm_last, current_last))) END);

  new_client_name := client_row.display_name;
  new_client_phone := client_row.normalized_phone;
  new_client_email := client_row.normalized_email;
  IF new_display IS NOT NULL AND new_display IS DISTINCT FROM client_row.display_name THEN
    new_client_name := new_display; student_names := array_append(student_names, 'client_display_name'::TEXT);
  END IF;
  IF phone_norm IS NOT NULL AND NOT phone_blocked AND client_row.normalized_phone IS DISTINCT FROM phone_norm THEN
    new_client_phone := phone_norm; student_names := array_append(student_names, 'client_phone'::TEXT);
  END IF;
  IF email_norm IS NOT NULL AND NOT email_blocked AND client_row.normalized_email IS DISTINCT FROM email_norm THEN
    new_client_email := email_norm; student_names := array_append(student_names, 'client_email'::TEXT);
  END IF;
  client_changed := new_client_name IS DISTINCT FROM client_row.display_name
    OR new_client_phone IS DISTINCT FROM client_row.normalized_phone
    OR new_client_email IS DISTINCT FROM client_row.normalized_email;
  IF client_changed THEN
    before := before || jsonb_build_object('client',
      CASE WHEN new_client_name IS DISTINCT FROM client_row.display_name
        THEN jsonb_build_object('display_name', client_row.display_name) ELSE '{}'::JSONB END
      || CASE WHEN new_client_phone IS DISTINCT FROM client_row.normalized_phone
        THEN jsonb_build_object('phone', client_row.phone, 'normalized_phone', client_row.normalized_phone) ELSE '{}'::JSONB END
      || CASE WHEN new_client_email IS DISTINCT FROM client_row.normalized_email
        THEN jsonb_build_object('email', client_row.email, 'normalized_email', client_row.normalized_email) ELSE '{}'::JSONB END);
    -- The stored spelling of a contact changes only with the contact itself.
    UPDATE platform.clients cl SET display_name = new_client_name,
      normalized_name = platform_private.normalize_person_name(new_client_name),
      phone = CASE WHEN new_client_phone IS DISTINCT FROM client_row.normalized_phone THEN new_client_phone ELSE cl.phone END,
      normalized_phone = new_client_phone,
      email = CASE WHEN new_client_email IS DISTINCT FROM client_row.normalized_email THEN btrim(email_raw) ELSE cl.email END,
      normalized_email = new_client_email
    WHERE cl.organization_id = p_organization_id AND cl.id = client_row.id;
  END IF;

  new_case_name := case_row.student_display_name;
  new_preferred := profile_row.preferred_display_name;
  IF new_display IS NOT NULL THEN
    IF new_display IS DISTINCT FROM case_row.student_display_name THEN
      new_case_name := new_display; student_names := array_append(student_names, 'student_display_name'::TEXT);
    END IF;
    IF left(new_display, 160) IS DISTINCT FROM profile_row.preferred_display_name THEN
      new_preferred := left(new_display, 160); student_names := array_append(student_names, 'preferred_display_name'::TEXT);
      profile_changed := TRUE;
    END IF;
  END IF;
  new_birth := profile_row.date_of_birth;
  IF birth_date IS NOT NULL AND birth_date IS DISTINCT FROM profile_row.date_of_birth THEN
    new_birth := birth_date; student_names := array_append(student_names, 'date_of_birth'::TEXT); profile_changed := TRUE;
    SELECT f.value, f.review_state, f.profile_revision INTO current_value, current_review, current_rev
    FROM platform.student_profile_fields f
    WHERE f.organization_id = p_organization_id AND f.student_profile_id = profile_row.id AND f.field_key = 'date_of_birth';
    field_found := FOUND;
    before := jsonb_set(before, '{fields}', COALESCE(before -> 'fields', '{}'::JSONB) || jsonb_build_object('date_of_birth',
      jsonb_build_object('existed', field_found, 'value', current_value, 'review_state', current_review,
        'profile_revision', current_rev)));
    INSERT INTO platform.student_profile_fields (organization_id, student_case_id, student_profile_id, field_key, value,
      review_state, profile_revision)
    VALUES (p_organization_id, p_student_case_id, profile_row.id, 'date_of_birth', NULL, 'needs_review', next_revision)
    ON CONFLICT (organization_id, student_profile_id, field_key) DO UPDATE SET review_state = 'needs_review',
      profile_revision = EXCLUDED.profile_revision, reviewed_at = NULL, reviewed_by_membership_id = NULL,
      updated_at = clock_timestamp();
  END IF;

  -- ---- education and route values that change the case ------------------------------------------
  new_education := profile_row.current_education_summary;
  IF education_current IS NOT NULL AND education_current IS DISTINCT FROM profile_row.current_education_summary THEN
    new_education := education_current; education_names := array_append(education_names, 'current_education_summary'::TEXT);
    profile_changed := TRUE;
  END IF;
  new_language := profile_row.language_summary;
  new_assumption := case_row.language_assumption;
  IF english_text IS NOT NULL OR chinese_text IS NOT NULL THEN
    SELECT f.value INTO current_english FROM platform.student_profile_fields f
    WHERE f.organization_id = p_organization_id AND f.student_profile_id = profile_row.id AND f.field_key = 'english_level';
    SELECT f.value INTO current_chinese FROM platform.student_profile_fields f
    WHERE f.organization_id = p_organization_id AND f.student_profile_id = profile_row.id AND f.field_key = 'chinese_level_hsk';
    new_language := COALESCE(NULLIF(concat_ws('; ', COALESCE(english_text, current_english), COALESCE(chinese_text, current_chinese)), ''),
      profile_row.language_summary);
    IF new_language IS DISTINCT FROM profile_row.language_summary THEN
      education_names := array_append(education_names, 'language_summary'::TEXT); profile_changed := TRUE;
    END IF;
    IF new_language IS DISTINCT FROM case_row.language_assumption THEN
      new_assumption := new_language; education_names := array_append(education_names, 'language_assumption'::TEXT);
      case_route_names := array_append(case_route_names, 'language_assumption'::TEXT);
    END IF;
  END IF;
  new_degree := case_row.target_degree; new_program := case_row.program_direction; new_intake := case_row.intake;
  IF degree_text IS NOT NULL AND degree_text IS DISTINCT FROM case_row.target_degree THEN
    new_degree := degree_text; case_route_names := array_append(case_route_names, 'target_degree'::TEXT);
  END IF;
  IF program_text IS NOT NULL AND program_text IS DISTINCT FROM case_row.program_direction THEN
    new_program := program_text; case_route_names := array_append(case_route_names, 'program_direction'::TEXT);
  END IF;
  IF intake_text IS NOT NULL AND intake_text IS DISTINCT FROM case_row.intake THEN
    new_intake := intake_text; case_route_names := array_append(case_route_names, 'intake'::TEXT);
  END IF;
  IF cardinality(case_route_names) > 0 THEN
    IF NOT platform_private.staff_can_access(p_organization_id, actor.membership_id, 'case.route.manage', 'student_case', p_student_case_id) THEN
      RAISE EXCEPTION 'admissions_direct_forbidden' USING ERRCODE = '42501';
    END IF;
    -- A case bound to an admissions playbook changes its route only through the
    -- versioned admissions command (137); a direct case has none.
    IF case_row.admissions_playbook_version_id IS NOT NULL THEN
      RAISE EXCEPTION 'admissions_direct_update_configured_case' USING ERRCODE = '55000';
    END IF;
  END IF;
  IF new_case_name IS DISTINCT FROM case_row.student_display_name OR cardinality(case_route_names) > 0 THEN
    before := before || jsonb_build_object('case',
      CASE WHEN new_case_name IS DISTINCT FROM case_row.student_display_name
        THEN jsonb_build_object('student_display_name', case_row.student_display_name) ELSE '{}'::JSONB END
      || CASE WHEN new_degree IS DISTINCT FROM case_row.target_degree
        THEN jsonb_build_object('target_degree', case_row.target_degree) ELSE '{}'::JSONB END
      || CASE WHEN new_program IS DISTINCT FROM case_row.program_direction
        THEN jsonb_build_object('program_direction', case_row.program_direction) ELSE '{}'::JSONB END
      || CASE WHEN new_intake IS DISTINCT FROM case_row.intake
        THEN jsonb_build_object('intake', case_row.intake) ELSE '{}'::JSONB END
      || CASE WHEN new_assumption IS DISTINCT FROM case_row.language_assumption
        THEN jsonb_build_object('language_assumption', case_row.language_assumption) ELSE '{}'::JSONB END);
    UPDATE platform.student_cases c SET student_display_name = new_case_name, target_degree = new_degree,
      program_direction = new_program, intake = new_intake, language_assumption = new_assumption
    WHERE c.organization_id = p_organization_id AND c.id = p_student_case_id;
  END IF;

  -- ---- the анкета fields (student, parents, education, route) ---------------------------------
  FOR field IN SELECT f ->> 'key' AS key, f ->> 'value' AS value FROM jsonb_array_elements(profile_values) f LOOP
    IF (field.key = 'mobile_phone' AND phone_blocked) OR (field.key = 'student_email' AND email_blocked) THEN CONTINUE; END IF;
    SELECT f.value, f.review_state, f.profile_revision INTO current_value, current_review, current_rev
    FROM platform.student_profile_fields f
    WHERE f.organization_id = p_organization_id AND f.student_profile_id = profile_row.id AND f.field_key = field.key;
    field_found := FOUND;
    IF field_found AND current_value IS NOT DISTINCT FROM field.value THEN CONTINUE; END IF;
    before := jsonb_set(before, '{fields}', COALESCE(before -> 'fields', '{}'::JSONB) || jsonb_build_object(field.key,
      jsonb_build_object('existed', field_found, 'value', current_value, 'review_state', current_review,
        'profile_revision', current_rev)));
    INSERT INTO platform.student_profile_fields (organization_id, student_case_id, student_profile_id, field_key, value,
      review_state, profile_revision)
    VALUES (p_organization_id, p_student_case_id, profile_row.id, field.key, field.value, 'needs_review', next_revision)
    ON CONFLICT (organization_id, student_profile_id, field_key) DO UPDATE SET value = EXCLUDED.value,
      review_state = 'needs_review', profile_revision = EXCLUDED.profile_revision, reviewed_at = NULL,
      reviewed_by_membership_id = NULL, source_document_version_id = NULL, source_document_slot_id = NULL,
      source_page = NULL, updated_at = clock_timestamp();
    profile_changed := TRUE;
    CASE
      WHEN field.key IN ('student_first_name', 'student_last_name', 'mobile_phone', 'student_email') THEN
        student_names := student_names || field.key;
      WHEN field.key LIKE 'mother\_%' OR field.key LIKE 'father\_%' THEN
        parent_names := parent_names || field.key;
      WHEN field.key IN ('current_study_status', 'english_level', 'chinese_level_hsk') THEN
        education_names := education_names || field.key;
      ELSE
        route_names := route_names || field.key;
    END CASE;
  END LOOP;
  IF profile_changed THEN
    before := before || jsonb_build_object('profile', jsonb_build_object('revision', profile_row.revision)
      || CASE WHEN new_preferred IS DISTINCT FROM profile_row.preferred_display_name
        THEN jsonb_build_object('preferred_display_name', profile_row.preferred_display_name) ELSE '{}'::JSONB END
      || CASE WHEN new_birth IS DISTINCT FROM profile_row.date_of_birth
        THEN jsonb_build_object('date_of_birth', profile_row.date_of_birth) ELSE '{}'::JSONB END
      || CASE WHEN new_education IS DISTINCT FROM profile_row.current_education_summary
        THEN jsonb_build_object('current_education_summary', profile_row.current_education_summary) ELSE '{}'::JSONB END
      || CASE WHEN new_language IS DISTINCT FROM profile_row.language_summary
        THEN jsonb_build_object('language_summary', profile_row.language_summary) ELSE '{}'::JSONB END);
    UPDATE platform.student_profiles p SET revision = next_revision, preferred_display_name = new_preferred,
      date_of_birth = new_birth, current_education_summary = new_education, language_summary = new_language,
      updated_by_membership_id = actor.membership_id, updated_at = clock_timestamp()
    WHERE p.organization_id = p_organization_id AND p.student_case_id = p_student_case_id;
    profile_audit_names := student_names || parent_names || array_remove(education_names, 'language_assumption') || route_names;
    INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal, actor_membership_id,
      action, resource_type, resource_id, before_state, after_state, reason, request_id)
    VALUES (p_organization_id, 'user', actor.profile_id, principal, actor.membership_id, 'student.profile.upsert',
      'student_profile', profile_row.id,
      jsonb_build_object('id', profile_row.id, 'revision', profile_row.revision),
      jsonb_build_object('student_profile_id', profile_row.id, 'student_case_id', p_student_case_id,
        'revision', next_revision, 'updated_field_names', to_jsonb(profile_audit_names)),
      btrim(p_reason), public.uuid_generate_v5(base_request, 'admissions-direct-update:profile'));
  ELSIF cardinality(student_names) > 0 THEN
    -- Contact or name changed on the client / the case only (the анкета is
    -- already equal): the journal still says what changed.
    INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal, actor_membership_id,
      action, resource_type, resource_id, before_state, after_state, reason, request_id)
    VALUES (p_organization_id, 'user', actor.profile_id, principal, actor.membership_id, 'student.profile.upsert',
      'student_profile', profile_row.id,
      jsonb_build_object('id', profile_row.id, 'revision', profile_row.revision),
      jsonb_build_object('student_profile_id', profile_row.id, 'student_case_id', p_student_case_id,
        'revision', profile_row.revision, 'updated_field_names', to_jsonb(student_names)),
      btrim(p_reason), public.uuid_generate_v5(base_request, 'admissions-direct-update:profile'));
  END IF;
  IF cardinality(case_route_names) > 0 THEN
    INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal, actor_membership_id,
      action, resource_type, resource_id, before_state, after_state, reason, request_id)
    VALUES (p_organization_id, 'user', actor.profile_id, principal, actor.membership_id, 'case.route.change',
      'student_case', p_student_case_id,
      NULL, jsonb_build_object('organization_id', p_organization_id, 'student_case_id', p_student_case_id,
        'updated_field_names', to_jsonb(case_route_names)),
      btrim(p_reason), public.uuid_generate_v5(base_request, 'admissions-direct-update:route'));
  END IF;
  IF cardinality(student_names) > 0 THEN changed_parts := array_append(changed_parts, 'student'::TEXT); END IF;
  IF cardinality(parent_names) > 0 THEN changed_parts := array_append(changed_parts, 'parents'::TEXT); END IF;
  IF cardinality(education_names) > 0 THEN changed_parts := array_append(changed_parts, 'education'::TEXT); END IF;
  IF cardinality(route_names) > 0 OR cardinality(array_remove(case_route_names, 'language_assumption')) > 0 THEN
    changed_parts := array_append(changed_parts, 'route'::TEXT);
  END IF;

  -- ---- curator ------------------------------------------------------------------------------------
  SELECT * INTO case_row FROM platform.student_cases c WHERE c.organization_id = p_organization_id AND c.id = p_student_case_id;
  IF curator IS NOT NULL AND curator IS DISTINCT FROM case_row.current_curator_membership_id THEN
    -- 281's rule for the future owner, then the eligibility 281 checks.
    IF NOT platform_private.admissions_direct_actor_may_name(p_organization_id, actor.membership_id, curator,
        case_row.admissions_direction) THEN
      RAISE EXCEPTION 'admissions_direct_curator_forbidden' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM platform_private.staff_membership_identity(p_organization_id, curator))
      OR NOT platform_private.is_eligible_staff_responsibility(p_organization_id, curator, 'curator') THEN
      RAISE EXCEPTION 'admissions_direct_invalid:curator' USING ERRCODE = '22023';
    END IF;
    before := before || jsonb_build_object('curator', jsonb_build_object(
      'current_curator_membership_id', case_row.current_curator_membership_id, 'state', case_row.state::TEXT));
    PERFORM platform_private.assign_student_case_curator_authorized_e1(p_organization_id, p_student_case_id, curator,
      btrim(p_reason), public.uuid_generate_v5(base_request, 'admissions-direct-update:assign'),
      actor.profile_id, actor.membership_id, actor.auth_user_id);
    changed_parts := array_append(changed_parts, 'curatorMembershipId'::TEXT);
    SELECT * INTO case_row FROM platform.student_cases c WHERE c.organization_id = p_organization_id AND c.id = p_student_case_id;
  END IF;

  -- ---- board stage (move_case_pipeline_v2 without the user authority) ---------------------------------
  IF stage IS NOT NULL AND stage IS DISTINCT FROM case_row.pipeline_stage THEN
    IF case_row.state NOT IN ('pending', 'active') THEN
      RAISE EXCEPTION 'admissions_direct_update_case_closed' USING ERRCODE = '55000';
    END IF;
    IF NOT platform_private.staff_can_access(p_organization_id, actor.membership_id, 'case.update.append', 'student_case', p_student_case_id) THEN
      RAISE EXCEPTION 'admissions_direct_forbidden' USING ERRCODE = '42501';
    END IF;
    stage_before := case_row.pipeline_stage; hidden_before := case_row.pipeline_hidden_at IS NOT NULL;
    before := before || jsonb_build_object('pipeline', jsonb_build_object('pipeline_stage', case_row.pipeline_stage,
      'pipeline_hidden', hidden_before, 'pipeline_version', case_row.pipeline_version));
    -- pipeline_stage, pipeline_hidden_at and pipeline_version sit outside the
    -- tuple 137's guard compares, so no admissions_version bump is needed; the
    -- 251 trigger raises pipeline_version on the position change.
    UPDATE platform.student_cases c SET pipeline_stage = stage, pipeline_hidden_at = NULL, updated_at = clock_timestamp()
    WHERE c.organization_id = p_organization_id AND c.id = p_student_case_id RETURNING * INTO case_row;
    INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal, actor_membership_id,
      action, resource_type, resource_id, before_state, after_state, reason, request_id)
    VALUES (p_organization_id, 'user', actor.profile_id, principal, actor.membership_id, 'case.pipeline.move',
      'student_case', p_student_case_id,
      jsonb_build_object('pipeline_stage', stage_before, 'pipeline_hidden', hidden_before),
      jsonb_build_object('pipeline_stage', case_row.pipeline_stage, 'pipeline_hidden', FALSE,
        'pipeline_version', case_row.pipeline_version),
      btrim(p_reason), public.uuid_generate_v5(base_request, 'admissions-direct-update:pipeline'));
    changed_parts := array_append(changed_parts, 'pipelineStage'::TEXT);
  END IF;

  -- ---- amoCRM lead id -------------------------------------------------------------------------------------
  IF amo_id IS NOT NULL THEN
    PERFORM platform_private.lock_external_identity(p_organization_id, 'amocrm', 'lead', amo_id);
    SELECT * INTO ext FROM platform.external_identifiers e
    WHERE e.organization_id = p_organization_id AND e.source_system = 'amocrm' AND e.external_object_type = 'lead'
      AND e.external_identifier = amo_id;
    IF FOUND THEN
      -- The same binding is nothing to do; this number on another lead or on a
      -- client is a conflict (the table never changes).
      IF ext.lead_id IS DISTINCT FROM case_row.canonical_lead_id THEN
        RAISE EXCEPTION 'admissions_direct_update_amo_conflict' USING ERRCODE = 'PT409';
      END IF;
    ELSE
      IF EXISTS (SELECT 1 FROM platform.external_identifiers e
          WHERE e.organization_id = p_organization_id AND e.source_system = 'amocrm' AND e.external_object_type = 'lead'
            AND e.lead_id = case_row.canonical_lead_id) THEN
        RAISE EXCEPTION 'admissions_direct_update_amo_conflict' USING ERRCODE = 'PT409';
      END IF;
      INSERT INTO platform.external_identifiers (organization_id, source_system, external_object_type, external_identifier,
        lead_id, observed_at, imported_at, source_ref)
      VALUES (p_organization_id, 'amocrm', 'lead', amo_id, case_row.canonical_lead_id, observed, observed,
        p_update_source || ':' || ref);
      INSERT INTO platform.subject_provenance (organization_id, lead_id, source_system, evidence_type, observed_at,
        imported_at, source_ref)
      VALUES (p_organization_id, case_row.canonical_lead_id, 'amocrm', 'imported', observed, observed, p_update_source || ':' || ref);
      INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal, actor_membership_id,
        action, resource_type, resource_id, before_state, after_state, reason, request_id)
      VALUES (p_organization_id, 'user', actor.profile_id, principal, actor.membership_id, 'lead.amocrm.link',
        'lead', case_row.canonical_lead_id, NULL,
        jsonb_build_object('lead_id', case_row.canonical_lead_id, 'student_case_id', p_student_case_id, 'source_system', 'amocrm',
          'external_object_type', 'lead', 'external_identifier', amo_id),
        btrim(p_reason), public.uuid_generate_v5(base_request, 'admissions-direct-update:amo'));
      changed_parts := array_append(changed_parts, 'amoLeadId'::TEXT);
    END IF;
  END IF;

  -- ---- note -----------------------------------------------------------------------------------------------------------
  IF note_body IS NOT NULL THEN
    IF NOT platform_private.staff_can_access(p_organization_id, actor.membership_id, 'case.update.append', 'student_case', p_student_case_id) THEN
      RAISE EXCEPTION 'admissions_direct_forbidden' USING ERRCODE = '42501';
    END IF;
    note_id := gen_random_uuid();
    INSERT INTO platform.case_notes (id, organization_id, student_case_id, body, created_by_membership_id)
    VALUES (note_id, p_organization_id, p_student_case_id, note_body, actor.membership_id);
    INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal, actor_membership_id,
      action, resource_type, resource_id, before_state, after_state, reason, request_id)
    VALUES (p_organization_id, 'user', actor.profile_id, principal, actor.membership_id, 'note.create',
      'student_case', p_student_case_id, NULL,
      jsonb_build_object('case_note_id', note_id, 'student_case_id', p_student_case_id, 'body_chars', char_length(note_body)),
      btrim(p_reason), public.uuid_generate_v5(base_request, 'admissions-direct-update:note'));
    changed_parts := array_append(changed_parts, 'note'::TEXT);
  END IF;

  -- ---- close, last (246's rules) -----------------------------------------------------------------------------------
  IF close_outcome IS NOT NULL THEN
    SELECT * INTO case_row FROM platform.student_cases c WHERE c.organization_id = p_organization_id AND c.id = p_student_case_id;
    IF case_row.state = 'closed' THEN
      already_closed := TRUE;
    ELSIF case_row.state <> 'active' THEN
      -- pending -> closed is not a transition (042): give the case a curator first.
      RAISE EXCEPTION 'admissions_direct_update_case_not_active' USING ERRCODE = '55000';
    ELSE
      IF NOT platform_private.staff_can_access(p_organization_id, actor.membership_id, 'case.lifecycle.change', 'student_case', p_student_case_id) THEN
        RAISE EXCEPTION 'admissions_direct_forbidden' USING ERRCODE = '42501';
      END IF;
      -- 137 playbook cases: the playbook outcome follows the state (246).
      IF case_row.admissions_playbook_version_id IS NOT NULL THEN
        playbook_outcome := CASE
          WHEN close_outcome = 'enrolled' AND case_row.operational_stage = 'arrival_and_adaptation'
            AND case_row.admissions_facts ?& ARRAY['arrivalOn', 'arrivalConfirmedBy', 'arrivalEvidence'] THEN 'arrived'
          ELSE 'cancelled' END;
      END IF;
      before := before || jsonb_build_object('close', jsonb_build_object('state', case_row.state::TEXT,
        'closed_at', case_row.closed_at, 'admissions_version', case_row.admissions_version::TEXT,
        'admissions_outcome', case_row.admissions_outcome));
      UPDATE platform.student_cases c SET state = 'closed'::platform.student_case_state, closed_at = statement_timestamp(),
        admissions_outcome = CASE WHEN c.admissions_playbook_version_id IS NULL THEN c.admissions_outcome ELSE playbook_outcome END,
        admissions_version = c.admissions_version + 1
      WHERE c.organization_id = p_organization_id AND c.id = p_student_case_id RETURNING * INTO closed_case;
      INSERT INTO platform.student_case_lifecycle_events (organization_id, student_case_id, event_type, previous_state,
        new_state, actor_membership_id, reason, request_id)
      VALUES (p_organization_id, p_student_case_id, 'closed', case_row.state, closed_case.state, actor.membership_id,
        'Case finished: ' || close_outcome, public.uuid_generate_v5(base_request, 'admissions-direct-update:close'));
      INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal, actor_membership_id,
        action, resource_type, resource_id, before_state, after_state, reason, request_id, resulting_version)
      VALUES (p_organization_id, 'user', actor.profile_id, principal, actor.membership_id, 'case.lifecycle.change',
        'student_case', p_student_case_id,
        jsonb_build_object('case_state', case_row.state::TEXT, 'closed_at', case_row.closed_at,
          'admissions_version', case_row.admissions_version::TEXT),
        jsonb_build_object('case_state', closed_case.state::TEXT, 'closed_at', closed_case.closed_at,
          'outcome', close_outcome, 'note', close_note, 'admissions_version', closed_case.admissions_version::TEXT),
        btrim(p_reason), public.uuid_generate_v5(base_request, 'admissions-direct-update:close'),
        closed_case.admissions_version);
      closed_now := TRUE;
      changed_parts := array_append(changed_parts, 'close'::TEXT);
      case_row := closed_case;
    END IF;
  END IF;

  -- ---- receipt -----------------------------------------------------------------------------------------------------
  SELECT * INTO case_row FROM platform.student_cases c WHERE c.organization_id = p_organization_id AND c.id = p_student_case_id;
  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'status', 'updated',
    'student_case_id', p_student_case_id,
    'update_source', p_update_source,
    'external_ref', ref,
    'changed', to_jsonb(changed_parts),
    'state', case_row.state::TEXT,
    'pipeline_stage', case_row.pipeline_stage,
    'replayed', FALSE);
  IF jsonb_array_length(contact_conflicts) > 0 THEN
    result := result || jsonb_build_object('contact_conflict', contact_conflicts);
  END IF;
  IF closed_now THEN result := result || jsonb_build_object('closed', TRUE); END IF;
  IF already_closed THEN result := result || jsonb_build_object('already_closed', TRUE); END IF;
  INSERT INTO platform_private.admissions_direct_case_updates (organization_id, update_source, external_ref, student_case_id,
    actor_membership_id, payload_md5, result, before_state)
  VALUES (p_organization_id, p_update_source, ref, p_student_case_id, actor.membership_id, request_fingerprint,
    result - 'replayed', before);
  RETURN result;
END
$$;
REVOKE ALL ON FUNCTION platform.update_admissions_direct_case_v1(UUID, UUID, UUID, TEXT, TEXT, JSONB, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.update_admissions_direct_case_v1(UUID, UUID, UUID, TEXT, TEXT, JSONB, TEXT) TO service_role;
COMMENT ON FUNCTION platform.update_admissions_direct_case_v1(UUID, UUID, UUID, TEXT, TEXT, JSONB, TEXT) IS
  'Migration 287: service-only update of a case created by the direct IMPORT (281), attributed to the owner''s Admin membership. Overwrites contacts, parents, education, route, board stage and curator with what the payload carries, binds the amoCRM lead id, adds a note and, last, closes the case. Idempotent by (organization, update source, external reference); money is not accepted.';

-- ---------------------------------------------------------------------------
-- Self-check: definer, empty search_path, service_role-only EXECUTE.
-- ---------------------------------------------------------------------------
DO $a287_verify$
DECLARE routine RECORD;
BEGIN
  SELECT p.oid, p.prosecdef, p.proconfig INTO routine FROM pg_catalog.pg_proc p
  WHERE p.oid = 'platform.update_admissions_direct_case_v1(uuid,uuid,uuid,text,text,jsonb,text)'::regprocedure;
  IF NOT routine.prosecdef OR routine.proconfig IS DISTINCT FROM ARRAY['search_path=""']
    OR NOT has_function_privilege('service_role', routine.oid, 'EXECUTE')
    OR has_function_privilege('authenticated', routine.oid, 'EXECUTE')
    OR has_function_privilege('anon', routine.oid, 'EXECUTE')
    OR has_function_privilege('authenticated', 'platform_private.admissions_direct_update_object(jsonb,text,text[])', 'EXECUTE')
    OR has_function_privilege('service_role', 'platform_private.admissions_direct_update_object(jsonb,text,text[])', 'EXECUTE')
    OR has_table_privilege('service_role', 'platform_private.admissions_direct_case_updates', 'SELECT')
    OR has_table_privilege('authenticated', 'platform_private.admissions_direct_case_updates', 'SELECT')
  THEN
    RAISE EXCEPTION 'a287_verification_failed: update_admissions_direct_case_v1';
  END IF;
END
$a287_verify$;

NOTIFY pgrst, 'reload schema';
COMMIT;
