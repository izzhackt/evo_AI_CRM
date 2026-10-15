-- «Добавить студента» в «Воронке поступления» без отдела продаж, с деньгами,
-- и служебный импорт существующих клиентов (решения владельца 16.10.2026).
-- docs/PLAN_CHANGES.md «2026-10-16 — Поступление: «Добавить студента» без
-- отдела продаж и импорт клиентов (миграция 281, запись до кода)».
--
-- Forward-only, on the LIVE definitions of 001–280. Every replaced function is
-- anchored by md5 of its current body (the 253/256 pattern); a drift stops the
-- migration. SECURITY DEFINER with the empty search_path throughout; client-
-- callable functions only in `platform`.
--
--  a) permission `case.create.direct` and its publication into every active
--     role whose current bundle holds case.read.full AND task.manage (the
--     «may curate a case» shape of is_eligible_staff_responsibility: in
--     production the Admissions and Admissions Manager roles), with the steps
--     of platform.staff_role_publish (155), as 268 did. The system Admin
--     holds it as every non-sensitive permission.
--  b) student_cases_intake_origin_check gains the direct-admissions origin:
--     source_key = 'admissions-direct:' || canonical_lead_id, lead and client
--     set, no public application. Every existing disjunct stays as 184 left it.
--  c) platform_private.admissions_direct_case_receipts: the request receipt
--     (idempotency, fingerprint) and the provenance of each created case (its
--     author; for an import also the source label and the external reference).
--  d) platform_private.create_admissions_student_case: the one internal
--     creation path. One person, one card: a person (active client matched by
--     phone OR email) with an open case is refused (admissions_direct_case_exists),
--     and so is one with an OPEN lead (admissions_direct_lead_exists, the rule
--     create_manual_sales_lead already applies): sales keep that lead and hand
--     it over. The contact locks are 143's, so the two intakes serialize.
--     Client and lead go through the canonical platform_private.
--     create_or_link_client / create_or_link_lead (source system
--     `evo_admissions`, external identifier = request id, evidence
--     `staff_recorded` or `imported`): external identifiers, subject provenance
--     and client_duplicate_candidates exactly as every other intake. The lead
--     (source `admissions_direct`, no sales owner) is then `converted` (the
--     084 guard allows open → converted): never on the sales board, in
--     «Заявки», the sales funnel or the sales report. Case (pending; with a
--     curator activated at once by the shared
--     assign_student_case_curator_authorized_e1) in the chosen board stage, the
--     student profile fields (needs_review; every value in the form
--     normalize_student_profile_field_value gives it, the intake stays only on
--     student_cases.intake), the contract cost (lead_sale_conditions, read by
--     «Договор и оплата» 189), tranches and the payments already received (paid
--     on a day not later than today in Bishkek), an optional first case note,
--     and the audit rows (case.create, case.tranche.save,
--     finance.payment.record — all already in the P7A allowlist).
--  e) platform.create_admissions_student_case_v1 (authenticated, idempotent by
--     request id) and platform.import_admissions_student_case_v1 (service_role
--     only, explicit actor membership, idempotent by external reference). The
--     import never raises for a person already in work: it returns a report
--     row (status lead_exists or case_exists, the existing id) and creates
--     nothing. Journal principals of an import: docs/runbooks/
--     admissions-direct-import.md.
--  f) «Ждут куратора» for a curator-less direct case: the needs_curator flag
--     (admissions_attention_flags), the needs-curator shape check of
--     private.assign_case_curator_v1 and the 248 read/assign rule
--     (staff_can_take_needs_curator_case) also cover a pending direct case.
--     Owner context, as 248 uses the last curator: the case's author. It is
--     read and assigned by a member whose role holds case.read.full and
--     case.curator.assign in a scope that covers the author. The system Admin
--     (and the import, which acts as the owner's Admin membership) stands
--     outside every department, so a case it leaves without a curator is
--     covered, in addition, by a department scope of the reader's own
--     department: the Admissions Manager of the admissions department sees and
--     distributes it; an «own» scope never covers another author's case. No
--     awaiting_ack: a direct case has no 088 sales handoff to accept.
--  g) fix: assign_student_case_curator_authorized_e1 set portal_activated_at
--     on a case without a Student membership, which 088's
--     student_cases_portal_membership_shape_check refuses (23514): assigning a
--     curator to any pending case without a student failed (the 208 sales
--     report `pending_case` branch for a cabinet without an invite, the 248
--     reassignment after a decline). The activation timestamp is now set only
--     when the case has a Student; nothing else changes.
--  h) marketing_cohort (265) leaves out leads of source `admissions_direct`:
--     existing clients added by admissions are not marketing leads.
--  i) platform.admissions_direct_curator_options_v1: the curators the actor
--     may name in «Добавить студента» (the same scope rule as the command,
--     without a direction) and whether it may leave the case without one.
BEGIN;

-- ---------------------------------------------------------------------------
-- Anchors: the replaced bodies are exactly the live 001–280 definitions.
-- ---------------------------------------------------------------------------
DO $a281_anchor$
DECLARE anchor RECORD;
BEGIN
  FOR anchor IN SELECT * FROM (VALUES
    ('platform_private.staff_can_take_needs_curator_case(uuid,uuid,uuid)', '22ddcc9e709dcde0076b3b5a88ceb22f'),
    ('private.assign_case_curator_v1(uuid,uuid,uuid,uuid,text)', '2e4729c713bdc5b022952416c54436d2'),
    ('platform_private.admissions_attention_flags(uuid)', 'ecc11f9712fa0af6ff61396710b77476'),
    ('platform_private.assign_student_case_curator_authorized_e1(uuid,uuid,uuid,text,uuid,uuid,uuid,uuid)', '74f95af8bb1962f709e2ebf0b6f3516f'),
    ('platform_private.marketing_cohort(uuid,date,date)', '7e2f7d2d020bfb2fac8c7b568452390e')
  ) AS a(signature, expected)
  LOOP
    IF (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = anchor.signature::regprocedure)
      IS DISTINCT FROM anchor.expected THEN
      RAISE EXCEPTION 'a281_anchor_drift: % is not the expected definition', anchor.signature;
    END IF;
  END LOOP;
  IF (SELECT pg_get_constraintdef(c.oid) FROM pg_catalog.pg_constraint c
      WHERE c.conrelid = 'platform.student_cases'::regclass AND c.conname = 'student_cases_intake_origin_check')
    IS DISTINCT FROM 'CHECK (((responsible_sales_membership_id IS NOT NULL) OR ((public_application_id IS NULL) AND (NOT (source_key IS DISTINCT FROM (''docs-intake:''::text || (id)::text))) AND (canonical_client_id IS NOT NULL) AND (canonical_lead_id IS NULL)) OR ((public_application_id IS NOT NULL) AND (NOT (source_key IS DISTINCT FROM (''public_student_application:''::text || (public_application_id)::text))) AND (student_membership_id IS NOT NULL)) OR ((public_application_id IS NULL) AND (NOT (source_key IS DISTINCT FROM (''lead-cabinet:''::text || (canonical_lead_id)::text))) AND (canonical_lead_id IS NOT NULL) AND (student_membership_id IS NULL))))'
  THEN
    RAISE EXCEPTION 'a281_anchor_drift: student_cases_intake_origin_check is not the 184 definition';
  END IF;
END
$a281_anchor$;

-- Self-verifying replace inside one function body (the 173/244 pattern).
CREATE FUNCTION pg_temp.a281_replace(p_signature TEXT, p_old TEXT, p_new TEXT, p_count INTEGER)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE body TEXT; matches INTEGER;
BEGIN
  body := pg_get_functiondef(to_regprocedure(p_signature));
  matches := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  IF body IS NULL OR matches IS DISTINCT FROM p_count THEN
    RAISE EXCEPTION 'a281_replace_drift: % expected %, found %', p_signature, p_count, matches;
  END IF;
  EXECUTE replace(body, p_old, p_new);
END $$;

-- ---------------------------------------------------------------------------
-- a) Permission and its publication into the roles that may curate a case
-- ---------------------------------------------------------------------------
INSERT INTO platform.permission_definitions
  (permission_key, description, staff_label, staff_group, staff_resource_kinds, staff_scope_kinds,
   staff_sensitive, staff_system_only)
VALUES
  ('case.create.direct', 'Create a student case directly from admissions, without the sales department',
   'Добавление студента без отдела продаж', 'Дела',
   ARRAY['student_case'], ARRAY['own', 'organization', 'department', 'direction', 'record'], FALSE, FALSE)
ON CONFLICT (permission_key) DO NOTHING;

