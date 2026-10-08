-- 279 «Удаление аккаунта по запросу: кабинет, iPhone и очередь в CRM».
-- docs/PLAN_CHANGES.md «2026-10-07 — Удаление аккаунта по запросу» and the
-- addendum «2026-10-08 — Удаление аккаунта (279): упрощение для 1.0» (owner
-- decision 08.10.2026 «Упростить для 1.0»). Docs: docs/runbooks/account-deletion.md.
--
-- Why. 196 recorded a deletion REQUEST (student with a membership only) and
-- 244 let the Admin read the list, but nothing ever processed a request, and
-- an account created by the public анкета (no membership until approval) was
-- refused with 42501. App Store 5.1.1(v) needs deletion that starts in the
-- app and really completes.
--
-- What this migration adds (forward-only; no released RPC is replaced):
--  a) permission 'account.deletion.process' (system-only, «Настройки»): only
--     the system Admin holds it through staff_has_permission.
--  b) platform_private.account_deletion_requests (196) is EXTENDED: the
--     subject is the Auth account, membership_id may be NULL, statuses
--     'processing' and 'completed', due_at = request + 30 days, one open
--     request per account, how it was completed ('automatic' or 'manual' with
--     the Admin's note), and the confirmation address kept only until the
--     email status is recorded.
--  c) AUTOMATIC processing only for a SIMPLE account. The account's own rows
--     are exactly the rows reachable by foreign key from its Auth user
--     (account_deletion_closure: every row whose foreign key points at a
--     reached row, round after round) plus the journal entries whose
--     resource_id is one of them. The account is simple when none of these
--     exists: a student case (its membership's, its анкета's, or one whose
--     invitation it accepted), an approved or converted анкета, a lead, a
--     client, a payment obligation or event, a contract file, a WhatsApp
--     conversation, or any reachable row outside the own tables listed in
--     account_deletion_closure. Then exactly those rows are deleted. No text,
--     phone, email or name is ever searched; no other row changes.
--  d) Everything else is MANUAL (docs/runbooks/account-deletion.md): the
--     processing RPC refuses it (account_deletion_not_simple, the reasons in
--     DETAIL); the Admin marks it done with a note once the team has done
--     the work and the login no longer works (mark_account_deletion_done_v1).
--  e) The guard functions of the own tables (append-only, no hard delete,
--     immutable tests) let a row DELETE through only inside the erasure
--     transaction (GUC platform.account_erasure_request_id + the request's
--     erasure_transaction_id = pg_current_xact_id(), the
--     guard_student_case_identity_e1 receipt pattern). UPDATE, INSERT and
--     TRUNCATE are never let through.
--  f) RPCs (SECURITY DEFINER, search_path '', EXECUTE to authenticated only):
--     request_account_deletion_v2 / own_account_deletion_request_v1 (any
--     signed-in account that is not staff, for itself only);
--     staff_account_deletion_queue_v1 / staff_account_deletion_detail_v1 /
--     process_account_deletion_v1 / complete_account_deletion_v1 /
--     mark_account_deletion_done_v1 / record_account_deletion_email_v1
--     (account.deletion.process).
--
-- Automatic processing is two-step: process_* deletes the own rows in one
-- transaction and returns the Auth user id; the CRM server route deletes the
-- user through auth.admin.deleteUser; complete_* checks in the database that
-- the user is gone. A failure leaves 'processing'; retry is safe.
BEGIN;

-- ---------------------------------------------------------------------------
-- Anchors.
-- ---------------------------------------------------------------------------
DO $a279_anchors$
BEGIN
  IF to_regclass('platform_private.account_deletion_requests') IS NULL
    OR to_regprocedure('platform.request_account_deletion_v1(uuid)') IS NULL
    OR to_regprocedure('platform_private.staff_has_permission(uuid,uuid,text)') IS NULL
    OR to_regprocedure('public.uuid_generate_v5(uuid,text)') IS NULL
    OR to_regclass('platform.payment_obligations') IS NULL
    OR to_regclass('platform.payment_events') IS NULL
    OR to_regclass('platform.case_contract_files') IS NULL
    OR to_regclass('platform.communication_conversations') IS NULL
    OR to_regclass('platform_private.student_portal_provisioning_receipts') IS NULL
    OR EXISTS (SELECT 1 FROM platform.permission_definitions WHERE permission_key = 'account.deletion.process')
  THEN
    RAISE EXCEPTION 'a279_account_deletion_anchor_drift';
  END IF;
END
$a279_anchors$;

-- ---------------------------------------------------------------------------
-- a) Permission (system-only: the system Admin passes staff_has_permission).
-- ---------------------------------------------------------------------------
INSERT INTO platform.permission_definitions
  (permission_key, description, staff_label, staff_group, staff_resource_kinds, staff_scope_kinds,
   staff_sensitive, staff_system_only)
VALUES
  ('account.deletion.process', 'Удаление аккаунта и личных данных по запросу человека',
   'Удаление аккаунтов по запросу', 'Настройки',
   ARRAY['organization'], ARRAY['organization'], FALSE, TRUE);

-- ---------------------------------------------------------------------------
-- b) Requests table: the subject is the Auth account.
-- ---------------------------------------------------------------------------
ALTER TABLE platform_private.account_deletion_requests
  ALTER COLUMN membership_id DROP NOT NULL,
  ADD COLUMN subject_auth_user_id UUID,
  ADD COLUMN subject_kind TEXT,
  ADD COLUMN due_at TIMESTAMPTZ,
  ADD COLUMN processing_started_at TIMESTAMPTZ,
  ADD COLUMN processing_started_by_membership_id UUID,
  ADD COLUMN last_processed_at TIMESTAMPTZ,
  ADD COLUMN completed_at TIMESTAMPTZ,
  ADD COLUMN completed_by_membership_id UUID,
  ADD COLUMN completion_mode TEXT,
  ADD COLUMN manual_note TEXT,
  ADD COLUMN erasure_transaction_id XID8,
  ADD COLUMN confirmation_email TEXT,
  ADD COLUMN confirmation_email_status TEXT,
  ADD COLUMN summary JSONB,
  ADD CONSTRAINT account_deletion_requests_processing_actor_fkey
    FOREIGN KEY (organization_id, processing_started_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id),
  ADD CONSTRAINT account_deletion_requests_completed_actor_fkey
    FOREIGN KEY (organization_id, completed_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id);

-- Existing (196) rows: a student membership, so the subject is its Auth user.
UPDATE platform_private.account_deletion_requests r
SET subject_auth_user_id = p.auth_user_id,
  subject_kind = 'student',
  due_at = r.created_at + INTERVAL '30 days',
  confirmation_email = (SELECT u.email FROM auth.users u WHERE u.id = p.auth_user_id)
FROM platform.organization_memberships m
JOIN platform.profiles p ON p.id = m.profile_id
WHERE m.organization_id = r.organization_id AND m.id = r.membership_id;