DO $a281_catalog$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform.permission_definitions
      WHERE permission_key = 'case.create.direct'
        AND staff_resource_kinds = ARRAY['student_case']::TEXT[]
        AND staff_scope_kinds = ARRAY['own', 'organization', 'department', 'direction', 'record']::TEXT[]
        AND NOT staff_sensitive AND NOT staff_system_only AND staff_group = 'Дела') THEN
    RAISE EXCEPTION 'admissions_direct_permission_catalog_drift' USING ERRCODE = '55000';
  END IF;
END
$a281_catalog$;

CREATE FUNCTION platform_private.admissions_direct_grant_curator_roles(p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  new_key CONSTANT TEXT := 'case.create.direct';
  org RECORD;
  r platform.staff_role_definitions%ROWTYPE;
  current_keys TEXT[];
  keys TEXT[];
  affected UUID[];
  v_bundle_id UUID;
  v_bundle_version BIGINT;
  summary JSONB := '[]'::JSONB;
  skipped JSONB := '[]'::JSONB;
BEGIN
  IF p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'admissions_direct_grant_reason_required' USING ERRCODE = '22023';
  END IF;
  -- staff_role_request_begin order: organization, then role, then members.
  FOR org IN SELECT o.id FROM platform.organizations o WHERE o.status = 'active' ORDER BY o.id FOR UPDATE LOOP
    FOR r IN SELECT d.* FROM platform.staff_role_definitions d
      WHERE d.organization_id = org.id AND d.status = 'active' AND d.current_bundle_id IS NOT NULL
      ORDER BY d.id FOR UPDATE LOOP
      IF NOT EXISTS (SELECT 1 FROM platform.staff_role_bundle_bindings b
          JOIN platform.role_bundle_versions v ON v.id = b.bundle_id AND v.version = b.bundle_version
            AND v.status = 'published'
          WHERE b.organization_id = org.id AND b.role_id = r.id AND b.bundle_id = r.current_bundle_id) THEN
        CONTINUE;
      END IF;
      SELECT COALESCE(array_agg(bp.permission_key ORDER BY bp.permission_key), '{}') INTO current_keys
      FROM platform.role_bundle_permissions bp WHERE bp.bundle_id = r.current_bundle_id;
      -- «May curate a case»: the two keys is_eligible_staff_responsibility('curator') checks.
      IF NOT (current_keys @> ARRAY['case.read.full', 'task.manage']::TEXT[]) OR new_key = ANY (current_keys) THEN
        CONTINUE;
      END IF;
      -- staff_role_publish refuses a publication whose keys have no meaning
      -- for an active assignment scope; such a role is left for the Admin.
      IF EXISTS (SELECT 1 FROM platform.staff_role_assignments a
          JOIN platform.permission_definitions d ON d.permission_key = new_key
          WHERE a.organization_id = org.id AND a.role_id = r.id AND a.revoked_at IS NULL
            AND (NOT (a.scope_kind = ANY (d.staff_scope_kinds))
              OR (a.scope_kind = 'record' AND NOT (a.resource_kind = ANY (d.staff_resource_kinds))))) THEN
        skipped := skipped || jsonb_build_array(jsonb_build_object('organizationId', org.id, 'roleId', r.id));
        CONTINUE;
      END IF;

      keys := array_append(current_keys, new_key);
      SELECT array_agg(DISTINCT k ORDER BY k) INTO keys FROM unnest(keys) k;
      PERFORM platform_private.staff_validate_permission_keys(to_jsonb(keys));
      SELECT COALESCE(array_agg(DISTINCT a.membership_id ORDER BY a.membership_id), '{}') INTO affected
      FROM platform.staff_role_assignments a
      WHERE a.organization_id = org.id AND a.role_id = r.id AND a.revoked_at IS NULL;
      PERFORM platform_private.staff_lock_memberships(org.id, affected);

      SELECT COALESCE(max(b.bundle_version), 0) + 1 INTO v_bundle_version
      FROM platform.staff_role_bundle_bindings b WHERE b.organization_id = org.id AND b.role_id = r.id;
      v_bundle_id := gen_random_uuid();
      INSERT INTO platform.role_bundle_versions (id, role, version, label)
        VALUES (v_bundle_id, NULL, v_bundle_version, r.label);
      INSERT INTO platform.role_bundle_permissions (bundle_id, bundle_role, permission_key)
        SELECT v_bundle_id, NULL, k FROM unnest(keys) k;
      UPDATE platform.role_bundle_versions b SET status = 'published', published_at = statement_timestamp()
        WHERE b.id = v_bundle_id;
      INSERT INTO platform.staff_role_bundle_bindings VALUES (org.id, r.id, v_bundle_id, v_bundle_version);
      UPDATE platform.staff_role_definitions d SET current_bundle_id = v_bundle_id, version = d.version + 1,
        updated_at = statement_timestamp(),
        draft_permission_keys = (SELECT array_agg(DISTINCT k ORDER BY k) FROM unnest(array_append(d.draft_permission_keys, new_key)) k)
      WHERE d.organization_id = org.id AND d.id = r.id;
      WITH revoked AS (
        UPDATE platform.staff_role_assignments a SET revoked_at = statement_timestamp()
        WHERE a.organization_id = org.id AND a.role_id = r.id AND a.revoked_at IS NULL
        RETURNING a.*)
      INSERT INTO platform.staff_role_assignments
        (organization_id, membership_id, role_id, bundle_id, scope_kind, scope_key, resource_kind)
      SELECT organization_id, membership_id, role_id, v_bundle_id, scope_kind, scope_key, resource_kind FROM revoked;
      PERFORM platform_private.staff_bump_memberships(org.id, affected);

      INSERT INTO platform.audit_events (organization_id, actor_kind, actor_principal, action, resource_type,
        resource_id, before_state, after_state, reason, request_id)
      VALUES (org.id, 'system', 'migration:281', 'staff.roles.migrated', 'staff_role', r.id,
        jsonb_build_object('roleVersion', r.version, 'bundleId', r.current_bundle_id,
          'publishedPermissionKeys', to_jsonb(current_keys)),
        jsonb_build_object('schemaVersion', 1, 'roleVersion', r.version + 1, 'bundleId', v_bundle_id,
          'bundleVersion', v_bundle_version, 'addedPermissionKeys', jsonb_build_array(new_key),
          'affectedMembershipIds', to_jsonb(affected)),
        btrim(p_reason), gen_random_uuid());
      summary := summary || jsonb_build_array(jsonb_build_object('organizationId', org.id, 'roleId', r.id,
        'bundleId', v_bundle_id, 'bundleVersion', v_bundle_version, 'affectedMembershipIds', to_jsonb(affected)));
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('roles', summary, 'skipped', skipped);
END
$$;
REVOKE ALL ON FUNCTION platform_private.admissions_direct_grant_curator_roles(TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
COMMENT ON FUNCTION platform_private.admissions_direct_grant_curator_roles(TEXT) IS
  'Migration 281: publish case.create.direct into every role whose bundle holds case.read.full and task.manage, with the staff_role_publish steps. Idempotent; owner-only.';

DO $a281_grant$
DECLARE result JSONB; missing INTEGER;
BEGIN
  result := platform_private.admissions_direct_grant_curator_roles(
    'Поступление: «Добавить студента» без отдела продаж (решение владельца 16.10.2026)');
  IF jsonb_array_length(result -> 'skipped') > 0 THEN
    RAISE NOTICE 'admissions_direct_roles_skipped_scope_conflict: %', result -> 'skipped';
  END IF;
  -- Every member assigned to a role that may curate (and was not skipped above)
  -- now really holds the permission.
  SELECT count(DISTINCT a.membership_id) INTO missing
  FROM platform.staff_role_assignments a
  JOIN platform.staff_role_definitions r ON r.organization_id = a.organization_id AND r.id = a.role_id
    AND r.status = 'active' AND r.current_bundle_id = a.bundle_id
  WHERE a.revoked_at IS NULL
    AND (SELECT count(*) FROM platform.role_bundle_permissions bp WHERE bp.bundle_id = a.bundle_id
      AND bp.permission_key IN ('case.read.full', 'task.manage')) = 2
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(result -> 'skipped') s WHERE (s ->> 'roleId')::UUID = r.id)
    AND EXISTS (SELECT 1 FROM platform_private.staff_membership_identity(a.organization_id, a.membership_id))
    AND NOT platform_private.staff_has_permission(a.organization_id, a.membership_id, 'case.create.direct');
  IF missing > 0 THEN
    RAISE EXCEPTION 'admissions_direct_rights_not_effective: %', missing USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM platform.organization_memberships m
      WHERE m.is_system_admin AND EXISTS (SELECT 1 FROM platform_private.staff_membership_identity(m.organization_id, m.id))
        AND NOT platform_private.staff_has_permission(m.organization_id, m.id, 'case.create.direct')) THEN
    RAISE EXCEPTION 'admissions_direct_rights_admin_missing' USING ERRCODE = '55000';
  END IF;
END
$a281_grant$;

-- ---------------------------------------------------------------------------
-- b) The direct-admissions origin of a case
-- ---------------------------------------------------------------------------
ALTER TABLE platform.student_cases
  DROP CONSTRAINT student_cases_intake_origin_check,
  ADD CONSTRAINT student_cases_intake_origin_check CHECK(
   responsible_sales_membership_id IS NOT NULL
   OR (
    public_application_id IS NULL
    AND source_key IS NOT DISTINCT FROM ('docs-intake:'||id::TEXT)
    AND canonical_client_id IS NOT NULL AND canonical_lead_id IS NULL
   )
   OR (
    public_application_id IS NOT NULL
    AND source_key IS NOT DISTINCT FROM ('public_student_application:'||public_application_id::TEXT)
    AND student_membership_id IS NOT NULL
   )
   OR (
    public_application_id IS NULL
    AND source_key IS NOT DISTINCT FROM ('lead-cabinet:'||canonical_lead_id::TEXT)
    AND canonical_lead_id IS NOT NULL AND student_membership_id IS NULL
   )
   OR (
    public_application_id IS NULL
    AND source_key IS NOT DISTINCT FROM ('admissions-direct:'||canonical_lead_id::TEXT)
    AND canonical_lead_id IS NOT NULL AND canonical_client_id IS NOT NULL
   )
  );

-- ---------------------------------------------------------------------------
-- c) Receipts and provenance
-- ---------------------------------------------------------------------------
CREATE TABLE platform_private.admissions_direct_case_receipts (
  request_id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  actor_membership_id UUID NOT NULL,
  fingerprint TEXT NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{32}$'),
  import_source TEXT NULL CHECK (import_source ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  external_ref TEXT NULL CHECK (char_length(external_ref) BETWEEN 1 AND 200 AND external_ref !~ '[[:cntrl:]]'),
  student_case_id UUID NOT NULL,
  client_id UUID NOT NULL,
  lead_id UUID NOT NULL,
  receipt JSONB NOT NULL CHECK (jsonb_typeof(receipt) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CHECK ((import_source IS NULL) = (external_ref IS NULL)),
  FOREIGN KEY (organization_id, actor_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, client_id) REFERENCES platform.clients(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, lead_id) REFERENCES platform.leads(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, student_case_id)
);
CREATE UNIQUE INDEX admissions_direct_case_receipts_import_key
  ON platform_private.admissions_direct_case_receipts (organization_id, import_source, external_ref)
  WHERE external_ref IS NOT NULL;
ALTER TABLE platform_private.admissions_direct_case_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.admissions_direct_case_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE platform_private.admissions_direct_case_receipts
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
CREATE TRIGGER admissions_direct_case_receipts_append_only
  BEFORE UPDATE OR DELETE ON platform_private.admissions_direct_case_receipts
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER admissions_direct_case_receipts_no_truncate
  BEFORE TRUNCATE ON platform_private.admissions_direct_case_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
COMMENT ON TABLE platform_private.admissions_direct_case_receipts IS
  'Migration 281: one row per case created by admissions without the sales department (request receipt, author, import provenance). Append-only.';

-- ---------------------------------------------------------------------------
-- d) The internal creation path
-- ---------------------------------------------------------------------------
-- Optional text of a payload key: NULL when absent, null or blank; a refusal
-- names the key when it is not a string, too long or carries control
-- characters (newlines only where p_multiline).
CREATE FUNCTION platform_private.admissions_direct_text(
  p_object JSONB, p_key TEXT, p_max INTEGER, p_multiline BOOLEAN DEFAULT FALSE
) RETURNS TEXT LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE value TEXT;
BEGIN
  IF p_object IS NULL OR NOT (p_object ? p_key) OR jsonb_typeof(p_object -> p_key) = 'null' THEN RETURN NULL; END IF;
  IF jsonb_typeof(p_object -> p_key) <> 'string' THEN
    RAISE EXCEPTION 'admissions_direct_invalid:%', p_key USING ERRCODE = '22023';
  END IF;
  value := btrim(p_object ->> p_key, E' \t\r\n');
  IF value = '' THEN RETURN NULL; END IF;
  IF char_length(value) > p_max
    OR (NOT p_multiline AND value ~ '[[:cntrl:]]')
    OR (p_multiline AND value ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]') THEN
    RAISE EXCEPTION 'admissions_direct_invalid:%', p_key USING ERRCODE = '22023';
  END IF;
  RETURN value;
END $$;

-- An object (or absent/null) whose keys are all in p_allowed.
CREATE FUNCTION platform_private.admissions_direct_object(p_value JSONB, p_label TEXT, p_allowed TEXT[])
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) = 'null' THEN RETURN NULL; END IF;
  IF jsonb_typeof(p_value) <> 'object'
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_value) k WHERE NOT (k = ANY (p_allowed))) THEN
    RAISE EXCEPTION 'admissions_direct_invalid:%', p_label USING ERRCODE = '22023';
  END IF;
  RETURN p_value;
END $$;

-- A positive integer amount in minor units (JSON number or digit string).
CREATE FUNCTION platform_private.admissions_direct_minor(p_object JSONB, p_key TEXT, p_label TEXT)
RETURNS BIGINT LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE raw TEXT;
BEGIN
  IF p_object IS NULL OR jsonb_typeof(p_object -> p_key) NOT IN ('number', 'string') THEN
    RAISE EXCEPTION 'admissions_direct_invalid:%', p_label USING ERRCODE = '22023';
  END IF;
  raw := p_object ->> p_key;
  IF raw !~ '^[1-9][0-9]{0,12}$' OR raw::NUMERIC > 1000000000000 THEN
    RAISE EXCEPTION 'admissions_direct_invalid:%', p_label USING ERRCODE = '22023';
  END IF;
  RETURN raw::BIGINT;
END $$;

-- An ISO calendar date within [p_min, p_max], or NULL when absent/null/blank.
CREATE FUNCTION platform_private.admissions_direct_date(p_object JSONB, p_key TEXT, p_min DATE, p_max DATE, p_label TEXT)
RETURNS DATE LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE raw TEXT; value DATE;
BEGIN
  raw := platform_private.admissions_direct_text(p_object, p_key, 10);
  IF raw IS NULL THEN RETURN NULL; END IF;
  IF raw !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RAISE EXCEPTION 'admissions_direct_invalid:%', p_label USING ERRCODE = '22023';
  END IF;
  BEGIN value := raw::DATE;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'admissions_direct_invalid:%', p_label USING ERRCODE = '22023';
  END;
  IF value < p_min OR value > p_max OR to_char(value, 'YYYY-MM-DD') <> raw THEN
    RAISE EXCEPTION 'admissions_direct_invalid:%', p_label USING ERRCODE = '22023';
  END IF;
  RETURN value;
END $$;

-- May the actor name this curator (NULL: none, the case waits) for a case in
-- this direction? The future owner is the curator, or the actor while the
-- case waits. Own scope admits only oneself; another curator, or none, also
-- needs case.curator.assign in the same scope. The command and the options
-- read share it.
CREATE FUNCTION platform_private.admissions_direct_actor_may_name(
  p_organization_id UUID, p_actor_membership_id UUID, p_curator_membership_id UUID, p_direction TEXT
) RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT platform_private.staff_context_can_access(p_organization_id, p_actor_membership_id, 'case.create.direct',
      'student_case', NULL, COALESCE(p_curator_membership_id, p_actor_membership_id), NULL, p_direction)
    AND (p_curator_membership_id IS NOT DISTINCT FROM p_actor_membership_id
      OR platform_private.staff_context_can_access(p_organization_id, p_actor_membership_id, 'case.curator.assign',
        'student_case', NULL, COALESCE(p_curator_membership_id, p_actor_membership_id), NULL, p_direction))
$$;