ALTER TABLE platform_private.account_deletion_requests
  ALTER COLUMN subject_auth_user_id SET NOT NULL,
  ALTER COLUMN subject_kind SET NOT NULL,
  ALTER COLUMN due_at SET NOT NULL,
  DROP CONSTRAINT account_deletion_requests_check,
  DROP CONSTRAINT account_deletion_requests_status_check,
  ADD CONSTRAINT account_deletion_requests_status_check
    CHECK (status IN ('requested', 'acknowledged', 'processing', 'completed')),
  -- A student's membership is cleared when the automatic erasure deletes it.
  ADD CONSTRAINT account_deletion_requests_kind_check
    CHECK (subject_kind IN ('student', 'applicant') AND (subject_kind = 'student' OR membership_id IS NULL)),
  ADD CONSTRAINT account_deletion_requests_email_status_check
    CHECK (confirmation_email_status IS NULL
      OR confirmation_email_status IN ('sent', 'failed', 'not_configured', 'no_address')),
  ADD CONSTRAINT account_deletion_requests_note_check
    CHECK (manual_note IS NULL OR (char_length(btrim(manual_note)) BETWEEN 10 AND 2000
      AND manual_note !~ '[\x01-\x09\x0b-\x1f\x7f]')),
  ADD CONSTRAINT account_deletion_requests_summary_check
    CHECK (summary IS NULL OR jsonb_typeof(summary) = 'object'),
  ADD CONSTRAINT account_deletion_requests_shape_check CHECK (
    (status = 'requested' AND acknowledged_at IS NULL AND acknowledged_by_membership_id IS NULL
      AND processing_started_at IS NULL AND completed_at IS NULL)
    OR (status = 'acknowledged' AND acknowledged_at IS NOT NULL AND acknowledged_by_membership_id IS NOT NULL
      AND processing_started_at IS NULL AND completed_at IS NULL)
    OR (status = 'processing' AND processing_started_at IS NOT NULL
      AND processing_started_by_membership_id IS NOT NULL AND last_processed_at IS NOT NULL
      AND completed_at IS NULL)
    -- Automatic: after processing, no note. Manual: never processed, a note.
    OR (status = 'completed' AND completed_at IS NOT NULL AND completed_by_membership_id IS NOT NULL
      AND ((completion_mode = 'automatic' AND processing_started_at IS NOT NULL AND manual_note IS NULL)
        OR (completion_mode = 'manual' AND processing_started_at IS NULL AND manual_note IS NOT NULL)))
  ),
  ADD CONSTRAINT account_deletion_requests_open_shape_check CHECK (
    status = 'completed' OR (completion_mode IS NULL AND manual_note IS NULL
      AND completed_by_membership_id IS NULL AND confirmation_email_status IS NULL)
  ),
  -- The address is kept only until the email status is recorded.
  ADD CONSTRAINT account_deletion_requests_email_kept_check CHECK (
    confirmation_email IS NULL OR confirmation_email_status IS NULL
  );

-- One open request per Auth account (applicants have no membership, so the
-- 196 index on (organization, membership) cannot express it); request_id is
-- the client's idempotency key per account.
CREATE UNIQUE INDEX account_deletion_requests_one_open_subject_idx
  ON platform_private.account_deletion_requests (subject_auth_user_id)
  WHERE status IN ('requested', 'acknowledged', 'processing');
CREATE UNIQUE INDEX account_deletion_requests_subject_request_idx
  ON platform_private.account_deletion_requests (subject_auth_user_id, request_id);
CREATE INDEX account_deletion_requests_queue_idx
  ON platform_private.account_deletion_requests (organization_id, status, due_at, id);

-- Rows written by the released request_account_deletion_v1 (196) name only
-- the membership: derive the subject, the deadline and the address here.
CREATE FUNCTION platform_private.account_deletion_request_defaults()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.subject_auth_user_id IS NULL AND NEW.membership_id IS NOT NULL THEN
    SELECT p.auth_user_id INTO NEW.subject_auth_user_id
    FROM platform.organization_memberships m
    JOIN platform.profiles p ON p.id = m.profile_id
    WHERE m.organization_id = NEW.organization_id AND m.id = NEW.membership_id;
  END IF;
  IF NEW.subject_kind IS NULL THEN
    NEW.subject_kind := CASE WHEN NEW.membership_id IS NULL THEN 'applicant' ELSE 'student' END;
  END IF;
  IF NEW.confirmation_email IS NULL THEN
    SELECT u.email INTO NEW.confirmation_email FROM auth.users u WHERE u.id = NEW.subject_auth_user_id;
  END IF;
  NEW.due_at := NEW.created_at + INTERVAL '30 days';
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION platform_private.account_deletion_request_defaults()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
CREATE TRIGGER account_deletion_requests_defaults
  BEFORE INSERT ON platform_private.account_deletion_requests
  FOR EACH ROW EXECUTE FUNCTION platform_private.account_deletion_request_defaults();

-- ---------------------------------------------------------------------------
-- e) The one-transaction erasure bypass: row DELETE only, only inside the
-- erasure of one request in this transaction.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.account_erasure_bypass()
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE marker TEXT := NULLIF(pg_catalog.current_setting('platform.account_erasure_request_id', TRUE), '');
BEGIN
  IF marker IS NULL OR marker !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN FALSE;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM platform_private.account_deletion_requests r
    WHERE r.id = marker::UUID
      AND r.erasure_transaction_id = pg_catalog.pg_current_xact_id()
  );