REVOKE ALL ON FUNCTION platform_private.admissions_direct_text(JSONB, TEXT, INTEGER, BOOLEAN),
  platform_private.admissions_direct_object(JSONB, TEXT, TEXT[]),
  platform_private.admissions_direct_minor(JSONB, TEXT, TEXT),
  platform_private.admissions_direct_date(JSONB, TEXT, DATE, DATE, TEXT),
  platform_private.admissions_direct_actor_may_name(UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE FUNCTION platform_private.create_admissions_student_case(
  p_organization_id UUID,
  p_actor_membership_id UUID,
  p_request_id UUID,
  p_payload JSONB,
  p_reason TEXT,
  p_import_source TEXT,
  p_external_ref TEXT
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  is_import CONSTANT BOOLEAN := p_import_source IS NOT NULL;
  today DATE := (statement_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE;
  stages CONSTANT TEXT[] := ARRAY['new', 'shortlist', 'documents', 'ready_to_submit', 'awaiting_decision',
    'confirmed', 'visa', 'predeparture', 'arrived'];
  currencies CONSTANT TEXT[] := ARRAY['USD', 'EUR', 'KGS'];
  actor RECORD;
  prior platform_private.admissions_direct_case_receipts%ROWTYPE;
  request_fingerprint TEXT;
  principal TEXT;
  payload JSONB; student JSONB; parent JSONB; route JSONB; education JSONB; money JSONB; cost JSONB;
  payment JSONB; payments JSONB := '[]'::JSONB;
  student_name TEXT; first_name TEXT; last_name TEXT; phone_raw TEXT; email_raw TEXT;
  phone_norm TEXT; email_norm TEXT; birth_date DATE; age_years INTEGER; age_raw TEXT;
  parent_relation TEXT; parent_first TEXT; parent_last TEXT; parent_phone TEXT;
  country_code TEXT; direction TEXT; degree_text TEXT; program_text TEXT; intake_text TEXT;
  education_current TEXT; english_text TEXT; chinese_text TEXT;
  curator UUID; curator_raw TEXT; stage TEXT; note_text TEXT; note_body TEXT;
  cost_minor BIGINT; cost_currency TEXT; signed_on DATE;
  paid_same BIGINT := 0;
  client_id_value UUID; client_reused BOOLEAN := FALSE;
  lead_id_value UUID;
  existing_case_id UUID; open_lead_id UUID; lock_value TEXT;
  evidence CONSTANT TEXT := CASE WHEN p_import_source IS NOT NULL THEN 'imported' ELSE 'staff_recorded' END;
  observed CONSTANT TIMESTAMPTZ := statement_timestamp();
  field_value TEXT; profile_values JSONB := '[]'::JSONB;
  case_id UUID := gen_random_uuid();
  scope_id UUID := gen_random_uuid();
  profile_id_value UUID;
  obligation_id UUID; obligation_currency TEXT; obligation_amount BIGINT;
  obligation_ids JSONB := '[]'::JSONB; event_ids JSONB := '[]'::JSONB;
  event_id UUID; event_request UUID; i INTEGER := 0; t INTEGER := 0;
  field RECORD;
  changed platform.student_cases%ROWTYPE;
  result JSONB;
BEGIN
  IF p_organization_id IS NULL OR p_actor_membership_id IS NULL THEN
    RAISE EXCEPTION 'admissions_direct_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 500 OR btrim(p_reason) ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'admissions_direct_invalid:reason' USING ERRCODE = '22023';
  END IF;
  PERFORM platform_private.lock_p2d_request(p_request_id);
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' OR pg_column_size(p_payload) > 40000 THEN
    RAISE EXCEPTION 'admissions_direct_invalid:payload' USING ERRCODE = '22023';
  END IF;

  -- The actor first: an active staff membership holding the permission.
  SELECT * INTO actor FROM platform_private.staff_membership_identity(p_organization_id, p_actor_membership_id);
  IF NOT FOUND OR NOT platform_private.staff_has_permission(p_organization_id, actor.membership_id, 'case.create.direct') THEN
    RAISE EXCEPTION 'admissions_direct_forbidden' USING ERRCODE = '42501';
  END IF;

  request_fingerprint := md5(jsonb_build_object('payload', p_payload, 'importSource', p_import_source,
    'externalRef', p_external_ref, 'reason', btrim(p_reason))::TEXT);
  SELECT * INTO prior FROM platform_private.admissions_direct_case_receipts r WHERE r.request_id = p_request_id;
  IF FOUND THEN
    IF prior.organization_id <> p_organization_id OR prior.actor_membership_id <> p_actor_membership_id
      OR prior.fingerprint <> request_fingerprint THEN
      IF is_import THEN
        RAISE EXCEPTION 'admissions_direct_import_conflict' USING ERRCODE = 'PT409';
      END IF;
      RAISE EXCEPTION 'admissions_direct_request_conflict' USING ERRCODE = '22023';
    END IF;
    RETURN prior.receipt || jsonb_build_object('replayed', TRUE);
  END IF;

  -- ---- payload ----------------------------------------------------------------
  payload := platform_private.admissions_direct_object(p_payload, 'payload',
    ARRAY['student', 'parent', 'route', 'education', 'curatorMembershipId', 'pipelineStage', 'money', 'note']);
  student := platform_private.admissions_direct_object(payload -> 'student', 'student',
    ARRAY['name', 'firstName', 'lastName', 'phone', 'email', 'birthDate', 'age']);
  parent := platform_private.admissions_direct_object(payload -> 'parent', 'parent',
    ARRAY['relation', 'firstName', 'lastName', 'phone']);
  route := platform_private.admissions_direct_object(payload -> 'route', 'route',
    ARRAY['country', 'degree', 'program', 'intake']);
  education := platform_private.admissions_direct_object(payload -> 'education', 'education',
    ARRAY['current', 'english', 'chinese']);
  money := platform_private.admissions_direct_object(payload -> 'money', 'money',
    ARRAY['cost', 'signedOn', 'payments']);
  IF student IS NULL THEN RAISE EXCEPTION 'admissions_direct_invalid:student' USING ERRCODE = '22023'; END IF;

  first_name := platform_private.admissions_direct_text(student, 'firstName', 60);
  last_name := platform_private.admissions_direct_text(student, 'lastName', 60);
  student_name := COALESCE(platform_private.admissions_direct_text(student, 'name', 200),
    NULLIF(btrim(concat_ws(' ', first_name, last_name)), ''));
  IF student_name IS NULL THEN RAISE EXCEPTION 'admissions_direct_invalid:name' USING ERRCODE = '22023'; END IF;
  phone_raw := platform_private.admissions_direct_text(student, 'phone', 40);
  IF phone_raw IS NOT NULL THEN
    phone_norm := platform_private.normalize_person_phone(phone_raw);
    IF phone_norm IS NULL OR phone_norm !~ '^\+?[0-9]{7,15}$' THEN
      RAISE EXCEPTION 'admissions_direct_invalid:phone' USING ERRCODE = '22023';
    END IF;
  END IF;
  email_raw := platform_private.admissions_direct_text(student, 'email', 120);
  IF email_raw IS NOT NULL THEN
    email_norm := platform_private.normalize_person_email(email_raw);
    IF email_norm IS NULL OR email_norm !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
      RAISE EXCEPTION 'admissions_direct_invalid:email' USING ERRCODE = '22023';
    END IF;
  END IF;
  birth_date := platform_private.admissions_direct_date(student, 'birthDate', DATE '1940-01-01', today, 'birthDate');
  IF student ? 'age' AND jsonb_typeof(student -> 'age') <> 'null' THEN
    age_raw := student ->> 'age';
    IF jsonb_typeof(student -> 'age') NOT IN ('number', 'string') OR age_raw !~ '^[0-9]{1,2}$'
      OR age_raw::INTEGER NOT BETWEEN 5 AND 99 THEN
      RAISE EXCEPTION 'admissions_direct_invalid:age' USING ERRCODE = '22023';
    END IF;
    age_years := age_raw::INTEGER;
  END IF;

  IF parent IS NOT NULL THEN
    parent_relation := platform_private.admissions_direct_text(parent, 'relation', 10);
    parent_first := platform_private.admissions_direct_text(parent, 'firstName', 60);
    parent_last := platform_private.admissions_direct_text(parent, 'lastName', 60);
    parent_phone := platform_private.admissions_direct_text(parent, 'phone', 40);
    IF parent_phone IS NOT NULL AND platform_private.normalize_person_phone(parent_phone) !~ '^\+?[0-9]{7,15}$' THEN
      RAISE EXCEPTION 'admissions_direct_invalid:parentPhone' USING ERRCODE = '22023';
    END IF;
    IF (parent_first IS NOT NULL OR parent_last IS NOT NULL OR parent_phone IS NOT NULL)
      AND parent_relation IS DISTINCT FROM 'mother' AND parent_relation IS DISTINCT FROM 'father' THEN
      RAISE EXCEPTION 'admissions_direct_invalid:relation' USING ERRCODE = '22023';
    END IF;
  END IF;

  country_code := platform_private.admissions_direct_text(route, 'country', 2);
  IF country_code IS NOT NULL AND country_code !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'admissions_direct_invalid:country' USING ERRCODE = '22023';
  END IF;
  direction := platform_private.student_application_direction(country_code);
  degree_text := platform_private.admissions_direct_text(route, 'degree', 60);
  program_text := platform_private.admissions_direct_text(route, 'program', 100);
  intake_text := platform_private.admissions_direct_text(route, 'intake', 30);
  education_current := platform_private.admissions_direct_text(education, 'current', 100);
  english_text := platform_private.admissions_direct_text(education, 'english', 60);
  chinese_text := platform_private.admissions_direct_text(education, 'chinese', 40);

  curator_raw := platform_private.admissions_direct_text(payload, 'curatorMembershipId', 36);
  IF curator_raw IS NOT NULL THEN
    IF curator_raw !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'admissions_direct_invalid:curator' USING ERRCODE = '22023';
    END IF;
    curator := curator_raw::UUID;
  END IF;
  stage := COALESCE(platform_private.admissions_direct_text(payload, 'pipelineStage', 40), 'new');
  IF NOT (stage = ANY (stages)) THEN
    RAISE EXCEPTION 'admissions_direct_invalid:pipelineStage' USING ERRCODE = '22023';
  END IF;
  note_text := platform_private.admissions_direct_text(payload, 'note', 3500, TRUE);

  IF money IS NOT NULL THEN
    cost := platform_private.admissions_direct_object(money -> 'cost', 'cost', ARRAY['amountMinor', 'currency']);
    IF cost IS NOT NULL THEN
      cost_minor := platform_private.admissions_direct_minor(cost, 'amountMinor', 'cost');
      cost_currency := platform_private.admissions_direct_text(cost, 'currency', 3);
      IF cost_currency IS NULL OR NOT (cost_currency = ANY (currencies)) THEN
        RAISE EXCEPTION 'admissions_direct_invalid:costCurrency' USING ERRCODE = '22023';
      END IF;
    END IF;
    signed_on := platform_private.admissions_direct_date(money, 'signedOn', DATE '2000-01-01', DATE '2100-12-31', 'signedOn');
    IF money ? 'payments' AND jsonb_typeof(money -> 'payments') <> 'null' THEN
      IF jsonb_typeof(money -> 'payments') <> 'array' OR jsonb_array_length(money -> 'payments') > 20 THEN
        RAISE EXCEPTION 'admissions_direct_invalid:payments' USING ERRCODE = '22023';
      END IF;
      FOR payment IN SELECT value FROM jsonb_array_elements(money -> 'payments') LOOP
        payment := platform_private.admissions_direct_object(payment, 'payment', ARRAY['amountMinor', 'currency', 'paidOn']);
        IF payment IS NULL THEN RAISE EXCEPTION 'admissions_direct_invalid:payment' USING ERRCODE = '22023'; END IF;
        -- Received money is paid on a past day or today (Bishkek), never later.
        IF platform_private.admissions_direct_text(payment, 'currency', 3) IS NULL
          OR NOT (platform_private.admissions_direct_text(payment, 'currency', 3) = ANY (currencies))
          OR platform_private.admissions_direct_date(payment, 'paidOn', DATE '2000-01-01', today, 'paidOn') IS NULL THEN
          RAISE EXCEPTION 'admissions_direct_invalid:payment' USING ERRCODE = '22023';
        END IF;
        payments := payments || jsonb_build_array(jsonb_build_object(
          'amountMinor', platform_private.admissions_direct_minor(payment, 'amountMinor', 'payment'),
          'currency', platform_private.admissions_direct_text(payment, 'currency', 3),
          'paidOn', platform_private.admissions_direct_date(payment, 'paidOn', DATE '2000-01-01', today, 'paidOn')));
      END LOOP;
    END IF;
    IF cost_minor IS NOT NULL THEN
      SELECT COALESCE(sum((p ->> 'amountMinor')::BIGINT), 0) INTO paid_same
      FROM jsonb_array_elements(payments) p WHERE p ->> 'currency' = cost_currency;
      IF paid_same > cost_minor THEN
        RAISE EXCEPTION 'admissions_direct_invalid:paymentsExceedCost' USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;

  -- ---- анкета values, in the form the анкета itself stores ----------------------------
  -- Every value passes normalize_student_profile_field_value (the rule of
  -- every анкета write): phones as digits, e-mail in lower case. The intake
  -- («набор», free text such as «сентябрь 2027») is not the date field
  -- desired_start_date; it stays on student_cases.intake. date_of_birth is a
  -- canonical column (student_profiles.date_of_birth): its field row has no value.
  FOR field IN SELECT * FROM (VALUES
    ('student_first_name', first_name, 'firstName'), ('student_last_name', last_name, 'lastName'),
    ('mobile_phone', phone_raw, 'phone'), ('student_email', email_raw, 'email'),
    ('current_study_status', education_current, 'current'), ('english_level', english_text, 'english'),
    ('chinese_level_hsk', chinese_text, 'chinese'),
    ('program_level', degree_text, 'degree'), ('field_major', program_text, 'program'),
    (parent_relation || '_first_name', parent_first, 'parentFirstName'),
    (parent_relation || '_last_name', parent_last, 'parentLastName'),
    (parent_relation || '_mobile_phone', parent_phone, 'parentPhone')
  ) AS fields(key, value, label)
  WHERE fields.key IS NOT NULL AND fields.value IS NOT NULL LOOP
    BEGIN
      field_value := platform_private.normalize_student_profile_field_value(field.key, field.value);
    EXCEPTION WHEN invalid_parameter_value THEN
      RAISE EXCEPTION 'admissions_direct_invalid:%', field.label USING ERRCODE = '22023';
    END;
    profile_values := profile_values || jsonb_build_array(jsonb_build_object('key', field.key, 'value', field_value));
  END LOOP;
  IF birth_date IS NOT NULL THEN
    profile_values := profile_values || jsonb_build_array(jsonb_build_object('key', 'date_of_birth', 'value', NULL));
  END IF;

  -- ---- scoped authority ------------------------------------------------------------
  -- The future owner of the case: its curator, or the author while it waits
  -- for one. Own scope admits only oneself; another curator, or none, also
  -- needs case.curator.assign in the same scope. The actor holds the
  -- permission (checked above): a refusal here is about the chosen curator.
  IF NOT platform_private.admissions_direct_actor_may_name(p_organization_id, actor.membership_id, curator, direction) THEN
    RAISE EXCEPTION 'admissions_direct_curator_forbidden' USING ERRCODE = '42501';
  END IF;
  IF curator IS NOT NULL AND (
      NOT EXISTS (SELECT 1 FROM platform_private.staff_membership_identity(p_organization_id, curator))
      OR NOT platform_private.is_eligible_staff_responsibility(p_organization_id, curator, 'curator')) THEN
    RAISE EXCEPTION 'admissions_direct_invalid:curator' USING ERRCODE = '22023';
  END IF;
  principal := CASE WHEN is_import THEN 'service:admissions-import' ELSE 'auth:' || actor.auth_user_id::TEXT END;

  -- ---- one person, one card --------------------------------------------------------
  -- The contact locks of create_manual_sales_lead (143), in its sorted order:
  -- a manual sales lead and a direct case for the same contact serialize.
  FOR lock_value IN SELECT v FROM unnest(ARRAY[phone_norm, email_norm]) v WHERE v IS NOT NULL ORDER BY v LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('manual-lead-contact:' || p_organization_id::TEXT || ':' || lock_value, 0));
  END LOOP;
  IF phone_norm IS NOT NULL OR email_norm IS NOT NULL THEN
    -- A case in work for this person: find it in «Студенты».
    SELECT sc.id INTO existing_case_id
    FROM platform.clients cl
    JOIN platform.student_cases sc ON sc.organization_id = cl.organization_id AND sc.state IN ('pending', 'active')
      AND (sc.canonical_client_id = cl.id OR sc.canonical_lead_id IN (
        SELECT l.id FROM platform.leads l WHERE l.organization_id = cl.organization_id AND l.client_id = cl.id))
    WHERE cl.organization_id = p_organization_id AND cl.lifecycle_state = 'active'
      AND ((phone_norm IS NOT NULL AND cl.normalized_phone = phone_norm)
        OR (email_norm IS NOT NULL AND cl.normalized_email = email_norm))
    ORDER BY sc.created_at, sc.id LIMIT 1;
    -- An open sales lead for this person (create_manual_sales_lead answers
    -- `duplicate` to the same match): sales keep it and hand it over.
    SELECT l.id INTO open_lead_id
    FROM platform.clients cl
    JOIN platform.leads l ON l.organization_id = cl.organization_id AND l.client_id = cl.id AND l.lifecycle_state = 'open'
    WHERE cl.organization_id = p_organization_id AND cl.lifecycle_state = 'active'
      AND ((phone_norm IS NOT NULL AND cl.normalized_phone = phone_norm)
        OR (email_norm IS NOT NULL AND cl.normalized_email = email_norm))
    ORDER BY l.updated_at DESC, l.id LIMIT 1;
  END IF;
  -- The import reports such a row and creates nothing; the staff command refuses.
  IF existing_case_id IS NOT NULL THEN
    IF is_import THEN
      RETURN jsonb_build_object('organization_id', p_organization_id, 'status', 'case_exists',
        'student_case_id', existing_case_id, 'import_source', p_import_source, 'external_ref', p_external_ref,
        'replayed', FALSE);
    END IF;
    RAISE EXCEPTION 'admissions_direct_case_exists' USING ERRCODE = 'PT409';
  END IF;
  IF open_lead_id IS NOT NULL THEN
    IF is_import THEN
      RETURN jsonb_build_object('organization_id', p_organization_id, 'status', 'lead_exists',
        'lead_id', open_lead_id, 'import_source', p_import_source, 'external_ref', p_external_ref,
        'replayed', FALSE);
    END IF;
    RAISE EXCEPTION 'admissions_direct_lead_exists' USING ERRCODE = 'PT409', DETAIL = open_lead_id::TEXT;
  END IF;

  -- ---- client and lead: the canonical identity path, with provenance ----------------
  -- An exact email+phone match is the same client (084's strong identity);
  -- anything weaker becomes a new client and a duplicate candidate.
  client_reused := phone_norm IS NOT NULL AND email_norm IS NOT NULL AND EXISTS (
    SELECT 1 FROM platform.clients cl
    WHERE cl.organization_id = p_organization_id AND cl.lifecycle_state = 'active'
      AND cl.normalized_phone = phone_norm AND cl.normalized_email = email_norm);
  client_id_value := platform_private.create_or_link_client(p_organization_id, student_name, email_raw, phone_raw,
    'evo_admissions', 'client', p_request_id::TEXT, evidence, observed,
    CASE WHEN is_import THEN observed END, p_external_ref);
  lead_id_value := platform_private.create_or_link_lead(p_organization_id, client_id_value, NULL, 'new',
    'admissions_direct', 'evo_admissions', 'lead', p_request_id::TEXT, evidence, observed,
    CASE WHEN is_import THEN observed END, p_external_ref);
  -- Already a client, never a sales lead (084's guard allows open -> converted).
  UPDATE platform.leads l SET lifecycle_state = 'converted',
    interest_direction = CASE direction WHEN 'EUROPE' THEN 'EU' ELSE direction END
  WHERE l.organization_id = p_organization_id AND l.id = lead_id_value;

  -- ---- case ------------------------------------------------------------------------
  INSERT INTO platform.record_scopes (id, organization_id, scope_kind, scope_key, scope_version)
    VALUES (scope_id, p_organization_id, 'student_case', case_id, 1);
  INSERT INTO platform.student_cases (id, organization_id, source_key, student_display_name, target_country,
    target_degree, program_direction, intake, language_assumption, operational_stage, state, current_scope_id,
    current_scope_version, canonical_client_id, canonical_lead_id, admissions_direction, pipeline_stage)
  VALUES (case_id, p_organization_id, 'admissions-direct:' || lead_id_value::TEXT, student_name, country_code,
    degree_text, program_text, intake_text,
    NULLIF(concat_ws('; ', english_text, chinese_text), ''),
    'intake', 'pending', scope_id, 1, client_id_value, lead_id_value, direction, stage);
  IF curator IS NOT NULL THEN
    PERFORM platform_private.assign_student_case_curator_authorized_e1(p_organization_id, case_id, curator,
      btrim(p_reason), public.uuid_generate_v5(p_request_id, 'admissions-direct:assign'),
      actor.profile_id, actor.membership_id, actor.auth_user_id);
  END IF;

  -- ---- student profile (анкета) ----------------------------------------------------------
  INSERT INTO platform.student_profiles (organization_id, student_case_id, revision, preferred_display_name,
    date_of_birth, current_education_summary, language_summary, decision_participant_labels, consent_status,
    created_by_membership_id, updated_by_membership_id)
  VALUES (p_organization_id, case_id, 1, left(student_name, 200), birth_date, education_current,
    NULLIF(concat_ws('; ', english_text, chinese_text), ''), ARRAY[]::TEXT[], 'not_recorded',
    actor.membership_id, actor.membership_id)
  RETURNING id INTO profile_id_value;
  INSERT INTO platform.student_profile_fields (organization_id, student_case_id, student_profile_id, field_key,
    value, review_state, profile_revision)
  SELECT p_organization_id, case_id, profile_id_value, f ->> 'key', f ->> 'value', 'needs_review', 1
  FROM jsonb_array_elements(profile_values) f;

  -- ---- first case note: age without a birth date, and the free note ----------------
  note_body := NULLIF(concat_ws(E'\n\n',
    CASE WHEN age_years IS NOT NULL AND birth_date IS NULL
      THEN 'Возраст: ' || age_years::TEXT || ' (на ' || to_char(today, 'DD.MM.YYYY') || ')' END,
    note_text), '');
  IF note_body IS NOT NULL THEN
    INSERT INTO platform.case_notes (organization_id, student_case_id, body, created_by_membership_id)
    VALUES (p_organization_id, case_id, note_body, actor.membership_id);
  END IF;

  -- ---- money: contract cost, tranches and the payments already received ------------
  IF cost_minor IS NOT NULL OR signed_on IS NOT NULL THEN
    INSERT INTO platform_private.lead_sale_conditions (lead_id, organization_id, fields, revision, updated_by_membership_id)
    VALUES (lead_id_value, p_organization_id, platform_private.lead_sale_condition_fields(jsonb_strip_nulls(jsonb_build_object(
      'service_cost_minor', cost_minor::TEXT, 'service_cost_currency', cost_currency,
      'signing_date', to_char(signed_on, 'YYYY-MM-DD')))), 1, actor.membership_id);
  END IF;
  -- One tranche for the contract cost; one fully paid tranche per other currency.
  FOR obligation_currency, obligation_amount IN
    SELECT x.currency, x.amount FROM (
      SELECT cost_currency AS currency, cost_minor AS amount, 0 AS ord WHERE cost_minor IS NOT NULL
      UNION ALL
      SELECT p ->> 'currency', sum((p ->> 'amountMinor')::BIGINT), 1
      FROM jsonb_array_elements(payments) p
      WHERE cost_minor IS NULL OR p ->> 'currency' <> cost_currency
      GROUP BY p ->> 'currency'
    ) x ORDER BY x.ord, x.currency
  LOOP
    t := t + 1;
    obligation_id := gen_random_uuid();
    INSERT INTO platform.payment_obligations (id, organization_id, student_case_id, label, category, amount_minor,
      currency, due_at, next_action, created_by_membership_id)
    VALUES (obligation_id, p_organization_id, case_id,
      CASE WHEN cost_minor IS NOT NULL AND obligation_currency = cost_currency THEN 'Оплата по договору'
        ELSE 'Получено в ' || obligation_currency END,
      'evo_service_fee', obligation_amount, obligation_currency, NULL, NULL, actor.membership_id);
    obligation_ids := obligation_ids || to_jsonb(obligation_id);
    INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal,
      actor_membership_id, action, resource_type, resource_id, after_state, reason, request_id)
    VALUES (p_organization_id, 'user', actor.profile_id, principal, actor.membership_id, 'case.tranche.save',
      'payment_obligation', obligation_id, jsonb_build_object('organization_id', p_organization_id,
        'student_case_id', case_id, 'payment_obligation_id', obligation_id, 'amount_minor', obligation_amount,
        'currency', obligation_currency), btrim(p_reason),
      public.uuid_generate_v5(p_request_id, 'admissions-direct:tranche:' || t::TEXT));
    i := 0;
    FOR payment IN SELECT p FROM jsonb_array_elements(payments) WITH ORDINALITY AS e(p, n)
      WHERE e.p ->> 'currency' = obligation_currency ORDER BY e.n LOOP
      i := i + 1;
      event_id := gen_random_uuid();
      event_request := public.uuid_generate_v5(p_request_id, 'admissions-direct:payment:' || obligation_currency || ':' || i::TEXT);
      INSERT INTO platform.payment_events (id, organization_id, student_case_id, payment_obligation_id, event_type,
        referenced_payment_event_id, amount_minor, currency, occurred_at, source_key, actor_membership_id, request_id)
      VALUES (event_id, p_organization_id, case_id, obligation_id, 'payment', NULL, (payment ->> 'amountMinor')::BIGINT,
        obligation_currency, ((payment ->> 'paidOn')::DATE)::TIMESTAMP AT TIME ZONE 'Asia/Bishkek', 'admissions_direct',
        actor.membership_id, event_request);
      INSERT INTO platform.payment_evidence (organization_id, student_case_id, payment_obligation_id, payment_event_id,
        evidence_ref, recorded_by_membership_id)
      VALUES (p_organization_id, case_id, obligation_id, event_id, 'admissions-direct:' || event_id::TEXT, actor.membership_id);
      UPDATE platform.payment_obligations o SET total_paid_minor = o.total_paid_minor + (payment ->> 'amountMinor')::BIGINT
      WHERE o.organization_id = p_organization_id AND o.id = obligation_id;
      event_ids := event_ids || to_jsonb(event_id);
      INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal,
        actor_membership_id, action, resource_type, resource_id, after_state, reason, request_id)
      VALUES (p_organization_id, 'user', actor.profile_id, principal, actor.membership_id, 'finance.payment.record',
        'payment_event', event_id, jsonb_build_object('organization_id', p_organization_id, 'student_case_id', case_id,
          'payment_obligation_id', obligation_id, 'amount_minor', (payment ->> 'amountMinor')::BIGINT,
          'currency', obligation_currency, 'occurred_on', payment ->> 'paidOn', 'payment_event_id', event_id),
        btrim(p_reason), event_request);
    END LOOP;
  END LOOP;

  -- ---- receipt and journal -------------------------------------------------------------
  SELECT * INTO changed FROM platform.student_cases sc WHERE sc.organization_id = p_organization_id AND sc.id = case_id;
  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'status', 'created',
    'student_case_id', case_id,
    'client_id', client_id_value,
    'lead_id', lead_id_value,
    'client_reused', client_reused,
    'state', changed.state::TEXT,
    'curator_membership_id', changed.current_curator_membership_id,
    'pipeline_stage', changed.pipeline_stage,
    'payment_obligation_ids', obligation_ids,
    'payment_event_ids', event_ids,
    'replayed', FALSE);
  INSERT INTO platform_private.admissions_direct_case_receipts (request_id, organization_id, actor_membership_id,
    fingerprint, import_source, external_ref, student_case_id, client_id, lead_id, receipt)
  VALUES (p_request_id, p_organization_id, actor.membership_id, request_fingerprint, p_import_source, p_external_ref,
    case_id, client_id_value, lead_id_value, result);
  INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal, actor_membership_id,
    action, resource_type, resource_id, after_state, reason, request_id)
  VALUES (p_organization_id, 'user', actor.profile_id, principal, actor.membership_id, 'case.create', 'student_case',
    case_id, result || jsonb_build_object('origin', 'admissions_direct', 'import_source', p_import_source,
      'external_ref', p_external_ref), btrim(p_reason), p_request_id);
  RETURN result;
END
$$;
REVOKE ALL ON FUNCTION platform_private.create_admissions_student_case(UUID, UUID, UUID, JSONB, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
COMMENT ON FUNCTION platform_private.create_admissions_student_case(UUID, UUID, UUID, JSONB, TEXT, TEXT, TEXT) IS
  'Migration 281: the one internal path that creates a client, a lead (admissions_direct, converted) and a student case with profile and money for an explicit staff actor. Callers: create_admissions_student_case_v1 and import_admissions_student_case_v1.';

-- ---------------------------------------------------------------------------
-- e) The staff command and the service-only import
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.create_admissions_student_case_v1(
  p_organization_id UUID, p_request_id UUID, p_payload JSONB
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD;
BEGIN
  SELECT a.* INTO actor FROM platform.current_actor_authority() a
  WHERE a.organization_id = p_organization_id AND a.platform_role IS DISTINCT FROM 'student';
  IF NOT FOUND OR actor.membership_id IS NULL THEN
    RAISE EXCEPTION 'admissions_direct_forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN platform_private.create_admissions_student_case(p_organization_id, actor.membership_id, p_request_id,
    p_payload, 'Студент добавлен поступлением без отдела продаж', NULL, NULL);
END
$$;
REVOKE ALL ON FUNCTION platform.create_admissions_student_case_v1(UUID, UUID, JSONB)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.create_admissions_student_case_v1(UUID, UUID, JSONB) TO authenticated;
COMMENT ON FUNCTION platform.create_admissions_student_case_v1(UUID, UUID, JSONB) IS
  'Migration 281: «Добавить студента» — admissions create a student case without the sales department. Idempotent by request id.';