END
$$;
REVOKE ALL ON FUNCTION platform_private.account_erasure_bypass()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- The guard functions on the own tables (account_deletion_closure) learn the
-- bypass: the snippet goes right after the top-level BEGIN and returns OLD
-- for a row-level DELETE inside the erasure transaction only. The GUC test
-- comes first, so no other caller ever reaches the private lookup.
DO $a279_guards$
DECLARE
  target TEXT;
  def TEXT;
  src TEXT;
  prefix TEXT;
  snippet CONSTANT TEXT := E'\n'
    || E'  -- 279: account erasure bypass (one transaction, row DELETE only).\n'
    || E'  IF TG_LEVEL = ''ROW'' AND TG_OP = ''DELETE''\n'
    || E'    AND NULLIF(pg_catalog.current_setting(''platform.account_erasure_request_id'', TRUE), '''') IS NOT NULL THEN\n'
    || E'    IF platform_private.account_erasure_bypass() THEN\n'
    || E'      RETURN OLD;\n'
    || E'    END IF;\n'
    || E'  END IF;\n';
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'platform_private.block_append_only_mutation()',
    'platform_private.block_domain_delete()',
    'platform_private.guard_student_assessment_immutable()',
    'platform_private.guard_learning_immutable()'
  ] LOOP
    SELECT p.prosrc INTO src FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_language l ON l.oid = p.prolang
    WHERE p.oid = target::REGPROCEDURE AND l.lanname = 'plpgsql'
      AND p.prorettype = 'pg_catalog.trigger'::REGTYPE;
    def := pg_get_functiondef(target::REGPROCEDURE);
    -- The first BEGIN keyword of a PL/pgSQL body opens its top-level block.
    prefix := (regexp_match(src, '^(.*?)\mBEGIN\M'))[1];
    IF src IS NULL OR prefix IS NULL OR strpos(src, 'account_erasure_bypass') <> 0
      OR (length(def) - length(replace(def, src, ''))) / length(src) <> 1
    THEN
      RAISE EXCEPTION 'a279_guard_anchor_drift: %', target;
    END IF;
    EXECUTE replace(def, src, prefix || 'BEGIN' || snippet || substr(src, length(prefix) + 6));
  END LOOP;
END
$a279_guards$;

-- Supabase Auth keeps its own journal (auth.audit_log_entries: email, IP) and
-- PKCE flow rows (auth.flow_state) that auth.admin.deleteUser leaves behind.
-- Only the entries keyed by this user id (actor or subject), no text search.
-- Where the migration owner may not delete there (a managed project can
-- restrict the auth schema), nothing fails: -1 is returned.
CREATE FUNCTION platform_private.account_deletion_auth_log_erase(p_auth_user_id UUID)
RETURNS BIGINT LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE n BIGINT := 0;
BEGIN
  IF p_auth_user_id IS NULL THEN RETURN 0; END IF;
  IF to_regclass('auth.flow_state') IS NOT NULL AND has_table_privilege('auth.flow_state', 'DELETE') THEN
    DELETE FROM auth.flow_state f WHERE f.user_id = p_auth_user_id;
  END IF;
  IF to_regclass('auth.audit_log_entries') IS NOT NULL AND has_table_privilege('auth.audit_log_entries', 'DELETE') THEN
    DELETE FROM auth.audit_log_entries e
    WHERE e.payload ->> 'actor_id' = p_auth_user_id::TEXT
      OR e.payload -> 'traits' ->> 'user_id' = p_auth_user_id::TEXT;
    GET DIAGNOSTICS n = ROW_COUNT;
  END IF;
  RETURN n;
EXCEPTION WHEN insufficient_privilege THEN
  RETURN -1;
END
$$;
REVOKE ALL ON FUNCTION platform_private.account_deletion_auth_log_erase(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- c) The own rows and the simplicity test.
-- ---------------------------------------------------------------------------
-- Who may ask: any Auth account that is not staff. Staff = a profile with a
-- membership whose coarse role is not 'student' (invited staff carry NULL) or
-- the system Admin. The organization is the student membership's, else the
-- анкета's, else the single анкета configuration's.
CREATE FUNCTION platform_private.account_deletion_subject(p_auth_user_id UUID)
RETURNS TABLE (organization_id UUID, subject_kind TEXT, membership_id UUID, profile_id UUID)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_profile UUID; v_org UUID; v_member UUID;
BEGIN
  IF p_auth_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_auth_user_id) THEN
    RETURN;
  END IF;
  IF platform_private.account_deletion_is_staff(p_auth_user_id) THEN
    RAISE EXCEPTION 'account_deletion_staff_forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT p.id INTO v_profile FROM platform.profiles p WHERE p.auth_user_id = p_auth_user_id;
  IF v_profile IS NOT NULL THEN
    SELECT m.organization_id, m.id INTO v_org, v_member
    FROM platform.organization_memberships m
    WHERE m.profile_id = v_profile AND m."current_role" = 'student'
    ORDER BY (m.status = 'active') DESC, m.created_at, m.id LIMIT 1;
  END IF;
  IF v_org IS NULL THEN
    SELECT a.organization_id INTO v_org FROM platform_private.student_applications a
    WHERE a.auth_user_id = p_auth_user_id;
  END IF;
  IF v_org IS NULL THEN
    SELECT c.organization_id INTO v_org FROM platform_private.student_application_configuration c
    WHERE c.singleton;
  END IF;
  IF v_org IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT v_org, CASE WHEN v_member IS NULL THEN 'applicant' ELSE 'student' END, v_member, v_profile;
END
$$;

CREATE FUNCTION platform_private.account_deletion_is_staff(p_auth_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM platform.profiles p
    JOIN platform.organization_memberships m ON m.profile_id = p.id
    WHERE p.auth_user_id = p_auth_user_id
      AND (m.is_system_admin OR m."current_role" IS DISTINCT FROM 'student'))
$$;

-- The rows reachable by foreign key from the account's Auth user, found by
-- the catalog (pg_constraint), never by a value: round after round, every
-- row whose foreign key points at a row reached in the previous round, plus
-- the journal entries (platform.audit_events of the organization) whose
-- resource_id is the id of a reached row. Rows of the Auth schema itself
-- (identities, sessions, factors) are left to auth.admin.deleteUser, and the
-- deletion requests are kept as the evidence. Only rows of the own tables
-- below are followed further; a reached row of any other table, or a
-- legacy V1 profile of another user, is named in 'other' and makes the
-- account manual. Returns {rows: {table: [ctid]}, other: [table], ids: [uuid]}.
-- ctids are valid for the caller's transaction (the processing deletes in
-- the same transaction, under the subject's advisory lock).
CREATE FUNCTION platform_private.account_deletion_closure(p_org UUID, p_auth_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  own CONSTANT TEXT[] := ARRAY[
    'platform.profiles', 'platform.organization_memberships',
    'platform.membership_role_history', 'platform.membership_permission_events',
    'platform.membership_scope_assignments',
    'platform_private.student_applications', 'platform_private.student_application_receipts',
    'public.accounts', 'public.profiles',
    'platform.notification_consents', 'platform.notification_consent_events',
    'platform_private.portal_consultation_requests', 'platform_private.university_favorites',
    'platform.student_assessment_attempts', 'platform_private.student_assessment_requests',
    'platform.learning_lesson_attempts', 'platform_private.learning_requests',
    'platform.audit_events'];
  reached JSONB := '{}'::JSONB;
  frontier JSONB;
  found JSONB;
  other TEXT[] := '{}';
  ids UUID[] := ARRAY[p_auth_user_id];
  round_ids UUID[];
  got TEXT[];
  got_ids UUID[];
  fresh JSONB;
  fk RECORD;
  t TEXT;
BEGIN
  SELECT jsonb_build_object('auth.users', jsonb_agg(u.ctid::TEXT)) INTO frontier
  FROM auth.users u WHERE u.id = p_auth_user_id HAVING count(*) > 0;
  IF frontier IS NULL THEN
    RETURN jsonb_build_object('rows', '{}'::JSONB, 'other', '[]'::JSONB, 'ids', '[]'::JSONB);
  END IF;
  reached := frontier;
  round_ids := ARRAY[p_auth_user_id];
  WHILE frontier <> '{}'::JSONB LOOP
    found := '{}'::JSONB;
    FOR fk IN
      SELECT format('%I.%I', cn.nspname, cc.relname) AS child, format('%I.%I', pn.nspname, pc.relname) AS parent,
        (SELECT string_agg(format('c.%I', a.attname), ', ' ORDER BY k.i)
           FROM unnest(con.conkey) WITH ORDINALITY k(n, i)
           JOIN pg_catalog.pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.n) AS ccols,
        (SELECT string_agg(format('p.%I', a.attname), ', ' ORDER BY k.i)
           FROM unnest(con.confkey) WITH ORDINALITY k(n, i)
           JOIN pg_catalog.pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.n) AS pcols
      FROM pg_catalog.pg_constraint con
      JOIN pg_catalog.pg_class cc ON cc.oid = con.conrelid AND cc.relkind IN ('r', 'p')
      JOIN pg_catalog.pg_namespace cn ON cn.oid = cc.relnamespace
      JOIN pg_catalog.pg_class pc ON pc.oid = con.confrelid
      JOIN pg_catalog.pg_namespace pn ON pn.oid = pc.relnamespace
      WHERE con.contype = 'f' AND con.conparentid = 0
        AND format('%I.%I', pn.nspname, pc.relname) IN (SELECT jsonb_object_keys(frontier))
        AND cn.nspname <> 'auth'
        AND format('%I.%I', cn.nspname, cc.relname) <> 'platform_private.account_deletion_requests'
      ORDER BY 1, 2, con.conname
    LOOP
      EXECUTE format('SELECT array_agg(c.ctid::TEXT) FROM %s c WHERE (%s) IN (SELECT %s FROM %s p WHERE p.ctid = ANY ($1))',
        fk.child, fk.ccols, fk.pcols, fk.parent)
      INTO got USING ARRAY(SELECT x::TID FROM jsonb_array_elements_text(frontier -> fk.parent) x);
      IF got IS NOT NULL THEN
        found := jsonb_set(found, ARRAY[fk.child], COALESCE(found -> fk.child, '[]'::JSONB) || to_jsonb(got));
      END IF;
    END LOOP;
    -- The journal entries about the rows reached in the previous round.
    IF cardinality(round_ids) > 0 THEN
      SELECT array_agg(e.ctid::TEXT) INTO got FROM platform.audit_events e
      WHERE e.organization_id = p_org AND e.resource_id = ANY (round_ids);
      IF got IS NOT NULL THEN
        found := jsonb_set(found, ARRAY['platform.audit_events'],
          COALESCE(found -> 'platform.audit_events', '[]'::JSONB) || to_jsonb(got));
      END IF;
    END IF;
    frontier := '{}'::JSONB;
    round_ids := '{}';
    FOR t IN SELECT jsonb_object_keys(found) LOOP
      SELECT jsonb_agg(DISTINCT x) INTO fresh FROM jsonb_array_elements_text(found -> t) x
      WHERE NOT COALESCE(reached -> t ? x, FALSE);
      CONTINUE WHEN fresh IS NULL;
      IF NOT (t = ANY (own)) THEN
        IF NOT (t = ANY (other)) THEN other := other || t; END IF;
        CONTINUE;
      END IF;
      reached := jsonb_set(reached, ARRAY[t], COALESCE(reached -> t, '[]'::JSONB) || fresh);
      frontier := jsonb_set(frontier, ARRAY[t], fresh);
      IF t <> 'platform.audit_events' AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
          WHERE a.attrelid = t::REGCLASS AND a.attname = 'id' AND a.atttypid = 'uuid'::REGTYPE AND NOT a.attisdropped) THEN
        EXECUTE format('SELECT array_agg(x.id) FROM %s x WHERE x.ctid = ANY ($1)', t) INTO got_ids
        USING ARRAY(SELECT y::TID FROM jsonb_array_elements_text(fresh) y);
        round_ids := round_ids || COALESCE(got_ids, '{}');
      END IF;
    END LOOP;
    ids := ids || round_ids;
  END LOOP;
  -- A legacy V1 account (public.accounts) the account shares with another user.
  IF EXISTS (SELECT 1 FROM public.profiles x
      WHERE x.ctid = ANY (ARRAY(SELECT y::TID FROM jsonb_array_elements_text(COALESCE(reached -> 'public.profiles', '[]'::JSONB)) y))
        AND x.user_id IS DISTINCT FROM p_auth_user_id)
    AND NOT ('public.profiles' = ANY (other)) THEN
    other := other || 'public.profiles'::TEXT;
  END IF;
  RETURN jsonb_build_object('rows', reached - 'auth.users',
    'other', to_jsonb(ARRAY(SELECT x FROM unnest(other) x ORDER BY x)),
    'ids', to_jsonb(ids));
END
$$;

-- Why an account is NOT simple (empty = simple), as reason codes for the
-- CRM: its student cases (its membership's, its анкета's, a case whose
-- invitation it accepted), an approved or converted анкета, a lead or client
-- (of its анкета or cases), payments, contract files, WhatsApp conversations
-- of those, a staff role, and 'other_records' when the closure reached a
-- table outside the own tables.
CREATE FUNCTION platform_private.account_deletion_blockers(p_org UUID, p_auth_user_id UUID, p_closure JSONB)
RETURNS TEXT[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH apps AS (
    SELECT a.* FROM platform_private.student_applications a WHERE a.auth_user_id = p_auth_user_id
  ), members AS (
    SELECT m.organization_id, m.id FROM platform.organization_memberships m
    JOIN platform.profiles p ON p.id = m.profile_id WHERE p.auth_user_id = p_auth_user_id
  ), cases AS (
    SELECT sc.organization_id, sc.id, sc.canonical_lead_id, sc.canonical_client_id FROM platform.student_cases sc
    WHERE (sc.organization_id, sc.student_membership_id) IN (SELECT organization_id, id FROM members)
      OR sc.public_application_id IN (SELECT id FROM apps)
      OR sc.id IN (SELECT x FROM apps a, unnest(ARRAY[a.student_case_id, a.invited_case_id]) x WHERE x IS NOT NULL)
      OR sc.id IN (SELECT pr.student_case_id FROM platform_private.student_portal_provisioning_receipts pr
        WHERE pr.auth_user_id = p_auth_user_id)
  ), leads AS (
    SELECT a.organization_id, a.canonical_lead_id AS id FROM apps a WHERE a.canonical_lead_id IS NOT NULL
    UNION SELECT c.organization_id, c.canonical_lead_id FROM cases c WHERE c.canonical_lead_id IS NOT NULL
  ), clients AS (
    SELECT l.organization_id, l.client_id AS id FROM platform.leads l
    WHERE (l.organization_id, l.id) IN (SELECT organization_id, id FROM leads) AND l.client_id IS NOT NULL
    UNION SELECT c.organization_id, c.canonical_client_id FROM cases c WHERE c.canonical_client_id IS NOT NULL
  )
  SELECT array_remove(ARRAY[
    CASE WHEN platform_private.account_deletion_is_staff(p_auth_user_id) THEN 'staff' END,
    CASE WHEN EXISTS (SELECT 1 FROM cases) THEN 'case' END,
    CASE WHEN EXISTS (SELECT 1 FROM apps a WHERE a.status = 'approved'
      OR a.student_case_id IS NOT NULL OR a.invited_case_id IS NOT NULL) THEN 'application_converted' END,
    CASE WHEN EXISTS (SELECT 1 FROM leads) THEN 'lead' END,
    CASE WHEN EXISTS (SELECT 1 FROM clients) THEN 'client' END,
    CASE WHEN EXISTS (SELECT 1 FROM platform.payment_obligations o
        WHERE (o.organization_id, o.student_case_id) IN (SELECT organization_id, id FROM cases))
      OR EXISTS (SELECT 1 FROM platform.payment_events e
        WHERE (e.organization_id, e.student_case_id) IN (SELECT organization_id, id FROM cases)) THEN 'payment' END,
    CASE WHEN EXISTS (SELECT 1 FROM platform.case_contract_files f
      WHERE (f.organization_id, f.student_case_id) IN (SELECT organization_id, id FROM cases)) THEN 'contract_file' END,
    CASE WHEN EXISTS (SELECT 1 FROM platform.communication_conversations c
      WHERE (c.organization_id, c.student_case_id) IN (SELECT organization_id, id FROM cases)
        OR (c.organization_id, c.canonical_lead_id) IN (SELECT organization_id, id FROM leads)
        OR (c.organization_id, c.canonical_client_id) IN (SELECT organization_id, id FROM clients)) THEN 'whatsapp' END,
    CASE WHEN jsonb_array_length(COALESCE(p_closure -> 'other', '[]'::JSONB)) > 0 THEN 'other_records' END
  ], NULL)
$$;

-- The check every caller uses: the explicit reasons first (cheap); only an
-- account without one gets its closure walked. {reasons: [...], closure:
-- {...} or null}; no reason = simple.
CREATE FUNCTION platform_private.account_deletion_check(p_org UUID, p_auth_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE reasons TEXT[]; closure JSONB;
BEGIN
  reasons := platform_private.account_deletion_blockers(p_org, p_auth_user_id, NULL);
  IF cardinality(reasons) = 0 THEN
    closure := platform_private.account_deletion_closure(p_org, p_auth_user_id);
    reasons := platform_private.account_deletion_blockers(p_org, p_auth_user_id, closure);
  END IF;
  RETURN jsonb_build_object('reasons', to_jsonb(reasons), 'closure', closure);
END
$$;

-- Counts of the own rows by what they are, for the CRM (no personal value).
CREATE FUNCTION platform_private.account_deletion_counts(p_closure JSONB)
RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'application', COALESCE(sum(n) FILTER (WHERE g = 'application'), 0),
    'profile', COALESCE(sum(n) FILTER (WHERE g = 'profile'), 0),
    'consultations', COALESCE(sum(n) FILTER (WHERE g = 'consultations'), 0),
    'favourites', COALESCE(sum(n) FILTER (WHERE g = 'favourites'), 0),
    'tests', COALESCE(sum(n) FILTER (WHERE g = 'tests'), 0),
    'journal', COALESCE(sum(n) FILTER (WHERE g = 'journal'), 0))
  FROM (
    SELECT CASE
        WHEN t.key IN ('platform_private.student_applications', 'platform_private.student_application_receipts')
          THEN 'application'
        WHEN t.key = 'platform_private.portal_consultation_requests' THEN 'consultations'
        WHEN t.key = 'platform_private.university_favorites' THEN 'favourites'
        WHEN t.key IN ('platform.student_assessment_attempts', 'platform_private.student_assessment_requests',
          'platform.learning_lesson_attempts', 'platform_private.learning_requests') THEN 'tests'
        WHEN t.key = 'platform.audit_events' THEN 'journal'
        ELSE 'profile' END AS g,
      jsonb_array_length(t.value) AS n
    FROM jsonb_each(COALESCE(p_closure -> 'rows', '{}'::JSONB)) t
  ) q
$$;

-- Deletes exactly the rows of the closure (never the Auth user: the server
-- deletes it through the Auth Admin API). Children first: a table whose
-- delete hits a foreign key of another own row waits for the next pass.
-- Runs only with the bypass marker of this transaction set by the caller.
CREATE FUNCTION platform_private.account_deletion_erase(p_closure JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  remaining JSONB := COALESCE(p_closure -> 'rows', '{}'::JSONB) - 'auth.users';
  deleted JSONB := '{}'::JSONB;
  progress BOOLEAN;
  t TEXT;
  n BIGINT;
BEGIN
  FOR pass IN 1..64 LOOP
    EXIT WHEN remaining = '{}'::JSONB;
    progress := FALSE;
    FOR t IN SELECT k FROM jsonb_object_keys(remaining) k
      ORDER BY k IN ('platform.profiles', 'platform.organization_memberships',
        'platform_private.student_applications', 'public.accounts'), k
    LOOP
      BEGIN
        EXECUTE format('DELETE FROM %s x WHERE x.ctid = ANY ($1)', t)
        USING ARRAY(SELECT y::TID FROM jsonb_array_elements_text(remaining -> t) y);
        GET DIAGNOSTICS n = ROW_COUNT;
        deleted := deleted || jsonb_build_object(t, n);
        remaining := remaining - t;
        progress := TRUE;
      EXCEPTION WHEN foreign_key_violation THEN
        NULL;
      END;
    END LOOP;
    EXIT WHEN NOT progress;
  END LOOP;
  IF remaining <> '{}'::JSONB THEN
    RAISE EXCEPTION 'account_deletion_incomplete' USING ERRCODE = '55000',
      DETAIL = (SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(remaining) k);
  END IF;
  RETURN deleted;
END
$$;

REVOKE ALL ON FUNCTION
  platform_private.account_deletion_subject(UUID),
  platform_private.account_deletion_is_staff(UUID),
  platform_private.account_deletion_closure(UUID, UUID),
  platform_private.account_deletion_blockers(UUID, UUID, JSONB),
  platform_private.account_deletion_check(UUID, UUID),
  platform_private.account_deletion_counts(JSONB),
  platform_private.account_deletion_erase(JSONB)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Staff caller with account.deletion.process (the system Admin).
CREATE FUNCTION platform_private.account_deletion_staff_actor()
RETURNS TABLE (organization_id UUID, membership_id UUID, profile_id UUID, auth_user_id UUID)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN QUERY
  SELECT a.organization_id, a.membership_id, a.profile_id, a.auth_user_id
  FROM platform.current_actor_authority() a
  WHERE a.membership_id IS NOT NULL AND a.platform_role IS DISTINCT FROM 'student'
    AND platform_private.staff_has_permission(a.organization_id, a.membership_id, 'account.deletion.process')
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_deletion_forbidden' USING ERRCODE = '42501';
  END IF;
END
$$;

-- The neutral label a completed request shows: «Удалённый пользователь · 1a2b3c4d».
CREATE FUNCTION platform_private.account_deletion_label(p_request_row_id UUID)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT 'Удалённый пользователь · ' || left(replace(p_request_row_id::TEXT, '-', ''), 8)
$$;

-- Whether the account can still sign in: 'active', 'disabled' (soft-deleted
-- by auth.admin.deleteUser(id, true): the row stays, deleted_at is set) or
-- 'absent'. deleted_at is read through jsonb so the function does not depend
-- on the Auth schema version.
CREATE FUNCTION platform_private.account_deletion_login(p_auth_user_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((SELECT CASE WHEN to_jsonb(u) ->> 'deleted_at' IS NULL THEN 'active' ELSE 'disabled' END
    FROM auth.users u WHERE u.id = p_auth_user_id), 'absent')
$$;

REVOKE ALL ON FUNCTION
  platform_private.account_deletion_staff_actor(),
  platform_private.account_deletion_label(UUID),
  platform_private.account_deletion_login(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- f) Student/applicant side: only for the caller's own account.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.account_deletion_receipt(r platform_private.account_deletion_requests)
RETURNS JSONB LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'requestId', r.request_id,
    'status', CASE WHEN r.status = 'acknowledged' THEN 'requested' ELSE r.status END,
    'requestedAt', r.created_at,
    'dueAt', r.due_at)
$$;
REVOKE ALL ON FUNCTION platform_private.account_deletion_receipt(platform_private.account_deletion_requests)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE FUNCTION platform.request_account_deletion_v2(p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  uid UUID := auth.uid();
  subject RECORD;
  existing platform_private.account_deletion_requests%ROWTYPE;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'account_deletion_unavailable' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'account_deletion_invalid' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('evo:account-deletion-subject:' || uid::TEXT, 0));
  SELECT * INTO subject FROM platform_private.account_deletion_subject(uid);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_deletion_unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO existing FROM platform_private.account_deletion_requests r
  WHERE r.subject_auth_user_id = uid AND r.request_id = p_request_id;
  IF NOT FOUND THEN
    SELECT * INTO existing FROM platform_private.account_deletion_requests r
    WHERE r.subject_auth_user_id = uid AND r.status IN ('requested', 'acknowledged', 'processing')
    ORDER BY r.created_at DESC LIMIT 1;
  END IF;
  IF FOUND THEN
    RETURN platform_private.account_deletion_receipt(existing);
  END IF;

  INSERT INTO platform_private.account_deletion_requests (
    organization_id, membership_id, request_id, subject_auth_user_id, subject_kind
  ) VALUES (subject.organization_id, subject.membership_id, p_request_id, uid, subject.subject_kind)
  RETURNING * INTO existing;

  -- The journal entry names the account by its Auth id only (no profile
  -- foreign key), so it stays as evidence after the automatic erasure.
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_principal,
    action, resource_type, resource_id, after_state, reason, request_id
  ) VALUES (
    existing.organization_id, 'system', 'auth:' || uid::TEXT,
    'account.deletion.request', 'account_deletion_request', existing.id,
    jsonb_build_object('subject_kind', existing.subject_kind, 'due_at', existing.due_at),
    'Account deletion requested by the account holder',
    public.uuid_generate_v5(existing.id, 'account.deletion.request')
  );
  RETURN platform_private.account_deletion_receipt(existing);
END
$$;

CREATE FUNCTION platform.own_account_deletion_request_v1()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE uid UUID := auth.uid(); subject RECORD; existing platform_private.account_deletion_requests%ROWTYPE;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'account_deletion_unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO subject FROM platform_private.account_deletion_subject(uid);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_deletion_unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO existing FROM platform_private.account_deletion_requests r
  WHERE r.subject_auth_user_id = uid AND r.status IN ('requested', 'acknowledged', 'processing')
  ORDER BY r.created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN 'null'::JSONB; END IF;
  RETURN platform_private.account_deletion_receipt(existing);
END
$$;

-- ---------------------------------------------------------------------------
-- f) Staff side: queue, detail, process, complete, mark done, email status.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.account_deletion_person(r platform_private.account_deletion_requests)
RETURNS TABLE (display_name TEXT, email TEXT, student_case_id UUID)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_name TEXT; v_email TEXT; v_case UUID;
BEGIN
  IF r.status = 'completed' THEN
    RETURN QUERY SELECT platform_private.account_deletion_label(r.id), NULL::TEXT, NULL::UUID;
    RETURN;
  END IF;
  SELECT u.email INTO v_email FROM auth.users u
  WHERE u.id = r.subject_auth_user_id AND to_jsonb(u) ->> 'deleted_at' IS NULL;
  SELECT p.display_name INTO v_name FROM platform.profiles p WHERE p.auth_user_id = r.subject_auth_user_id;
  IF v_name IS NULL THEN
    SELECT btrim((a.questionnaire ->> 'firstName') || ' ' || (a.questionnaire ->> 'lastName')) INTO v_name
    FROM platform_private.student_applications a WHERE a.auth_user_id = r.subject_auth_user_id;
  END IF;
  SELECT sc.id INTO v_case FROM platform.student_cases sc
  JOIN platform.organization_memberships m ON m.organization_id = sc.organization_id AND m.id = sc.student_membership_id
  JOIN platform.profiles p ON p.id = m.profile_id
  WHERE p.auth_user_id = r.subject_auth_user_id
  ORDER BY sc.created_at, sc.id LIMIT 1;
  IF v_case IS NULL THEN
    SELECT COALESCE(a.student_case_id, a.invited_case_id) INTO v_case FROM platform_private.student_applications a
    WHERE a.auth_user_id = r.subject_auth_user_id;
  END IF;
  RETURN QUERY SELECT COALESCE(NULLIF(v_name, ''), v_email, NULLIF(r.confirmation_email, ''),
    platform_private.account_deletion_label(r.id)), COALESCE(v_email, r.confirmation_email), v_case;
END
$$;
REVOKE ALL ON FUNCTION platform_private.account_deletion_person(platform_private.account_deletion_requests)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- How an open request is processed now: 'automatic' when the account still
-- exists and is simple (or automatic processing already started), else
-- 'manual'; with the reasons and the other tables the closure reached.
CREATE FUNCTION platform_private.account_deletion_plan(r platform_private.account_deletion_requests)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE chk JSONB; login TEXT;
BEGIN
  IF r.status = 'completed' THEN
    RETURN jsonb_build_object('mode', r.completion_mode, 'reasons', '[]'::JSONB, 'otherTables', '[]'::JSONB,
      'counts', COALESCE(r.summary -> 'counts', '{}'::JSONB),
      'login', platform_private.account_deletion_login(r.subject_auth_user_id));
  END IF;
  chk := platform_private.account_deletion_check(r.organization_id, r.subject_auth_user_id);
  login := platform_private.account_deletion_login(r.subject_auth_user_id);
  RETURN jsonb_build_object(
    'mode', CASE WHEN r.status = 'processing' OR (jsonb_array_length(chk -> 'reasons') = 0 AND login <> 'absent')
      THEN 'automatic' ELSE 'manual' END,
    'reasons', chk -> 'reasons',
    'otherTables', COALESCE(chk #> '{closure,other}', '[]'::JSONB),
    'counts', platform_private.account_deletion_counts(chk -> 'closure'),
    'login', login);
END
$$;
REVOKE ALL ON FUNCTION platform_private.account_deletion_plan(platform_private.account_deletion_requests)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE FUNCTION platform_private.account_deletion_queue_row(r platform_private.account_deletion_requests)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', r.id,
    'kind', r.subject_kind,
    'status', CASE WHEN r.status = 'acknowledged' THEN 'requested' ELSE r.status END,
    'mode', plan ->> 'mode',
    'displayName', person.display_name,
    'email', person.email,
    'studentCaseId', person.student_case_id,
    'requestedAt', r.created_at,
    'dueAt', r.due_at,
    'overdue', r.status <> 'completed' AND r.due_at < clock_timestamp(),
    'processingStartedAt', r.processing_started_at,
    'completedAt', r.completed_at,
    'confirmationEmailStatus', r.confirmation_email_status)
  FROM platform_private.account_deletion_person(r) person,
    platform_private.account_deletion_plan(r) plan
$$;
REVOKE ALL ON FUNCTION platform_private.account_deletion_queue_row(platform_private.account_deletion_requests)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE FUNCTION platform.staff_account_deletion_queue_v1()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD;
BEGIN
  SELECT * INTO actor FROM platform_private.account_deletion_staff_actor();
  RETURN COALESCE((
    SELECT jsonb_agg(platform_private.account_deletion_queue_row(q.r) ORDER BY q.sort_group, q.sort_at, (q.r).id)
    FROM (
      SELECT r, CASE WHEN r.status = 'completed' THEN 1 ELSE 0 END AS sort_group,
        CASE WHEN r.status = 'completed' THEN -extract(epoch FROM r.completed_at) ELSE extract(epoch FROM r.due_at) END AS sort_at
      FROM platform_private.account_deletion_requests r
      WHERE r.organization_id = actor.organization_id
        AND (r.status <> 'completed' OR r.completed_at > clock_timestamp() - INTERVAL '180 days')
      ORDER BY sort_group, sort_at, r.id
      LIMIT 200
    ) q
  ), '[]'::JSONB);
END
$$;

CREATE FUNCTION platform.staff_account_deletion_detail_v1(p_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; r platform_private.account_deletion_requests%ROWTYPE; plan JSONB;
BEGIN
  SELECT * INTO actor FROM platform_private.account_deletion_staff_actor();
  SELECT * INTO r FROM platform_private.account_deletion_requests x
  WHERE x.id = p_id AND x.organization_id = actor.organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_deletion_not_found' USING ERRCODE = '42501';
  END IF;
  plan := platform_private.account_deletion_plan(r);
  RETURN platform_private.account_deletion_queue_row(r) || jsonb_build_object(
    'reasons', plan -> 'reasons',
    'otherTables', plan -> 'otherTables',
    'counts', plan -> 'counts',
    'login', plan -> 'login',
    'manualNote', r.manual_note,
    'processingStartedBy', (SELECT p.display_name FROM platform.organization_memberships m
      JOIN platform.profiles p ON p.id = m.profile_id
      WHERE m.organization_id = r.organization_id AND m.id = r.processing_started_by_membership_id),
    'completedBy', (SELECT p.display_name FROM platform.organization_memberships m
      JOIN platform.profiles p ON p.id = m.profile_id
      WHERE m.organization_id = r.organization_id AND m.id = r.completed_by_membership_id));
END
$$;

CREATE FUNCTION platform_private.account_deletion_result(r platform_private.account_deletion_requests)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', r.id,
    'status', r.status,
    'mode', r.completion_mode,
    'authUserId', CASE WHEN r.status = 'processing'
      THEN (SELECT u.id FROM auth.users u WHERE u.id = r.subject_auth_user_id) END,
    -- The address only until the email status is recorded.
    'email', CASE WHEN r.confirmation_email_status IS NULL THEN r.confirmation_email END,
    'emailStatus', r.confirmation_email_status)
$$;
REVOKE ALL ON FUNCTION platform_private.account_deletion_result(platform_private.account_deletion_requests)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- AUTOMATIC, database part. Refuses (account_deletion_not_simple, the reason
-- codes in DETAIL) whenever the account is not simple: the database is the
-- guard, not the CRM screen. Deletes exactly the closure in one transaction;
-- re-runnable.
CREATE FUNCTION platform.process_account_deletion_v1(p_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  r platform_private.account_deletion_requests%ROWTYPE;
  chk JSONB;
  closure JSONB;
  deleted JSONB;
  v_email TEXT;
  first_run BOOLEAN;
BEGIN
  SELECT * INTO actor FROM platform_private.account_deletion_staff_actor();
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'account_deletion_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM platform_private.account_deletion_requests x
  WHERE x.id = p_id AND x.organization_id = actor.organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_deletion_not_found' USING ERRCODE = '42501';
  END IF;
  IF r.status = 'completed' THEN
    RETURN platform_private.account_deletion_result(r);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('evo:account-deletion-subject:' || r.subject_auth_user_id::TEXT, 0));

  chk := platform_private.account_deletion_check(r.organization_id, r.subject_auth_user_id);
  IF jsonb_array_length(chk -> 'reasons') > 0 THEN
    RAISE EXCEPTION 'account_deletion_not_simple' USING ERRCODE = '55000',
      DETAIL = (SELECT string_agg(x, ',') FROM jsonb_array_elements_text(chk -> 'reasons') x);
  END IF;
  closure := COALESCE(chk -> 'closure', '{}'::JSONB);
  first_run := r.status IN ('requested', 'acknowledged');
  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = r.subject_auth_user_id;

  -- The kept request rows of this account stop naming its membership.
  UPDATE platform_private.account_deletion_requests x SET membership_id = NULL
  WHERE x.subject_auth_user_id = r.subject_auth_user_id AND x.membership_id IS NOT NULL;
  UPDATE platform_private.account_deletion_requests x SET
    erasure_transaction_id = pg_catalog.pg_current_xact_id(),
    confirmation_email = COALESCE(v_email, x.confirmation_email)
  WHERE x.id = r.id;
  PERFORM pg_catalog.set_config('platform.account_erasure_request_id', r.id::TEXT, TRUE);
  deleted := platform_private.account_deletion_erase(closure);
  PERFORM pg_catalog.set_config('platform.account_erasure_request_id', '', TRUE);
  PERFORM platform_private.account_deletion_auth_log_erase(r.subject_auth_user_id);

  UPDATE platform_private.account_deletion_requests x SET
    erasure_transaction_id = NULL,
    status = 'processing',
    processing_started_at = COALESCE(x.processing_started_at, clock_timestamp()),
    processing_started_by_membership_id = COALESCE(x.processing_started_by_membership_id, actor.membership_id),
    last_processed_at = clock_timestamp(),
    summary = CASE WHEN first_run OR x.summary IS NULL
      THEN jsonb_build_object('counts', platform_private.account_deletion_counts(closure)) ELSE x.summary END
  WHERE x.id = r.id
  RETURNING * INTO r;

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_membership_id, actor_principal,
    action, resource_type, resource_id, after_state, reason, request_id
  ) VALUES (
    r.organization_id, 'user', actor.profile_id, actor.membership_id, 'auth:' || actor.auth_user_id::TEXT,
    'account.deletion.process', 'account_deletion_request', r.id,
    jsonb_build_object('status', r.status, 'subject_kind', r.subject_kind, 'deleted', deleted),
    CASE WHEN first_run THEN 'Own rows of a simple account deleted in the database'
      ELSE 'Own rows of a simple account deleted again in the database' END,
    gen_random_uuid()
  );
  RETURN platform_private.account_deletion_result(r);
END
$$;

-- AUTOMATIC, last step: the database itself checks that the Auth user is
-- gone (every own row referenced it by foreign key, so none can be left).
CREATE FUNCTION platform.complete_account_deletion_v1(p_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; r platform_private.account_deletion_requests%ROWTYPE;
BEGIN
  SELECT * INTO actor FROM platform_private.account_deletion_staff_actor();
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'account_deletion_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM platform_private.account_deletion_requests x
  WHERE x.id = p_id AND x.organization_id = actor.organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_deletion_not_found' USING ERRCODE = '42501';
  END IF;
  IF r.status = 'completed' THEN
    RETURN platform_private.account_deletion_result(r);
  END IF;
  IF r.status <> 'processing' THEN
    RAISE EXCEPTION 'account_deletion_not_processed' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users u WHERE u.id = r.subject_auth_user_id) THEN
    RAISE EXCEPTION 'account_deletion_auth_user_exists' USING ERRCODE = '55000';
  END IF;
  -- deleteUser wrote its own «user_deleted» entry.
  PERFORM platform_private.account_deletion_auth_log_erase(r.subject_auth_user_id);
  UPDATE platform_private.account_deletion_requests x SET
    status = 'completed', completion_mode = 'automatic',
    completed_at = clock_timestamp(), completed_by_membership_id = actor.membership_id
  WHERE x.id = r.id
  RETURNING * INTO r;
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_membership_id, actor_principal,
    action, resource_type, resource_id, after_state, reason, request_id
  ) VALUES (
    r.organization_id, 'user', actor.profile_id, actor.membership_id, 'auth:' || actor.auth_user_id::TEXT,
    'account.deletion.complete', 'account_deletion_request', r.id,
    jsonb_build_object('status', r.status, 'mode', r.completion_mode, 'subject_kind', r.subject_kind),
    'Account deletion completed automatically', gen_random_uuid()
  );
  RETURN platform_private.account_deletion_result(r);
END
$$;

-- MANUAL: the Admin marks the request done after the team has deleted or
-- anonymized everything (docs/runbooks/account-deletion.md). The note is
-- required (what was done, without personal values); the login must no
-- longer work (deleted, or soft-deleted by the Auth Admin API); a simple
-- account must use the automatic path instead.
CREATE FUNCTION platform.mark_account_deletion_done_v1(p_id UUID, p_note TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  r platform_private.account_deletion_requests%ROWTYPE;
  reasons JSONB;
  login TEXT;
  note TEXT := btrim(p_note);
BEGIN
  SELECT * INTO actor FROM platform_private.account_deletion_staff_actor();
  IF p_id IS NULL OR note IS NULL OR char_length(note) NOT BETWEEN 10 AND 2000
    OR note ~ '[\x01-\x09\x0b-\x1f\x7f]' THEN
    RAISE EXCEPTION 'account_deletion_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM platform_private.account_deletion_requests x
  WHERE x.id = p_id AND x.organization_id = actor.organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_deletion_not_found' USING ERRCODE = '42501';
  END IF;
  IF r.status = 'completed' THEN
    RETURN platform_private.account_deletion_result(r);
  END IF;
  IF r.status = 'processing' THEN
    RAISE EXCEPTION 'account_deletion_processing' USING ERRCODE = '55000';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('evo:account-deletion-subject:' || r.subject_auth_user_id::TEXT, 0));
  login := platform_private.account_deletion_login(r.subject_auth_user_id);
  IF login <> 'absent' THEN
    reasons := platform_private.account_deletion_check(r.organization_id, r.subject_auth_user_id) -> 'reasons';
    IF jsonb_array_length(reasons) = 0 THEN
      RAISE EXCEPTION 'account_deletion_automatic_available' USING ERRCODE = '55000';
    END IF;
  END IF;
  IF login = 'active' THEN
    RAISE EXCEPTION 'account_deletion_login_active' USING ERRCODE = '55000';
  END IF;
  UPDATE platform_private.account_deletion_requests x SET
    status = 'completed', completion_mode = 'manual', manual_note = note,
    completed_at = clock_timestamp(), completed_by_membership_id = actor.membership_id
  WHERE x.id = r.id
  RETURNING * INTO r;
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_membership_id, actor_principal,
    action, resource_type, resource_id, after_state, reason, request_id
  ) VALUES (
    r.organization_id, 'user', actor.profile_id, actor.membership_id, 'auth:' || actor.auth_user_id::TEXT,
    'account.deletion.manual.complete', 'account_deletion_request', r.id,
    jsonb_build_object('status', r.status, 'mode', r.completion_mode, 'subject_kind', r.subject_kind,
      'reasons', COALESCE(reasons, '[]'::JSONB), 'login', login),
    note, gen_random_uuid()
  );
  RETURN platform_private.account_deletion_result(r);
END
$$;

-- The confirmation email's outcome, once, for a completed request; the
-- address is dropped with it.
CREATE FUNCTION platform.record_account_deletion_email_v1(p_id UUID, p_status TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; r platform_private.account_deletion_requests%ROWTYPE;
BEGIN
  SELECT * INTO actor FROM platform_private.account_deletion_staff_actor();
  IF p_id IS NULL OR p_status IS NULL OR p_status NOT IN ('sent', 'failed', 'not_configured', 'no_address') THEN
    RAISE EXCEPTION 'account_deletion_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM platform_private.account_deletion_requests x
  WHERE x.id = p_id AND x.organization_id = actor.organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_deletion_not_found' USING ERRCODE = '42501';
  END IF;
  IF r.status <> 'completed' THEN
    RAISE EXCEPTION 'account_deletion_not_completed' USING ERRCODE = '55000';
  END IF;
  IF r.confirmation_email_status IS NULL THEN
    UPDATE platform_private.account_deletion_requests x SET
      confirmation_email_status = p_status, confirmation_email = NULL
    WHERE x.id = r.id
    RETURNING * INTO r;
    INSERT INTO platform.audit_events (
      organization_id, actor_kind, actor_profile_id, actor_membership_id, actor_principal,
      action, resource_type, resource_id, after_state, reason, request_id
    ) VALUES (
      r.organization_id, 'user', actor.profile_id, actor.membership_id, 'auth:' || actor.auth_user_id::TEXT,
      'account.deletion.email', 'account_deletion_request', r.id,
      jsonb_build_object('email_status', r.confirmation_email_status),
      'Account deletion confirmation email', gen_random_uuid()
    );
  END IF;
  RETURN platform_private.account_deletion_result(r);
END
$$;

-- ---------------------------------------------------------------------------
-- Grants and self-check.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  platform.request_account_deletion_v2(UUID),
  platform.own_account_deletion_request_v1(),
  platform.staff_account_deletion_queue_v1(),
  platform.staff_account_deletion_detail_v1(UUID),
  platform.process_account_deletion_v1(UUID),
  platform.complete_account_deletion_v1(UUID),
  platform.mark_account_deletion_done_v1(UUID, TEXT),
  platform.record_account_deletion_email_v1(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION
  platform.request_account_deletion_v2(UUID),
  platform.own_account_deletion_request_v1(),
  platform.staff_account_deletion_queue_v1(),
  platform.staff_account_deletion_detail_v1(UUID),
  platform.process_account_deletion_v1(UUID),
  platform.complete_account_deletion_v1(UUID),
  platform.mark_account_deletion_done_v1(UUID, TEXT),
  platform.record_account_deletion_email_v1(UUID, TEXT)
  TO authenticated;

DO $a279_verify$
DECLARE routine RECORD;
BEGIN
  FOR routine IN SELECT p.oid::REGPROCEDURE AS signature, p.prosecdef, p.proconfig
    FROM pg_catalog.pg_proc p
    WHERE p.oid IN (
      'platform.request_account_deletion_v2(uuid)'::REGPROCEDURE,
      'platform.own_account_deletion_request_v1()'::REGPROCEDURE,
      'platform.staff_account_deletion_queue_v1()'::REGPROCEDURE,
      'platform.staff_account_deletion_detail_v1(uuid)'::REGPROCEDURE,
      'platform.process_account_deletion_v1(uuid)'::REGPROCEDURE,
      'platform.complete_account_deletion_v1(uuid)'::REGPROCEDURE,
      'platform.mark_account_deletion_done_v1(uuid,text)'::REGPROCEDURE,
      'platform.record_account_deletion_email_v1(uuid,text)'::REGPROCEDURE,
      'platform_private.account_erasure_bypass()'::REGPROCEDURE,
      'platform_private.account_deletion_closure(uuid,uuid)'::REGPROCEDURE,
      'platform_private.account_deletion_blockers(uuid,uuid,jsonb)'::REGPROCEDURE,
      'platform_private.account_deletion_check(uuid,uuid)'::REGPROCEDURE,
      'platform_private.account_deletion_erase(jsonb)'::REGPROCEDURE)
  LOOP
    IF NOT routine.prosecdef OR routine.proconfig IS DISTINCT FROM ARRAY['search_path=""'] THEN
      RAISE EXCEPTION 'a279_account_deletion_verification_failed: %', routine.signature;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'platform.process_account_deletion_v1(uuid)', 'EXECUTE')
    OR has_function_privilege('service_role', 'platform.process_account_deletion_v1(uuid)', 'EXECUTE')
    OR has_function_privilege('anon', 'platform.mark_account_deletion_done_v1(uuid,text)', 'EXECUTE')
    OR has_function_privilege('service_role', 'platform.mark_account_deletion_done_v1(uuid,text)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'platform_private.account_erasure_bypass()', 'EXECUTE')
    OR has_function_privilege('authenticated', 'platform_private.account_deletion_erase(jsonb)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'platform_private.account_deletion_closure(uuid,uuid)', 'EXECUTE')
    OR (SELECT count(*) FROM pg_catalog.pg_proc p
        WHERE strpos(p.prosrc, '279: account erasure bypass') <> 0) <> 4
  THEN
    RAISE EXCEPTION 'a279_account_deletion_verification_failed: grants or guards';
  END IF;
END
$a279_verify$;

NOTIFY pgrst, 'reload schema';
COMMIT;