CREATE FUNCTION platform.import_admissions_student_case_v1(
  p_organization_id UUID, p_actor_membership_id UUID, p_import_source TEXT, p_external_ref TEXT,
  p_payload JSONB, p_reason TEXT
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE ref TEXT := btrim(p_external_ref);
BEGIN
  -- Service path only: no end-user identity may reach it (the grants already
  -- exclude anon and authenticated).
  IF NULLIF(current_setting('request.jwt.claims', TRUE), '')::JSONB ->> 'sub' IS NOT NULL
    OR COALESCE(NULLIF(current_setting('request.jwt.claims', TRUE), '')::JSONB ->> 'role', '') IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'admissions_direct_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_import_source IS NULL OR p_import_source !~ '^[a-z][a-z0-9_.-]{1,63}$' THEN
    RAISE EXCEPTION 'admissions_direct_invalid:importSource' USING ERRCODE = '22023';
  END IF;
  IF ref IS NULL OR char_length(ref) NOT BETWEEN 1 AND 200 OR ref ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'admissions_direct_invalid:externalRef' USING ERRCODE = '22023';
  END IF;
  -- The request id is derived from the external reference: the same row
  -- imported twice is the same request (idempotent replay).
  RETURN platform_private.create_admissions_student_case(p_organization_id, p_actor_membership_id,
    public.uuid_generate_v5('6ba7b811-9dad-11d1-80b4-00c04fd430c8'::UUID,
      'evo:admissions-direct-import:' || p_organization_id::TEXT || ':' || p_import_source || ':' || ref),
    p_payload, p_reason, p_import_source, ref);
END
$$;
REVOKE ALL ON FUNCTION platform.import_admissions_student_case_v1(UUID, UUID, TEXT, TEXT, JSONB, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.import_admissions_student_case_v1(UUID, UUID, TEXT, TEXT, JSONB, TEXT) TO service_role;
COMMENT ON FUNCTION platform.import_admissions_student_case_v1(UUID, UUID, TEXT, TEXT, JSONB, TEXT) IS
  'Migration 281: service-only import of existing clients through the same creation path, attributed to an explicit staff membership. Idempotent by (organization, import source, external reference). A person already in work (open lead or case) is returned as a report row (status lead_exists / case_exists) and nothing is created.';

-- i) Whom the actor may name as curator in «Добавить студента»: the eligible
-- curators (248's list) that pass the command's own scope rule, without a
-- direction (the form has none yet; a direction-only scope is decided by the
-- command), and whether the case may be left without a curator.
CREATE FUNCTION platform.admissions_direct_curator_options_v1(p_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD;
BEGIN
  SELECT a.* INTO actor FROM platform.current_actor_authority() a
  WHERE a.organization_id = p_organization_id AND a.platform_role IS DISTINCT FROM 'student';
  IF NOT FOUND OR actor.membership_id IS NULL
    OR NOT platform_private.staff_has_permission(p_organization_id, actor.membership_id, 'case.create.direct') THEN
    RAISE EXCEPTION 'admissions_direct_forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'organization_id', p_organization_id,
    'without_curator', platform_private.admissions_direct_actor_may_name(p_organization_id, actor.membership_id, NULL, NULL),
    'owners', COALESCE((
      SELECT jsonb_agg(o.value ORDER BY o.ordinality)
      FROM jsonb_array_elements(platform_private.u6_eligible_admissions_owners(p_organization_id)) WITH ORDINALITY AS o(value, ordinality)
      WHERE platform_private.admissions_direct_actor_may_name(p_organization_id, actor.membership_id,
        (o.value ->> 'membership_id')::UUID, NULL)), '[]'::JSONB));
END
$$;
REVOKE ALL ON FUNCTION platform.admissions_direct_curator_options_v1(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.admissions_direct_curator_options_v1(UUID) TO authenticated;
COMMENT ON FUNCTION platform.admissions_direct_curator_options_v1(UUID) IS
  'Migration 281: the curators the actor may name in «Добавить студента» and whether it may leave the case without one.';

-- ---------------------------------------------------------------------------
-- f) «Ждут куратора» for a curator-less direct case
-- ---------------------------------------------------------------------------
-- A pending, curator-less case created by admissions; its author from the receipt.
CREATE FUNCTION platform_private.direct_needs_curator_case_author(p_organization_id UUID, p_student_case_id UUID)
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT r.actor_membership_id
  FROM platform.student_cases c
  JOIN platform_private.admissions_direct_case_receipts r
    ON r.organization_id = c.organization_id AND r.student_case_id = c.id
  WHERE c.organization_id = p_organization_id AND c.id = p_student_case_id
    AND c.state = 'pending' AND c.current_curator_membership_id IS NULL
    AND c.source_key IS NOT DISTINCT FROM ('admissions-direct:' || c.canonical_lead_id::TEXT)
$$;
CREATE FUNCTION platform_private.is_direct_needs_curator_case(p_organization_id UUID, p_student_case_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT platform_private.direct_needs_curator_case_author(p_organization_id, p_student_case_id) IS NOT NULL
$$;
-- A department scope of the member's OWN department holding the key: the
-- department branch of staff_context_can_access with the member itself as the
-- owner context (its «own» branch deliberately left out).
CREATE FUNCTION platform_private.admissions_direct_own_department_scope(
  p_organization_id UUID, p_membership_id UUID, p_permission_key TEXT
) RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT platform_private.staff_has_permission(p_organization_id, p_membership_id, p_permission_key)
    AND EXISTS (SELECT 1 FROM platform.permission_definitions d
      WHERE d.permission_key = p_permission_key AND 'student_case' = ANY (d.staff_resource_kinds)
        AND 'department' = ANY (d.staff_scope_kinds))
    AND EXISTS (SELECT 1 FROM platform.staff_role_assignments a
      JOIN platform.staff_role_definitions r ON r.organization_id = a.organization_id AND r.id = a.role_id
        AND r.status = 'active' AND r.current_bundle_id = a.bundle_id
      JOIN platform.role_bundle_versions b ON b.id = a.bundle_id AND b.status = 'published'
      JOIN platform.role_bundle_permissions bp ON bp.bundle_id = a.bundle_id AND bp.permission_key = p_permission_key
      JOIN platform.staff_organizational_details od ON od.organization_id = a.organization_id
        AND od.membership_id = a.membership_id AND od.department_id::TEXT = a.scope_key
      JOIN platform.staff_departments dept ON dept.organization_id = od.organization_id AND dept.id = od.department_id
        AND dept.status = 'active'
      WHERE a.organization_id = p_organization_id AND a.membership_id = p_membership_id
        AND a.revoked_at IS NULL AND a.scope_kind = 'department')
$$;
-- Read and assign: case.read.full and case.curator.assign in a scope that
-- covers the owner context. As 248 uses the last curator, the owner context is
-- the case's author (organization, the author's department, oneself, the
-- case's direction, the record). The system Admin (also the import's actor)
-- belongs to no department: for a case it authored a department scope of the
-- reader's own department covers it too, so the Admissions Manager distributes
-- what the Admin or the import left without a curator. The Admin always.
CREATE FUNCTION platform_private.staff_can_take_direct_needs_curator_case(
  p_organization_id UUID, p_membership_id UUID, p_student_case_id UUID
) RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((
    SELECT bool_and(
        platform_private.staff_context_can_access(p_organization_id, p_membership_id,
          k.key, 'student_case', p_student_case_id, author.id, p_student_case_id, c.admissions_direction)
        OR (author.is_system_admin
          AND platform_private.admissions_direct_own_department_scope(p_organization_id, p_membership_id, k.key)))
    FROM platform.student_cases c
    JOIN platform.organization_memberships author ON author.organization_id = c.organization_id
      AND author.id = platform_private.direct_needs_curator_case_author(c.organization_id, c.id)
    CROSS JOIN (VALUES ('case.read.full'), ('case.curator.assign')) AS k(key)
    WHERE c.organization_id = p_organization_id AND c.id = p_student_case_id
  ), FALSE)
$$;
REVOKE ALL ON FUNCTION platform_private.direct_needs_curator_case_author(UUID, UUID),
  platform_private.is_direct_needs_curator_case(UUID, UUID),
  platform_private.admissions_direct_own_department_scope(UUID, UUID, TEXT),
  platform_private.staff_can_take_direct_needs_curator_case(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- 248's rule, unchanged, OR the direct rule.
SELECT pg_temp.a281_replace('platform_private.staff_can_take_needs_curator_case(uuid,uuid,uuid)',
  $old$
    WHERE last_curator.membership_id IS NOT NULL
  ), FALSE)
$old$,
  $new$
    WHERE last_curator.membership_id IS NOT NULL
  ), FALSE)
  -- 281: a pending direct-admissions case without a curator.
  OR platform_private.staff_can_take_direct_needs_curator_case(p_organization_id, p_membership_id, p_student_case_id)
$new$, 1);

SELECT pg_temp.a281_replace('private.assign_case_curator_v1(uuid,uuid,uuid,uuid,text)',
  $old$OR NOT platform_private.case_sale_or_handoff_evidence(p_organization_id, p_student_case_id)$old$,
  $new$OR NOT (platform_private.case_sale_or_handoff_evidence(p_organization_id, p_student_case_id)
      -- 281: a pending direct-admissions case without a curator.
      OR platform_private.is_direct_needs_curator_case(p_organization_id, p_student_case_id))$new$, 1);

SELECT pg_temp.a281_replace('platform_private.admissions_attention_flags(uuid)',
  $old$IF platform_private.case_sale_or_handoff_evidence(c.organization_id,c.id) THEN
   flags:=array_append(flags,'needs_curator');$old$,
  $new$IF platform_private.case_sale_or_handoff_evidence(c.organization_id,c.id)
    -- 281: a pending direct-admissions case without a curator.
    OR platform_private.is_direct_needs_curator_case(c.organization_id,c.id) THEN
   flags:=array_append(flags,'needs_curator');$new$, 1);

-- ---------------------------------------------------------------------------
-- g) Portal activation only for a case with a Student
-- ---------------------------------------------------------------------------
SELECT pg_temp.a281_replace(
  'platform_private.assign_student_case_curator_authorized_e1(uuid,uuid,uuid,text,uuid,uuid,uuid,uuid)',
  $old$COALESCE(target_case.portal_activated_at, occurred_at)$old$,
  $new$CASE WHEN target_case.student_membership_id IS NULL THEN target_case.portal_activated_at
        ELSE COALESCE(target_case.portal_activated_at, occurred_at) END$new$, 2);

-- ---------------------------------------------------------------------------
-- h) Marketing counts marketing leads only
-- ---------------------------------------------------------------------------
SELECT pg_temp.a281_replace('platform_private.marketing_cohort(uuid,date,date)',
  $old$    WHERE l.organization_id=p_organization_id
      AND l.created_at>=p_from::TIMESTAMP AT TIME ZONE 'Asia/Bishkek'$old$,
  $new$    WHERE l.organization_id=p_organization_id
      AND l.source_key<>'admissions_direct'
      AND l.created_at>=p_from::TIMESTAMP AT TIME ZONE 'Asia/Bishkek'$new$, 1);

-- The replaced functions keep their identity, owner and grants (CREATE OR
-- REPLACE through pg_get_functiondef); assert the new bodies landed.
DO $a281_verify$
BEGIN
  IF (SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = 'platform_private.staff_can_take_needs_curator_case(uuid,uuid,uuid)'::regprocedure) NOT LIKE '%staff_can_take_direct_needs_curator_case%'
    OR (SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = 'private.assign_case_curator_v1(uuid,uuid,uuid,uuid,text)'::regprocedure) NOT LIKE '%is_direct_needs_curator_case%'
    OR (SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = 'platform_private.admissions_attention_flags(uuid)'::regprocedure) NOT LIKE '%is_direct_needs_curator_case%'
    OR (SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = 'platform_private.assign_student_case_curator_authorized_e1(uuid,uuid,uuid,text,uuid,uuid,uuid,uuid)'::regprocedure) NOT LIKE '%target_case.student_membership_id IS NULL THEN target_case.portal_activated_at%'
    OR (SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = 'platform_private.marketing_cohort(uuid,date,date)'::regprocedure) NOT LIKE '%l.source_key<>''admissions_direct''%'
  THEN
    RAISE EXCEPTION 'a281_replace_not_applied';
  END IF;
END
$a281_verify$;

NOTIFY pgrst, 'reload schema';
COMMIT;
