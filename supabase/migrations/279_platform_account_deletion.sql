-- 279 «Удаление аккаунта по запросу: кабинет, iPhone и очередь в CRM».
-- docs/PLAN_CHANGES.md «2026-10-07 — Удаление аккаунта по запросу: кабинет,
-- iPhone и очередь в CRM (миграция 279)»; решения владельца 07.10.2026.
--
-- Why. 196 recorded a deletion REQUEST (student with a membership only) and
-- 244 let the Admin read the list, but nothing ever processed a request, and
-- an account created by the public анкета (no membership until approval) was
-- refused with 42501. App Store 5.1.1(v) needs deletion that starts in the
-- app and really completes.
--
-- What this migration adds (forward-only; no released RPC is replaced):
--  a) permission 'account.deletion.process' (system-only, «Настройки»): only
--     the system Admin holds it through staff_has_permission; it cannot be put
--     into a role. No new coarse role.
--  b) platform_private.account_deletion_requests (196) is EXTENDED: the
--     subject is the Auth account (subject_auth_user_id), membership_id may be
--     NULL for an applicant, statuses 'processing' and 'completed', due_at =
--     request + 30 days, one open request per account. A BEFORE INSERT trigger
--     fills the new columns for rows the released request_account_deletion_v1
--     still writes. platform_private.account_deletion_storage_objects lists the
--     Storage keys the server route must remove.
--  c) platform.profiles.auth_user_id may become NULL, but only on a blocked
--     profile: an erased profile stays as a tombstone (the journal and the
--     kept contract/payment rows reference it) and lets the Auth user go.
--     student_cases_intake_origin_check accepts an erased public-application
--     case whose application row was deleted.
--  d) Erasure bypass bound to ONE transaction: process_account_deletion_v1
--     sets platform.account_erasure_request_id and stores
--     pg_current_xact_id() on its request row; the guard trigger functions
--     listed in (f) return early for UPDATE/DELETE only when both match the
--     current transaction (the guard_student_case_identity_e1 receipt
--     pattern). INSERT and TRUNCATE are never bypassed; any other transaction
--     sees the guards exactly as before.
--  e) RPCs (SECURITY DEFINER, search_path '', EXECUTE to authenticated only):
--     request_account_deletion_v2 / own_account_deletion_request_v1 (any
--     signed-in account that is not staff), staff_account_deletion_queue_v1 /
--     staff_account_deletion_detail_v1 / process_account_deletion_v1 /
--     complete_account_deletion_v1 (account.deletion.process).
--
-- Processing is two-step. process_* deletes and anonymizes database rows in
-- one transaction (re-runnable: every step is idempotent), records the
-- Storage keys and returns them with the Auth user id. The CRM server route
-- removes the objects through the Storage API and the user through
-- auth.admin.deleteUser, then complete_* checks in the database that the Auth
-- user and every listed object are really gone before it marks the request
-- completed. A failure at any step leaves 'processing'; retry is safe.
--
-- Deleted / anonymized / kept: see the spec table in PLAN_CHANGES. After the
-- independent review (PLAN_CHANGES 2026-10-08) the WhatsApp sales
-- correspondence of the subject is deleted too: its conversations with every
-- dependent row (messages, media and their files, WAHA bindings and raw
-- webhook events, AI memory, drafts, answers, autosend journal, amoCRM
-- context). amoCRM itself is outside the database: completion requires the
-- Admin's confirmation that the contact and the deal are deleted there.
-- Only unambiguous identifiers (email, phone of 9+ digits, passport number)
-- are scrubbed across the organization; names and addresses only in the rows
-- of the subject.
BEGIN;

-- ---------------------------------------------------------------------------
-- Anchors.
-- ---------------------------------------------------------------------------
DO $a279_anchors$
BEGIN
  IF to_regclass('platform_private.account_deletion_requests') IS NULL
    OR to_regprocedure('platform.request_account_deletion_v1(uuid)') IS NULL
    OR to_regprocedure('platform.set_student_case_closed_v1(uuid,uuid,bigint,boolean,text,text,uuid)') IS NULL
    OR to_regprocedure('platform_private.staff_has_permission(uuid,uuid,text)') IS NULL
    OR to_regprocedure('public.uuid_generate_v5(uuid,text)') IS NULL
    OR EXISTS (SELECT 1 FROM platform.permission_definitions WHERE permission_key = 'account.deletion.process')
    OR (SELECT c.is_nullable FROM information_schema.columns c
        WHERE c.table_schema = 'platform' AND c.table_name = 'profiles' AND c.column_name = 'auth_user_id') <> 'NO'
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'platform.student_cases'::REGCLASS AND conname = 'student_cases_intake_origin_check')
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
  due_at = r.created_at + INTERVAL '30 days'
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
  ADD CONSTRAINT account_deletion_requests_kind_check
    CHECK (subject_kind IN ('student', 'applicant')
      AND (membership_id IS NULL) = (subject_kind = 'applicant')),
  ADD CONSTRAINT account_deletion_requests_email_status_check
    CHECK (confirmation_email_status IS NULL
      OR confirmation_email_status IN ('sent', 'failed', 'not_configured', 'no_address')),
  ADD CONSTRAINT account_deletion_requests_summary_check
    CHECK (summary IS NULL OR jsonb_typeof(summary) = 'object'),
  ADD CONSTRAINT account_deletion_requests_shape_check CHECK (
    (status = 'requested' AND acknowledged_at IS NULL AND acknowledged_by_membership_id IS NULL
      AND processing_started_at IS NULL AND completed_at IS NULL)
    OR (status = 'acknowledged' AND acknowledged_at IS NOT NULL AND acknowledged_by_membership_id IS NOT NULL
      AND processing_started_at IS NULL AND completed_at IS NULL)
    OR (status = 'processing' AND processing_started_at IS NOT NULL
      AND processing_started_by_membership_id IS NOT NULL AND last_processed_at IS NOT NULL
      AND completed_at IS NULL AND completed_by_membership_id IS NULL AND confirmation_email_status IS NULL)
    OR (status = 'completed' AND processing_started_at IS NOT NULL AND completed_at IS NOT NULL
      AND completed_by_membership_id IS NOT NULL AND confirmation_email IS NULL
      AND confirmation_email_status IS NOT NULL)
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
-- the membership: derive the subject and the deadline here.
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
  NEW.due_at := NEW.created_at + INTERVAL '30 days';
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION platform_private.account_deletion_request_defaults()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
CREATE TRIGGER account_deletion_requests_defaults
  BEFORE INSERT ON platform_private.account_deletion_requests
  FOR EACH ROW EXECUTE FUNCTION platform_private.account_deletion_request_defaults();

-- Storage keys the server route removes through the Storage API. removed_at
-- is set by complete_account_deletion_v1 after it sees the object is gone.
CREATE TABLE platform_private.account_deletion_storage_objects (
  deletion_request_id UUID NOT NULL
    REFERENCES platform_private.account_deletion_requests(id) ON DELETE RESTRICT,
  bucket_id TEXT NOT NULL CHECK (bucket_id IN (
    'platform-documents', 'platform-document-exports', 'platform-knowledge-library',
    'platform-company-files', 'platform-whatsapp-media', 'avatars', 'chat-media', 'flow-media')),
  object_name TEXT NOT NULL CHECK (char_length(object_name) BETWEEN 1 AND 1024),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  removed_at TIMESTAMPTZ,
  PRIMARY KEY (deletion_request_id, bucket_id, object_name)
);
ALTER TABLE platform_private.account_deletion_storage_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.account_deletion_storage_objects FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform_private.account_deletion_storage_objects
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- c) Tombstone shapes.
-- ---------------------------------------------------------------------------
ALTER TABLE platform.profiles
  ALTER COLUMN auth_user_id DROP NOT NULL,
  ADD CONSTRAINT profiles_erased_shape_check
    CHECK (auth_user_id IS NOT NULL OR status = 'blocked');

ALTER TABLE platform.student_cases
  DROP CONSTRAINT student_cases_intake_origin_check,
  ADD CONSTRAINT student_cases_intake_origin_check CHECK (
    responsible_sales_membership_id IS NOT NULL
    OR (public_application_id IS NULL
      AND source_key IS NOT DISTINCT FROM ('docs-intake:' || id::TEXT)
      AND canonical_client_id IS NOT NULL AND canonical_lead_id IS NULL)
    OR (public_application_id IS NOT NULL
      AND source_key IS NOT DISTINCT FROM ('public_student_application:' || public_application_id::TEXT)
      AND student_membership_id IS NOT NULL)
    OR (public_application_id IS NULL
      AND source_key IS NOT DISTINCT FROM ('lead-cabinet:' || canonical_lead_id::TEXT)
      AND canonical_lead_id IS NOT NULL AND student_membership_id IS NULL)
    -- 279: the анкета of an erased account is deleted; its case keeps the
    -- origin key (the old application id, not personal) and the tombstone
    -- membership. protect_domain_identity still forbids clearing
    -- public_application_id outside the erasure transaction.
    OR (public_application_id IS NULL
      AND source_key LIKE 'public\_student\_application:%'
      AND student_membership_id IS NOT NULL)
  );

-- ---------------------------------------------------------------------------
-- d) The one-transaction erasure bypass and text scrubbing helpers.
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

-- A needle becomes a case-insensitive pattern; a needle that starts or ends
-- with a word character is anchored on that side with \m / \M, so «Али» does
-- not match inside «реализация».
CREATE FUNCTION platform_private.account_erasure_pattern(p_needles TEXT[])
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN count(*) = 0 THEN NULL ELSE
    '(' || string_agg(
      CASE WHEN n ~ '^\w' THEN '\m' ELSE '' END
      || regexp_replace(n, '([.^$*+?()\[\]{}|\\/-])', '\\\1', 'g')
      || CASE WHEN n ~ '\w$' THEN '\M' ELSE '' END,
      '|' ORDER BY char_length(n) DESC, n) || ')'
  END
  FROM (
    SELECT DISTINCT btrim(x) AS n FROM unnest(p_needles) AS x
    WHERE x IS NOT NULL AND char_length(btrim(x)) >= 3
  ) needles
$$;

CREATE FUNCTION platform_private.account_erasure_scrub_text(p_value TEXT, p_pattern TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN p_value IS NULL OR p_pattern IS NULL THEN p_value
    ELSE regexp_replace(p_value, p_pattern, '[удалено]', 'gi') END
$$;

CREATE FUNCTION platform_private.account_erasure_scrub_jsonb(p_value JSONB, p_pattern TEXT)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF p_value IS NULL OR p_pattern IS NULL THEN RETURN p_value; END IF;
  CASE jsonb_typeof(p_value)
    WHEN 'string' THEN
      RETURN to_jsonb(platform_private.account_erasure_scrub_text(p_value #>> '{}', p_pattern));
    WHEN 'object' THEN
      RETURN COALESCE((SELECT jsonb_object_agg(e.key, platform_private.account_erasure_scrub_jsonb(e.value, p_pattern))
        FROM jsonb_each(p_value) AS e), '{}'::JSONB);
    WHEN 'array' THEN
      RETURN COALESCE((SELECT jsonb_agg(platform_private.account_erasure_scrub_jsonb(e.value, p_pattern) ORDER BY e.ordinality)
        FROM jsonb_array_elements(p_value) WITH ORDINALITY AS e(value, ordinality)), '[]'::JSONB);
    ELSE
      RETURN p_value;
  END CASE;
END
$$;

-- Scrub every text/varchar/jsonb column of the rows of p_table whose
-- p_key_column is in p_ids (and of p_org, where the table has an
-- organization), only where the value matches the pattern. One UPDATE per
-- table: the pattern is tested on every column of the row in the same scan.
CREATE FUNCTION platform_private.account_erasure_scrub_rows(
  p_org UUID, p_table REGCLASS, p_key_column TEXT, p_ids UUID[], p_pattern TEXT
) RETURNS BIGINT LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE col RECORD; sets TEXT[] := '{}'; tests TEXT[] := '{}'; org_filter TEXT := ''; n BIGINT;
BEGIN
  IF p_pattern IS NULL OR p_ids IS NULL OR cardinality(p_ids) = 0 THEN RETURN 0; END IF;
  FOR col IN
    SELECT a.attname, t.typname
    FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
    WHERE a.attrelid = p_table AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
      AND t.typname IN ('text', 'varchar', 'jsonb')
    ORDER BY a.attnum
  LOOP
    IF col.typname = 'jsonb' THEN
      sets := sets || format('%1$I = CASE WHEN %1$I::TEXT ~* $2 THEN platform_private.account_erasure_scrub_jsonb(%1$I, $2) ELSE %1$I END', col.attname);
      tests := tests || format('%I::TEXT ~* $2', col.attname);
    ELSE
      sets := sets || format('%1$I = CASE WHEN %1$I ~* $2 THEN platform_private.account_erasure_scrub_text(%1$I, $2) ELSE %1$I END', col.attname);
      tests := tests || format('%I ~* $2', col.attname);
    END IF;
  END LOOP;
  IF cardinality(sets) = 0 THEN RETURN 0; END IF;
  IF p_org IS NOT NULL AND p_key_column <> 'organization_id' AND EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = p_table AND a.attname = 'organization_id' AND NOT a.attisdropped
  ) THEN
    org_filter := ' AND organization_id = $3';
  END IF;
  EXECUTE format('UPDATE %s SET %s WHERE %I = ANY ($1)%s AND (%s)', p_table, array_to_string(sets, ', '),
    p_key_column, org_filter, array_to_string(tests, ' OR ')) USING p_ids, p_pattern, p_org;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;

-- The WhatsApp correspondence of the subject (review finding 2). Rows are
-- collected as {table: [ctid, ...]} up to a fixed point, then deleted by one
-- statement, so the foreign keys (RESTRICT included) are checked once at its
-- end, after every collected row is gone. Collected:
--   * the conversations, and the rows of every table with a uuid
--     conversation_id column of these conversations (AI memory, answers,
--     autosend journal, tickets, amoCRM context, bindings, drafts ...);
--   * the decision questions (decision_backlogs) of the subject's cases;
--   * every row that references a collected row by a foreign key, except
--     ON DELETE SET NULL / SET DEFAULT (the key action keeps those rows);
--   * the raw webhook events (provider_webhook_events: phone and text) that
--     collected rows were projected from, and in turn their rows.
-- The ctids stay valid: collection and deletion run back to back inside the
-- processing transaction, which updates none of these rows in between.
CREATE FUNCTION platform_private.account_erasure_rows_add(p_map JSONB, p_table TEXT, p_tids TEXT[])
RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN p_tids IS NULL OR cardinality(p_tids) = 0 THEN p_map ELSE
    jsonb_set(p_map, ARRAY[p_table], to_jsonb(ARRAY(
      SELECT DISTINCT t FROM unnest(
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_map -> p_table, '[]'::JSONB))) || p_tids) AS t
      ORDER BY t))) END
$$;

CREATE FUNCTION platform_private.account_erasure_conversation_rows(
  p_org UUID, p_conversation_ids UUID[], p_case_ids UUID[]
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  collected JSONB := '{}'::JSONB;
  frontier JSONB := '{}'::JSONB;
  next_frontier JSONB;
  rel RECORD;
  edge RECORD;
  tids TEXT[];
  fresh TEXT[];
  rounds INTEGER := 0;
BEGIN
  IF p_org IS NULL THEN RETURN collected; END IF;
  IF COALESCE(cardinality(p_conversation_ids), 0) > 0 THEN
    SELECT array_agg(x.ctid::TEXT) INTO tids FROM platform.communication_conversations x
    WHERE x.organization_id = p_org AND x.id = ANY (p_conversation_ids);
    frontier := platform_private.account_erasure_rows_add(frontier, 'platform.communication_conversations', tids);
    FOR rel IN
      SELECT c.oid::REGCLASS AS oid FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attname = 'conversation_id' AND NOT a.attisdropped
      WHERE n.nspname IN ('platform', 'platform_private') AND c.relkind = 'r'
        AND a.atttypid = 'pg_catalog.uuid'::REGTYPE
      ORDER BY 1
    LOOP
      EXECUTE format('SELECT array_agg(x.ctid::TEXT) FROM %s x WHERE x.conversation_id = ANY ($1)', rel.oid)
        INTO tids USING p_conversation_ids;
      frontier := platform_private.account_erasure_rows_add(frontier, rel.oid::TEXT, tids);
    END LOOP;
  END IF;
  IF COALESCE(cardinality(p_case_ids), 0) > 0 THEN
    SELECT array_agg(x.ctid::TEXT) INTO tids FROM platform.decision_backlogs x
    WHERE x.organization_id = p_org AND x.student_case_id = ANY (p_case_ids);
    frontier := platform_private.account_erasure_rows_add(frontier, 'platform.decision_backlogs', tids);
  END IF;
  collected := frontier;

  WHILE frontier <> '{}'::JSONB LOOP
    rounds := rounds + 1;
    IF rounds > 50 THEN
      RAISE EXCEPTION 'account_erasure_rows_unbounded' USING ERRCODE = '55000';
    END IF;
    next_frontier := '{}'::JSONB;
    FOR edge IN
      -- (child) references (parent): rows of the child that point at frontier
      -- rows of the parent; and the raw webhook events frontier rows point at.
      SELECT con.conrelid::REGCLASS AS child, con.confrelid::REGCLASS AS parent,
        (con.confrelid = 'platform_private.provider_webhook_events'::REGCLASS
          AND con.conrelid::REGCLASS::TEXT IN (SELECT jsonb_object_keys(frontier))) AS upward,
        con.confrelid::REGCLASS::TEXT IN (SELECT jsonb_object_keys(frontier)) AS downward,
        (SELECT string_agg(format('c.%I', ca.attname), ', ' ORDER BY k.i)
          FROM unnest(con.conkey, con.confkey) WITH ORDINALITY AS k(ck, pk, i)
          JOIN pg_catalog.pg_attribute ca ON ca.attrelid = con.conrelid AND ca.attnum = k.ck) AS child_cols,
        (SELECT string_agg(format('p.%I', pa.attname), ', ' ORDER BY k.i)
          FROM unnest(con.conkey, con.confkey) WITH ORDINALITY AS k(ck, pk, i)
          JOIN pg_catalog.pg_attribute pa ON pa.attrelid = con.confrelid AND pa.attnum = k.pk) AS parent_cols
      FROM pg_catalog.pg_constraint con
      JOIN pg_catalog.pg_class cc ON cc.oid = con.conrelid AND cc.relkind = 'r'
      WHERE con.contype = 'f' AND con.confdeltype NOT IN ('n', 'd')
        AND (con.confrelid::REGCLASS::TEXT IN (SELECT jsonb_object_keys(frontier))
          OR (con.confrelid = 'platform_private.provider_webhook_events'::REGCLASS
            AND con.conrelid::REGCLASS::TEXT IN (SELECT jsonb_object_keys(frontier))))
      ORDER BY 1, 2, 5
    LOOP
      IF edge.downward THEN
        EXECUTE format('SELECT array_agg(c.ctid::TEXT) FROM %s c WHERE (%s) IN (SELECT %s FROM %s p WHERE p.ctid = ANY ($1::TID[]))',
          edge.child, edge.child_cols, edge.parent_cols, edge.parent)
          INTO tids USING ARRAY(SELECT jsonb_array_elements_text(frontier -> edge.parent::TEXT));
        fresh := ARRAY(SELECT t FROM unnest(tids) AS t
          EXCEPT SELECT jsonb_array_elements_text(COALESCE(collected -> edge.child::TEXT, '[]'::JSONB)));
        next_frontier := platform_private.account_erasure_rows_add(next_frontier, edge.child::TEXT, fresh);
        collected := platform_private.account_erasure_rows_add(collected, edge.child::TEXT, fresh);
      END IF;
      IF edge.upward THEN
        EXECUTE format('SELECT array_agg(p.ctid::TEXT) FROM %s p WHERE (%s) IN (SELECT %s FROM %s c WHERE c.ctid = ANY ($1::TID[]))',
          edge.parent, edge.parent_cols, edge.child_cols, edge.child)
          INTO tids USING ARRAY(SELECT jsonb_array_elements_text(frontier -> edge.child::TEXT));
        fresh := ARRAY(SELECT t FROM unnest(tids) AS t
          EXCEPT SELECT jsonb_array_elements_text(COALESCE(collected -> edge.parent::TEXT, '[]'::JSONB)));
        next_frontier := platform_private.account_erasure_rows_add(next_frontier, edge.parent::TEXT, fresh);
        collected := platform_private.account_erasure_rows_add(collected, edge.parent::TEXT, fresh);
      END IF;
    END LOOP;
    frontier := next_frontier;
  END LOOP;
  RETURN collected;
END
$$;

-- One statement: every collected row of every table. Returns the row count.
CREATE FUNCTION platform_private.account_erasure_delete_rows(p_rows JSONB)
RETURNS BIGINT LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  parts TEXT[] := '{}';
  counts TEXT[] := '{}';
  t TEXT;
  i INTEGER := 0;
  n BIGINT;
BEGIN
  IF p_rows IS NULL OR p_rows = '{}'::JSONB THEN RETURN 0; END IF;
  FOR t IN SELECT jsonb_object_keys(p_rows) ORDER BY 1 LOOP
    i := i + 1;
    parts := parts || format('d%s AS (DELETE FROM %s x WHERE x.ctid = ANY (%L::TID[]) RETURNING 1)',
      i, t::REGCLASS, ARRAY(SELECT jsonb_array_elements_text(p_rows -> t))::TEXT);
    counts := counts || format('(SELECT count(*) FROM d%s)', i);
  END LOOP;
  EXECUTE 'WITH ' || array_to_string(parts, ', ') || ' SELECT ' || array_to_string(counts, ' + ') INTO n;
  RETURN n;
END
$$;

REVOKE ALL ON FUNCTION
  platform_private.account_erasure_pattern(TEXT[]),
  platform_private.account_erasure_scrub_text(TEXT, TEXT),
  platform_private.account_erasure_scrub_jsonb(JSONB, TEXT),
  platform_private.account_erasure_scrub_rows(UUID, REGCLASS, TEXT, UUID[], TEXT),
  platform_private.account_erasure_rows_add(JSONB, TEXT, TEXT[]),
  platform_private.account_erasure_conversation_rows(UUID, UUID[], UUID[]),
  platform_private.account_erasure_delete_rows(JSONB)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- f) Guard trigger functions learn the erasure bypass. The snippet goes right
-- after the top-level BEGIN and returns before any check, for row-level
-- UPDATE/DELETE only, and only inside the erasure transaction. The GUC test
-- comes first, so no other caller ever reaches the private lookup.
-- ---------------------------------------------------------------------------
DO $a279_guards$
DECLARE
  target TEXT;
  def TEXT;
  src TEXT;
  prefix TEXT;
  patched TEXT;
  snippet CONSTANT TEXT := E'\n'
    || E'  -- 279: account erasure bypass (one transaction, UPDATE/DELETE rows only).\n'
    || E'  IF TG_LEVEL = ''ROW'' AND TG_OP IN (''UPDATE'', ''DELETE'')\n'
    || E'    AND NULLIF(pg_catalog.current_setting(''platform.account_erasure_request_id'', TRUE), '''') IS NOT NULL THEN\n'
    || E'    IF platform_private.account_erasure_bypass() THEN\n'
    || E'      IF TG_OP = ''DELETE'' THEN RETURN OLD; END IF;\n'
    || E'      RETURN NEW;\n'
    || E'    END IF;\n'
    || E'  END IF;\n';
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'platform_private.block_append_only_mutation()',
    'platform_private.block_domain_delete()',
    'platform_private.protect_domain_identity()',
    'platform_private.guard_p2e_parent_transition()',
    'private.forbid_case_note_change()',
    'platform_private.preserve_student_profile_field_history()',
    'platform_private.guard_o3_immutable()',
    'platform_private.admissions_guard_related()',
    'platform_private.guard_student_assessment_immutable()',
    'platform_private.guard_learning_immutable()',
    'platform_private.guard_contract_artifact_mutation()',
    'platform_private.preserve_document_export_artifact()',
    'platform_private.preserve_student_profile_export_attempt()',
    'platform_private.document_export_immutable_history()',
    'platform_private.guard_payment_obligation_update()',
    'platform_private.guard_dynamic_document_slot_transition()',
    'platform_private.guard_post_contract_item_mutation()',
    'platform_private.guard_student_profile_mutation()',
    'platform_private.guard_catalog_preparation_application()',
    'platform_private.admissions_guard_case()',
    'platform_private.guard_client_mutation()',
    'platform_private.guard_lead_mutation()'
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
    patched := prefix || 'BEGIN' || snippet || substr(src, length(prefix) + 6);
    EXECUTE replace(def, src, patched);
  END LOOP;
END
$a279_guards$;

-- Supabase Auth keeps its own journal (auth.audit_log_entries: email, IP) and
-- PKCE flow rows (auth.flow_state) that auth.admin.deleteUser leaves behind;
-- deleteUser also adds a «user_deleted» journal entry with the email. Both are
-- cleaned at processing and again at completion. Where the migration owner
-- may not delete there (a managed project can restrict the auth schema),
-- nothing fails: the count of journal entries left is returned.
CREATE FUNCTION platform_private.account_deletion_auth_log_erase(p_auth_user_id UUID, p_email TEXT)
RETURNS BIGINT LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE n BIGINT := 0;
BEGIN
  IF p_auth_user_id IS NULL THEN RETURN 0; END IF;
  IF to_regclass('auth.flow_state') IS NOT NULL AND has_table_privilege('auth.flow_state', 'DELETE') THEN
    DELETE FROM auth.flow_state f WHERE f.user_id = p_auth_user_id;
  END IF;
  IF to_regclass('auth.audit_log_entries') IS NULL THEN RETURN 0; END IF;
  IF has_table_privilege('auth.audit_log_entries', 'DELETE') THEN
    DELETE FROM auth.audit_log_entries e
    WHERE e.payload ->> 'actor_id' = p_auth_user_id::TEXT
      OR e.payload -> 'traits' ->> 'user_id' = p_auth_user_id::TEXT
      OR (p_email IS NOT NULL AND (lower(e.payload ->> 'actor_username') = lower(p_email)
        OR lower(e.payload -> 'traits' ->> 'user_email') = lower(p_email)));
    RETURN 0;
  END IF;
  SELECT count(*) INTO n FROM auth.audit_log_entries e
  WHERE e.payload ->> 'actor_id' = p_auth_user_id::TEXT
    OR e.payload -> 'traits' ->> 'user_id' = p_auth_user_id::TEXT;
  RETURN n;
EXCEPTION WHEN insufficient_privilege THEN
  RETURN -1;
END
$$;
REVOKE ALL ON FUNCTION platform_private.account_deletion_auth_log_erase(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- e) Subject resolution.
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
  SELECT p.id INTO v_profile FROM platform.profiles p WHERE p.auth_user_id = p_auth_user_id;
  IF v_profile IS NOT NULL AND EXISTS (
    SELECT 1 FROM platform.organization_memberships m
    WHERE m.profile_id = v_profile
      AND (m.is_system_admin OR m."current_role" IS DISTINCT FROM 'student')
  ) THEN
    RAISE EXCEPTION 'account_deletion_staff_forbidden' USING ERRCODE = '42501';
  END IF;
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

-- Everything one request covers. Cases: the subject's student memberships,
-- its анкеты, and pending cabinets of its own leads without a membership.
-- Clients and leads: those of these cases and анкеты, unless a case of
-- ANOTHER student membership or another account's анкета uses the client
-- (then the client is "shared" and stays as it is).
CREATE FUNCTION platform_private.account_deletion_scope(p_request_id UUID)
RETURNS TABLE (
  organization_id UUID, auth_user_id UUID, profile_id UUID,
  membership_ids UUID[], application_ids UUID[], case_ids UUID[],
  lead_ids UUID[], client_ids UUID[], shared_client_ids UUID[], conversation_ids UUID[]
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r platform_private.account_deletion_requests%ROWTYPE;
  v_profile UUID;
  v_members UUID[]; v_apps UUID[]; v_cases UUID[];
  cand_leads UUID[]; cand_clients UUID[]; v_shared UUID[]; v_clients UUID[]; v_leads UUID[]; v_convs UUID[];
  v_phones TEXT[]; v_chat_convs UUID[];
BEGIN
  SELECT * INTO r FROM platform_private.account_deletion_requests x WHERE x.id = p_request_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT p.id INTO v_profile FROM platform.profiles p WHERE p.auth_user_id = r.subject_auth_user_id;
  IF v_profile IS NULL AND r.membership_id IS NOT NULL THEN
    SELECT m.profile_id INTO v_profile FROM platform.organization_memberships m
    WHERE m.organization_id = r.organization_id AND m.id = r.membership_id;
  END IF;
  SELECT COALESCE(array_agg(m.id ORDER BY m.id), '{}') INTO v_members
  FROM platform.organization_memberships m
  WHERE m.organization_id = r.organization_id AND m.profile_id = v_profile AND m."current_role" = 'student';
  SELECT COALESCE(array_agg(a.id ORDER BY a.id), '{}') INTO v_apps
  FROM platform_private.student_applications a WHERE a.auth_user_id = r.subject_auth_user_id;

  SELECT COALESCE(array_agg(DISTINCT sc.id), '{}') INTO v_cases
  FROM platform.student_cases sc
  WHERE sc.organization_id = r.organization_id
    AND (sc.student_membership_id IS NULL OR sc.student_membership_id = ANY (v_members))
    AND (sc.student_membership_id = ANY (v_members)
      OR sc.public_application_id = ANY (v_apps)
      OR sc.id IN (SELECT a.student_case_id FROM platform_private.student_applications a
                   WHERE a.id = ANY (v_apps) AND a.student_case_id IS NOT NULL)
      OR sc.id IN (SELECT a.invited_case_id FROM platform_private.student_applications a
                   WHERE a.id = ANY (v_apps) AND a.invited_case_id IS NOT NULL));

  SELECT COALESCE(array_agg(DISTINCT x), '{}') INTO cand_leads FROM (
    SELECT sc.canonical_lead_id AS x FROM platform.student_cases sc
    WHERE sc.organization_id = r.organization_id AND sc.id = ANY (v_cases) AND sc.canonical_lead_id IS NOT NULL
    UNION SELECT a.canonical_lead_id FROM platform_private.student_applications a
    WHERE a.id = ANY (v_apps) AND a.canonical_lead_id IS NOT NULL) q;
  SELECT COALESCE(array_agg(DISTINCT x), '{}') INTO cand_clients FROM (
    SELECT sc.canonical_client_id AS x FROM platform.student_cases sc
    WHERE sc.organization_id = r.organization_id AND sc.id = ANY (v_cases) AND sc.canonical_client_id IS NOT NULL
    UNION SELECT l.client_id FROM platform.leads l
    WHERE l.organization_id = r.organization_id AND l.id = ANY (cand_leads) AND l.client_id IS NOT NULL) q;

  -- The WhatsApp chat from this account's own phone (9+ digits) is the same
  -- person's correspondence even where the WAHA chain bound it to a client
  -- and lead it created itself: an анкета and a later chat are otherwise
  -- never linked (review finding 2). That client and lead join the
  -- candidates; the shared filter below still keeps a client that another
  -- person's case or анкета uses, and such a chat stays.
  SELECT COALESCE(array_agg(DISTINCT d), '{}') INTO v_phones FROM (
    SELECT regexp_replace(x, '[^0-9]', '', 'g') AS d FROM (
      SELECT a.questionnaire ->> 'phone' AS x FROM platform_private.student_applications a WHERE a.id = ANY (v_apps)
      UNION ALL SELECT unnest(ARRAY[k.phone, k.normalized_phone]) FROM platform.clients k
        WHERE k.organization_id = r.organization_id AND k.id = ANY (cand_clients)
      UNION ALL SELECT f.value FROM platform.student_profile_fields f
        WHERE f.organization_id = r.organization_id AND f.student_case_id = ANY (v_cases)
          AND f.field_key IN ('mobile_phone', 'whatsapp_telegram')) raw
    WHERE x IS NOT NULL
  ) q WHERE char_length(d) >= 9;
  SELECT COALESCE(array_agg(DISTINCT b.conversation_id), '{}') INTO v_chat_convs
  FROM platform_private.waha_direct_chat_bindings b
  WHERE b.organization_id = r.organization_id
    AND b.normalized_chat_id = ANY (ARRAY(SELECT p || '@c.us' FROM unnest(v_phones) AS p));
  SELECT COALESCE(array_agg(DISTINCT x), '{}') INTO cand_leads FROM (
    SELECT unnest(cand_leads) AS x
    UNION SELECT c.canonical_lead_id FROM platform.communication_conversations c
    WHERE c.organization_id = r.organization_id AND c.id = ANY (v_chat_convs) AND c.canonical_lead_id IS NOT NULL) q;
  SELECT COALESCE(array_agg(DISTINCT x), '{}') INTO cand_clients FROM (
    SELECT unnest(cand_clients) AS x
    UNION SELECT c.canonical_client_id FROM platform.communication_conversations c
    WHERE c.organization_id = r.organization_id AND c.id = ANY (v_chat_convs) AND c.canonical_client_id IS NOT NULL
    UNION SELECT l.client_id FROM platform.leads l
    WHERE l.organization_id = r.organization_id AND l.id = ANY (cand_leads) AND l.client_id IS NOT NULL) q;

  SELECT COALESCE(array_agg(k ORDER BY k), '{}') INTO v_shared FROM unnest(cand_clients) k
  WHERE EXISTS (
      SELECT 1 FROM platform.student_cases sc
      WHERE sc.organization_id = r.organization_id
        AND sc.student_membership_id IS NOT NULL AND NOT (sc.student_membership_id = ANY (v_members))
        AND (sc.canonical_client_id = k OR sc.canonical_lead_id IN (
          SELECT l.id FROM platform.leads l WHERE l.organization_id = r.organization_id AND l.client_id = k)))
    OR EXISTS (
      SELECT 1 FROM platform_private.student_applications a
      WHERE a.auth_user_id <> r.subject_auth_user_id AND a.canonical_lead_id IN (
        SELECT l.id FROM platform.leads l WHERE l.organization_id = r.organization_id AND l.client_id = k));
  SELECT COALESCE(array_agg(k ORDER BY k), '{}') INTO v_clients FROM unnest(cand_clients) k
  WHERE NOT (k = ANY (v_shared));
  -- Duplicates merged into these clients are the same person.
  SELECT COALESCE(array_agg(DISTINCT x), '{}') INTO v_clients FROM (
    SELECT unnest(v_clients) AS x
    UNION SELECT al.superseded_client_id FROM platform_private.client_aliases al
    WHERE al.organization_id = r.organization_id AND al.canonical_client_id = ANY (v_clients)) q;
  SELECT COALESCE(array_agg(DISTINCT l.id), '{}') INTO v_leads
  FROM platform.leads l
  WHERE l.organization_id = r.organization_id
    AND (l.client_id = ANY (v_clients) OR (l.id = ANY (cand_leads) AND l.client_id IS NULL));

  -- Pending cabinets of the same person's leads that never got a membership.
  SELECT COALESCE(array_agg(DISTINCT x), '{}') INTO v_cases FROM (
    SELECT unnest(v_cases) AS x
    UNION SELECT sc.id FROM platform.student_cases sc
    WHERE sc.organization_id = r.organization_id AND sc.student_membership_id IS NULL
      AND (sc.canonical_lead_id = ANY (v_leads) OR sc.canonical_client_id = ANY (v_clients))) q;

  SELECT COALESCE(array_agg(DISTINCT c.id), '{}') INTO v_convs
  FROM platform.communication_conversations c
  WHERE c.organization_id = r.organization_id
    AND (c.canonical_client_id = ANY (v_clients) OR c.canonical_lead_id = ANY (v_leads)
      OR c.student_case_id = ANY (v_cases)
      OR (c.id = ANY (v_chat_convs)
        AND (c.canonical_client_id IS NULL OR c.canonical_client_id = ANY (v_clients))
        AND (c.student_case_id IS NULL OR c.student_case_id = ANY (v_cases))));

  RETURN QUERY SELECT r.organization_id, r.subject_auth_user_id, v_profile, v_members, v_apps, v_cases,
    v_leads, v_clients, v_shared, v_convs;
END
$$;

REVOKE ALL ON FUNCTION
  platform_private.account_deletion_subject(UUID),
  platform_private.account_deletion_scope(UUID)
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
REVOKE ALL ON FUNCTION platform_private.account_deletion_staff_actor()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- The neutral label kept rows carry: «Удалённый пользователь · 1a2b3c4d».
CREATE FUNCTION platform_private.account_deletion_label(p_request_row_id UUID)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT 'Удалённый пользователь · ' || left(replace(p_request_row_id::TEXT, '-', ''), 8)
$$;
REVOKE ALL ON FUNCTION platform_private.account_deletion_label(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- Student/applicant side.
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
  actor_member UUID;
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

  actor_member := CASE WHEN subject.profile_id IS NOT NULL THEN subject.membership_id END;
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_membership_id, actor_principal,
    action, resource_type, resource_id, after_state, reason, request_id
  ) VALUES (
    existing.organization_id,
    CASE WHEN subject.profile_id IS NOT NULL THEN 'user' ELSE 'system' END::platform.audit_actor_kind,
    subject.profile_id, actor_member, 'auth:' || uid::TEXT,
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
-- Staff side: queue, detail, process, complete.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.account_deletion_person(r platform_private.account_deletion_requests)
RETURNS TABLE (display_name TEXT, email TEXT, student_case_id UUID)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_name TEXT; v_email TEXT; v_case UUID;
BEGIN
  IF r.status = 'completed' THEN
    RETURN QUERY SELECT platform_private.account_deletion_label(r.id), NULL::TEXT,
      (SELECT sc.id FROM platform.student_cases sc
       WHERE sc.organization_id = r.organization_id AND r.membership_id IS NOT NULL
         AND sc.student_membership_id = r.membership_id
       ORDER BY sc.created_at, sc.id LIMIT 1);
    RETURN;
  END IF;
  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = r.subject_auth_user_id;
  SELECT p.display_name INTO v_name FROM platform.profiles p WHERE p.auth_user_id = r.subject_auth_user_id;
  IF v_name IS NULL THEN
    SELECT btrim((a.questionnaire ->> 'firstName') || ' ' || (a.questionnaire ->> 'lastName')) INTO v_name
    FROM platform_private.student_applications a WHERE a.auth_user_id = r.subject_auth_user_id;
  END IF;
  IF r.membership_id IS NOT NULL THEN
    SELECT sc.id INTO v_case FROM platform.student_cases sc
    WHERE sc.organization_id = r.organization_id AND sc.student_membership_id = r.membership_id
    ORDER BY sc.created_at, sc.id LIMIT 1;
  END IF;
  IF v_case IS NULL THEN
    SELECT a.student_case_id INTO v_case FROM platform_private.student_applications a
    WHERE a.auth_user_id = r.subject_auth_user_id;
  END IF;
  RETURN QUERY SELECT COALESCE(NULLIF(v_name, ''), v_email, platform_private.account_deletion_label(r.id)),
    v_email, v_case;
END
$$;
REVOKE ALL ON FUNCTION platform_private.account_deletion_person(platform_private.account_deletion_requests)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE FUNCTION platform_private.account_deletion_queue_row(r platform_private.account_deletion_requests)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', r.id,
    'kind', r.subject_kind,
    'status', CASE WHEN r.status = 'acknowledged' THEN 'requested' ELSE r.status END,
    'displayName', person.display_name,
    'email', person.email,
    'studentCaseId', person.student_case_id,
    'requestedAt', r.created_at,
    'dueAt', r.due_at,
    'overdue', r.status <> 'completed' AND r.due_at < clock_timestamp(),
    'processingStartedAt', r.processing_started_at,
    'completedAt', r.completed_at,
    'confirmationEmailStatus', r.confirmation_email_status)
  FROM platform_private.account_deletion_person(r) person
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

-- Counts of what one request deletes, anonymizes and leaves, for the staff
-- detail and the processing summary. No personal values.
CREATE FUNCTION platform_private.account_deletion_counts(p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s RECORD; org UUID;
BEGIN
  SELECT * INTO s FROM platform_private.account_deletion_scope(p_request_id);
  IF NOT FOUND THEN RETURN '{}'::JSONB; END IF;
  org := s.organization_id;
  RETURN jsonb_build_object(
    'delete', jsonb_build_object(
      'applications', cardinality(s.application_ids),
      'documents', (SELECT count(*) FROM platform.document_versions v
        WHERE v.organization_id = org AND v.student_case_id = ANY (s.case_ids)),
      'files', (
        (SELECT count(*) FROM platform_private.document_storage_bindings b
          WHERE b.organization_id = org AND b.student_case_id = ANY (s.case_ids))
        + (SELECT count(*) FROM platform.case_contract_files f
          WHERE f.organization_id = org AND f.student_case_id = ANY (s.case_ids))
        + (SELECT count(*) FROM platform.payment_receipt_files f
          WHERE f.organization_id = org AND f.student_case_id = ANY (s.case_ids))
        + (SELECT count(*) FROM platform_private.document_export_artifacts e
          WHERE e.organization_id = org AND e.student_case_id = ANY (s.case_ids) AND e.object_name IS NOT NULL)
        + (SELECT count(*) FROM platform_private.waha_media_object_bindings b
          JOIN platform.communication_messages m ON m.organization_id = b.organization_id
            AND m.id = b.communication_message_id
          WHERE b.organization_id = org AND m.conversation_id = ANY (s.conversation_ids))),
      'chatMessages', (SELECT count(*) FROM platform.case_chat_messages m
        WHERE m.organization_id = org AND m.student_case_id = ANY (s.case_ids)),
      'whatsappChats', cardinality(s.conversation_ids),
      'notifications', (SELECT count(*) FROM platform.notifications n
        WHERE n.organization_id = org AND (n.student_case_id = ANY (s.case_ids)
          OR n.recipient_membership_id = ANY (s.membership_ids))),
      'testAnswers', (SELECT count(*) FROM platform.student_assessment_attempts a
          WHERE a.organization_id = org AND a.student_membership_id = ANY (s.membership_ids))
        + (SELECT count(*) FROM platform.learning_lesson_attempts a
          WHERE a.organization_id = org AND a.student_membership_id = ANY (s.membership_ids)),
      'consultations', (SELECT count(*) FROM platform_private.portal_consultation_requests c
        WHERE c.organization_id = org AND c.membership_id = ANY (s.membership_ids)),
      'profileFacts', (SELECT count(*) FROM platform.student_profile_fields f
        WHERE f.organization_id = org AND f.student_case_id = ANY (s.case_ids)),
      'caseWork', (SELECT count(*) FROM platform.case_tasks t
          WHERE t.organization_id = org AND t.student_case_id = ANY (s.case_ids))
        + (SELECT count(*) FROM platform.case_notes n
          WHERE n.organization_id = org AND (n.student_case_id = ANY (s.case_ids) OR n.lead_id = ANY (s.lead_ids)))
        + (SELECT count(*) FROM platform.university_applications u
          WHERE u.organization_id = org AND u.student_case_id = ANY (s.case_ids))
        + (SELECT count(*) FROM platform.visa_cases v
          WHERE v.organization_id = org AND v.student_case_id = ANY (s.case_ids))),
    'anonymize', jsonb_build_object(
      'cases', cardinality(s.case_ids),
      'clients', cardinality(s.client_ids),
      'leads', cardinality(s.lead_ids),
      'paymentObligations', (SELECT count(*) FROM platform.payment_obligations o
        WHERE o.organization_id = org AND o.student_case_id = ANY (s.case_ids)),
      'payments', (SELECT count(*) FROM platform.payment_events e
        WHERE e.organization_id = org AND e.student_case_id = ANY (s.case_ids)),
      'salesRecords', (SELECT count(*) FROM platform_private.sales_register sr
        WHERE sr.organization_id = org AND (sr.lead_id = ANY (s.lead_ids) OR sr.linked_lead_id = ANY (s.lead_ids)))),
    'remain', jsonb_build_object(
      'sharedClients', cardinality(s.shared_client_ids),
      'amocrmContacts', (SELECT count(*) FROM platform_private.amocrm_contact_bindings b
        WHERE b.organization_id = org AND b.person_id = ANY (s.client_ids))
        + (SELECT count(*) FROM platform_private.amocrm_lead_bindings b
        WHERE b.organization_id = org AND b.lead_id = ANY (s.lead_ids))));
END
$$;
REVOKE ALL ON FUNCTION platform_private.account_deletion_counts(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE FUNCTION platform.staff_account_deletion_detail_v1(p_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; r platform_private.account_deletion_requests%ROWTYPE; live JSONB;
BEGIN
  SELECT * INTO actor FROM platform_private.account_deletion_staff_actor();
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'account_deletion_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM platform_private.account_deletion_requests x
  WHERE x.id = p_id AND x.organization_id = actor.organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_deletion_not_found' USING ERRCODE = '42501';
  END IF;
  IF r.status <> 'completed' THEN
    live := platform_private.account_deletion_counts(r.id);
  END IF;
  RETURN platform_private.account_deletion_queue_row(r) || jsonb_build_object(
    'processingStartedBy', (SELECT p.display_name FROM platform.organization_memberships m
      JOIN platform.profiles p ON p.id = m.profile_id
      WHERE m.organization_id = r.organization_id AND m.id = r.processing_started_by_membership_id),
    'completedBy', (SELECT p.display_name FROM platform.organization_memberships m
      JOIN platform.profiles p ON p.id = m.profile_id
      WHERE m.organization_id = r.organization_id AND m.id = r.completed_by_membership_id),
    'pendingFiles', (SELECT count(*) FROM platform_private.account_deletion_storage_objects o
      WHERE o.deletion_request_id = r.id AND o.removed_at IS NULL),
    'authAccountExists', EXISTS (SELECT 1 FROM auth.users u WHERE u.id = r.subject_auth_user_id),
    'counts', CASE WHEN r.status = 'completed' THEN COALESCE(r.summary, '{}'::JSONB) ELSE live END,
    -- amoCRM links of the first processing or of now: completion needs the
    -- Admin's confirmation that they are deleted in amoCRM.
    'amocrmContacts', GREATEST(COALESCE(NULLIF(r.summary #>> '{remain,amocrmContacts}', '')::BIGINT, 0),
      COALESCE(NULLIF(live #>> '{remain,amocrmContacts}', '')::BIGINT, 0)));
END
$$;

-- The database part of the erasure. Re-runnable: every statement only
-- deletes or anonymizes what still exists. Returns the Storage keys the
-- server route must remove and the Auth user it must delete.
CREATE FUNCTION platform.process_account_deletion_v1(p_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  r platform_private.account_deletion_requests%ROWTYPE;
  s RECORD;
  org UUID;
  label TEXT;
  contacts TEXT[] := '{}';
  ids TEXT[] := '{}';
  names TEXT[] := '{}';
  tokens TEXT[] := '{}';
  places TEXT[] := '{}';
  ids_pattern TEXT;
  all_pattern TEXT;
  v_wa_rows JSONB;
  c_count BIGINT;
  v_email TEXT;
  c RECORD;
  n BIGINT;
  stats JSONB := '{}'::JSONB;
  v_doc_versions UUID[];
  v_slots UUID[];
  v_notifications UUID[];
  v_tasks UUID[];
  v_help UUID[];
  v_artifacts UUID[];
  v_jobs UUID[];
  v_attempts UUID[];
  v_univ_apps UUID[];
  v_visas UUID[];
  v_kb_nodes UUID[];
  v_kb_blobs UUID[];
  v_receipts UUID[];
  v_scope_ids UUID[];
  c_stats JSONB;
  preview JSONB;
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
    RETURN jsonb_build_object('id', r.id, 'status', r.status, 'authUserId', NULL, 'email', NULL,
      'storageObjects', '[]'::JSONB, 'summary', COALESCE(r.summary, '{}'::JSONB));
  END IF;
  first_run := r.status IN ('requested', 'acknowledged');
  label := platform_private.account_deletion_label(r.id);

  SELECT * INTO s FROM platform_private.account_deletion_scope(r.id);
  org := s.organization_id;
  IF s.profile_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM platform.organization_memberships m
    WHERE m.profile_id = s.profile_id AND (m.is_system_admin OR m."current_role" IS DISTINCT FROM 'student')
  ) THEN
    RAISE EXCEPTION 'account_deletion_staff_forbidden' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.accounts acc JOIN public.profiles pp ON pp.account_id = acc.id
    WHERE acc.owner_user_id = r.subject_auth_user_id AND pp.user_id IS DISTINCT FROM r.subject_auth_user_id
  ) THEN
    RAISE EXCEPTION 'account_deletion_legacy_account_shared' USING ERRCODE = '55000';
  END IF;

  -- Needles, read before anything is deleted (review finding 1).
  --  * ids: unambiguous identifiers, i.e. emails, phones of 9+ digits (as
  --    written and digits only) and passport numbers. Only they are scrubbed
  --    across the organization: another person's record may mention this
  --    one by them.
  --  * names: the names of this account (profile, case, client, анкета,
  --    invitation, student profile) and, of the profile fields, only the
  --    explicit name keys; tokens: their single words; places: addresses and
  --    the other contact values. They clean only the rows of this subject:
  --    another person may share a name, a school or a city.
  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = r.subject_auth_user_id;
  SELECT COALESCE(array_agg(DISTINCT btrim(x)), '{}') INTO names FROM (
    SELECT p.display_name AS x FROM platform.profiles p WHERE p.id = s.profile_id
    UNION SELECT sc.student_display_name FROM platform.student_cases sc
      WHERE sc.organization_id = org AND sc.id = ANY (s.case_ids)
    UNION SELECT k.display_name FROM platform.clients k WHERE k.organization_id = org AND k.id = ANY (s.client_ids)
    UNION SELECT unnest(ARRAY[a.questionnaire ->> 'firstName', a.questionnaire ->> 'lastName',
        (a.questionnaire ->> 'firstName') || ' ' || (a.questionnaire ->> 'lastName')])
      FROM platform_private.student_applications a WHERE a.id = ANY (s.application_ids)
    UNION SELECT pr.student_display_name FROM platform_private.student_portal_provisioning_receipts pr
      WHERE pr.auth_user_id = r.subject_auth_user_id OR pr.student_case_id = ANY (s.case_ids)
    UNION SELECT unnest(ARRAY[sp.preferred_display_name, sp.legal_display_name])
      FROM platform.student_profiles sp WHERE sp.organization_id = org AND sp.student_case_id = ANY (s.case_ids)
    UNION SELECT f.value FROM platform.student_profile_fields f
      WHERE f.organization_id = org AND f.student_case_id = ANY (s.case_ids)
        AND f.field_key IN ('student_first_name', 'student_last_name', 'father_first_name', 'father_last_name',
          'mother_first_name', 'mother_last_name', 'emergency_contact_name')
    UNION SELECT first_name.value || ' ' || last_name.value
      FROM platform.student_profile_fields first_name
      JOIN platform.student_profile_fields last_name ON last_name.organization_id = first_name.organization_id
        AND last_name.student_case_id = first_name.student_case_id
        AND last_name.field_key = replace(first_name.field_key, '_first_name', '_last_name')
      WHERE first_name.organization_id = org AND first_name.student_case_id = ANY (s.case_ids)
        AND first_name.field_key IN ('student_first_name', 'father_first_name', 'mother_first_name')
  ) q WHERE x IS NOT NULL AND btrim(x) <> '' AND x NOT LIKE 'Удалённый пользователь%'
    -- «WhatsApp +996 ••• 12 34 56»: a placeholder of the WAHA chain (278), not a name.
    AND x NOT LIKE 'WhatsApp %';
  -- Contact values as stored: the account email, the client's, the анкета's,
  -- the invitation's and the phone, email and WhatsApp/Telegram profile fields
  -- (the emergency contact's included).
  SELECT COALESCE(array_agg(DISTINCT btrim(x)), '{}') INTO contacts FROM (
    SELECT v_email AS x
    UNION SELECT unnest(ARRAY[k.email, k.normalized_email, k.phone, k.normalized_phone])
      FROM platform.clients k WHERE k.organization_id = org AND k.id = ANY (s.client_ids)
    UNION SELECT unnest(ARRAY[a.normalized_email, a.questionnaire ->> 'phone'])
      FROM platform_private.student_applications a WHERE a.id = ANY (s.application_ids)
    UNION SELECT pr.normalized_email FROM platform_private.student_portal_provisioning_receipts pr
      WHERE pr.auth_user_id = r.subject_auth_user_id OR pr.student_case_id = ANY (s.case_ids)
    UNION SELECT f.value FROM platform.student_profile_fields f
      WHERE f.organization_id = org AND f.student_case_id = ANY (s.case_ids)
        AND f.field_key ~ '(phone|email|whatsapp)'
  ) q WHERE x IS NOT NULL AND btrim(x) <> '';
  SELECT COALESCE(array_agg(DISTINCT x), '{}') INTO ids FROM (
    SELECT lower(m[1]) AS x
      FROM unnest(contacts) AS cv, regexp_matches(cv, '([[:alnum:]._%+-]+@[[:alnum:].-]+[.][[:alpha:]]{2,})', 'g') AS m
    UNION SELECT unnest(ARRAY[btrim(m[1]), regexp_replace(m[1], '[^0-9]', '', 'g')])
      FROM unnest(contacts) AS cv, regexp_matches(cv, '([+]?[0-9][0-9 ().-]{7,}[0-9])', 'g') AS m
      WHERE char_length(regexp_replace(m[1], '[^0-9]', '', 'g')) >= 9
    UNION SELECT btrim(f.value) FROM platform.student_profile_fields f
      WHERE f.organization_id = org AND f.student_case_id = ANY (s.case_ids)
        AND f.field_key ~ 'passport_number' AND char_length(btrim(f.value)) >= 5
  ) q WHERE x IS NOT NULL AND x <> '';
  SELECT COALESCE(array_agg(DISTINCT btrim(x)), '{}') INTO places FROM (
    SELECT unnest(contacts) AS x
    UNION SELECT f.value FROM platform.student_profile_fields f
      WHERE f.organization_id = org AND f.student_case_id = ANY (s.case_ids) AND f.field_key ~ 'address'
  ) q WHERE x IS NOT NULL AND char_length(btrim(x)) >= 5;
  SELECT COALESCE(array_agg(DISTINCT t), '{}') INTO tokens FROM (
    SELECT regexp_split_to_table(nm, '[[:space:],.;:()"«»]+') AS t FROM unnest(names) AS nm
  ) q WHERE char_length(t) >= 3 AND t !~ '[0-9]';
  ids_pattern := platform_private.account_erasure_pattern(ids);
  all_pattern := platform_private.account_erasure_pattern(ids || names || tokens || places);

  -- What this request covers, counted before anything changes (the summary
  -- the CRM shows after completion).
  IF first_run OR r.summary IS NULL THEN
    preview := platform_private.account_deletion_counts(r.id);
  END IF;

  -- Active cases end through the released closure command (lifecycle event
  -- and journal entry, the playbook outcome rule), before the bypass is on.
  FOR c IN SELECT sc.id, sc.admissions_version FROM platform.student_cases sc
    WHERE sc.organization_id = org AND sc.id = ANY (s.case_ids) AND sc.state = 'active' ORDER BY sc.id
  LOOP
    PERFORM platform.set_student_case_closed_v1(org, c.id, c.admissions_version, TRUE, 'other',
      'Аккаунт удалён по запросу', public.uuid_generate_v5(r.id, 'account.deletion.close:' || c.id::TEXT));
  END LOOP;

  -- From here on the guards let this transaction through (UPDATE/DELETE only).
  PERFORM pg_catalog.set_config('platform.account_erasure_request_id', r.id::TEXT, TRUE);
  UPDATE platform_private.account_deletion_requests x
  SET erasure_transaction_id = pg_catalog.pg_current_xact_id(),
    confirmation_email = COALESCE(x.confirmation_email, v_email)
  WHERE x.id = r.id;

  -- Storage keys first: the rows that name them are deleted below.
  INSERT INTO platform_private.account_deletion_storage_objects (deletion_request_id, bucket_id, object_name)
  SELECT r.id, q.bucket_id, q.object_name FROM (
    SELECT b.bucket_id, b.object_name FROM platform_private.document_storage_bindings b
      WHERE b.organization_id = org AND b.student_case_id = ANY (s.case_ids)
    UNION SELECT u.bucket_id, u.object_name FROM platform_private.document_upload_reservations u
      WHERE u.organization_id = org AND u.student_case_id = ANY (s.case_ids)
    UNION SELECT u.bucket_id, u.object_name FROM platform_private.message_media_attachment_uploads u
      WHERE u.organization_id = org AND u.student_case_id = ANY (s.case_ids)
    UNION SELECT 'platform-documents', f.storage_object_name FROM platform.case_contract_files f
      WHERE f.organization_id = org AND f.student_case_id = ANY (s.case_ids)
    UNION SELECT 'platform-documents', f.storage_object_name FROM platform.payment_receipt_files f
      WHERE f.organization_id = org AND f.student_case_id = ANY (s.case_ids)
    UNION SELECT e.bucket_id, e.object_name FROM platform_private.document_export_artifacts e
      WHERE e.organization_id = org AND e.student_case_id = ANY (s.case_ids) AND e.object_name IS NOT NULL
    UNION SELECT 'platform-knowledge-library',
        b.organization_id::TEXT || '/' || b.area || '/' || b.id::TEXT || '/' || lpad(bp.part_index::TEXT, 8, '0')
      FROM platform_private.kb_nodes kn
      JOIN platform_private.kb_blobs b ON b.id IN (kn.blob_id, kn.source_blob_id)
      JOIN platform_private.kb_blob_parts bp ON bp.blob_id = b.id
      WHERE kn.organization_id = org AND kn.client_case_id = ANY (s.case_ids)
  ) q WHERE q.object_name IS NOT NULL
  ON CONFLICT DO NOTHING;
  -- Objects the account uploaded itself (Storage records the uploader as
  -- owner_id); the columns exist on Supabase Storage, not in every test catalog.
  IF EXISTS (SELECT 1 FROM information_schema.columns ic
      WHERE ic.table_schema = 'storage' AND ic.table_name = 'objects' AND ic.column_name = 'owner_id') THEN
    EXECUTE $owned$
      INSERT INTO platform_private.account_deletion_storage_objects (deletion_request_id, bucket_id, object_name)
      SELECT $1, o.bucket_id, o.name FROM storage.objects o
      WHERE o.owner_id = $2::TEXT
        AND o.bucket_id IN ('platform-documents', 'platform-document-exports', 'platform-knowledge-library',
          'platform-company-files', 'avatars', 'chat-media', 'flow-media')
      ON CONFLICT DO NOTHING
    $owned$ USING r.id, r.subject_auth_user_id;
  END IF;

  -- ===== Переписка WhatsApp и данные ИИ (решение 2, review finding 2) =====
  -- The conversations of this subject with every dependent row; their media
  -- files go to the Storage list first.
  v_wa_rows := platform_private.account_erasure_conversation_rows(org, s.conversation_ids, s.case_ids);
  FOR c IN
    SELECT k AS rel FROM jsonb_object_keys(v_wa_rows) AS k
    WHERE EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = k::REGCLASS AND a.attname = 'bucket_id' AND NOT a.attisdropped)
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = k::REGCLASS AND a.attname = 'object_name' AND NOT a.attisdropped)
    ORDER BY 1
  LOOP
    EXECUTE format(
      'INSERT INTO platform_private.account_deletion_storage_objects (deletion_request_id, bucket_id, object_name)
       SELECT $1, x.bucket_id, x.object_name FROM %s x
       WHERE x.ctid = ANY ($2::TID[]) AND x.object_name IS NOT NULL
       ON CONFLICT DO NOTHING', c.rel::REGCLASS)
      USING r.id, ARRAY(SELECT jsonb_array_elements_text(v_wa_rows -> c.rel));
  END LOOP;
  n := platform_private.account_erasure_delete_rows(v_wa_rows);
  stats := stats || jsonb_build_object('whatsappChats', COALESCE(jsonb_array_length(
      v_wa_rows -> 'platform.communication_conversations'), 0),
    'whatsappRows', n);

  -- ===== Анкета, приглашение, доступ =====
  UPDATE platform.student_cases sc SET public_application_id = NULL
  WHERE sc.organization_id = org AND sc.public_application_id = ANY (s.application_ids);
  DELETE FROM platform_private.student_application_receipts x WHERE x.application_id = ANY (s.application_ids);
  DELETE FROM platform_private.student_applications x WHERE x.id = ANY (s.application_ids);
  GET DIAGNOSTICS n = ROW_COUNT; stats := stats || jsonb_build_object('applications', n);
  DELETE FROM platform_private.student_signup_limits x
  WHERE v_email IS NOT NULL AND x.bucket = 'email:' || encode(sha256(convert_to(lower(btrim(v_email)), 'UTF8')), 'hex');

  SELECT COALESCE(array_agg(pr.id), '{}') INTO v_receipts FROM platform_private.student_portal_provisioning_receipts pr
  WHERE pr.auth_user_id = r.subject_auth_user_id OR (pr.organization_id = org AND pr.student_case_id = ANY (s.case_ids))
    OR (pr.organization_id = org AND pr.student_membership_id = ANY (s.membership_ids));
  UPDATE platform_private.student_portal_provisioning_receipts x SET active_attempt_id = NULL
  WHERE x.id = ANY (v_receipts) AND x.active_attempt_id IS NOT NULL;
  DELETE FROM platform_private.student_portal_invite_attempts x
  WHERE x.receipt_id = ANY (v_receipts) OR x.auth_user_id = r.subject_auth_user_id;
  DELETE FROM platform_private.student_portal_provisioning_receipts x WHERE x.id = ANY (v_receipts);

  -- ===== Кабинет: консультации, избранное, уроки, тесты, согласия =====
  DELETE FROM platform_private.portal_consultation_requests x
  WHERE x.organization_id = org AND x.membership_id = ANY (s.membership_ids);
  GET DIAGNOSTICS n = ROW_COUNT; stats := stats || jsonb_build_object('consultations', n);
  DELETE FROM platform_private.university_favorites x
  WHERE x.organization_id = org AND x.membership_id = ANY (s.membership_ids);
  DELETE FROM platform_private.learning_requests x
  WHERE x.organization_id = org AND x.student_membership_id = ANY (s.membership_ids);
  DELETE FROM platform.learning_lesson_attempts x
  WHERE x.organization_id = org AND x.student_membership_id = ANY (s.membership_ids);
  GET DIAGNOSTICS n = ROW_COUNT; stats := stats || jsonb_build_object('lessonAttempts', n);
  DELETE FROM platform_private.student_assessment_requests x
  WHERE x.organization_id = org AND x.student_membership_id = ANY (s.membership_ids);
  DELETE FROM platform.student_assessment_attempts x
  WHERE x.organization_id = org AND x.student_membership_id = ANY (s.membership_ids);
  GET DIAGNOSTICS n = ROW_COUNT; stats := stats || jsonb_build_object('testAttempts', n);
  DELETE FROM platform.notification_consent_events x
  WHERE x.organization_id = org AND x.membership_id = ANY (s.membership_ids);

  -- ===== Уведомления =====
  SELECT COALESCE(array_agg(x.id), '{}') INTO v_notifications FROM platform.notifications x
  WHERE x.organization_id = org AND (x.student_case_id = ANY (s.case_ids) OR x.recipient_membership_id = ANY (s.membership_ids));
  DELETE FROM platform.notification_delivery_intents x
  WHERE x.organization_id = org AND (x.notification_id = ANY (v_notifications) OR x.student_case_id = ANY (s.case_ids)
    OR x.recipient_membership_id = ANY (s.membership_ids));
  DELETE FROM platform.notification_consents x
  WHERE x.organization_id = org AND x.membership_id = ANY (s.membership_ids);
  DELETE FROM platform.notification_events x
  WHERE x.organization_id = org AND (x.notification_id = ANY (v_notifications) OR x.student_case_id = ANY (s.case_ids)
    OR x.recipient_membership_id = ANY (s.membership_ids));
  DELETE FROM platform.student_portal_notification_projection_v1 x
  WHERE x.organization_id = org AND (x.notification_id = ANY (v_notifications) OR x.student_case_id = ANY (s.case_ids)
    OR x.recipient_membership_id = ANY (s.membership_ids));
  DELETE FROM platform.student_portal_overdue_notification_projection_v1 x
  WHERE x.organization_id = org AND (x.notification_id = ANY (v_notifications) OR x.student_case_id = ANY (s.case_ids)
    OR x.recipient_membership_id = ANY (s.membership_ids));
  DELETE FROM platform_private.student_portal_overdue_transition_state x
  WHERE x.organization_id = org AND (x.student_case_id = ANY (s.case_ids) OR x.recipient_membership_id = ANY (s.membership_ids));
  DELETE FROM platform.notifications x WHERE x.id = ANY (v_notifications);
  GET DIAGNOSTICS n = ROW_COUNT; stats := stats || jsonb_build_object('notifications', n);

  -- ===== Переписка в кабинете, помощь =====
  DELETE FROM platform_private.case_chat_read_positions x
  WHERE x.organization_id = org AND (x.student_case_id = ANY (s.case_ids) OR x.membership_id = ANY (s.membership_ids));
  DELETE FROM platform_private.case_chat_receipts x
  WHERE x.organization_id = org AND (x.actor_membership_id = ANY (s.membership_ids)
    OR (x.receipt ->> 'studentCaseId') = ANY (SELECT unnest(s.case_ids)::TEXT));
  DELETE FROM platform.case_chat_messages x WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids);
  GET DIAGNOSTICS n = ROW_COUNT; stats := stats || jsonb_build_object('chatMessages', n);
  DELETE FROM platform.case_chat_threads x WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids);

  SELECT COALESCE(array_agg(x.id), '{}') INTO v_tasks FROM platform.case_tasks x
  WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids);
  SELECT COALESCE(array_agg(x.id), '{}') INTO v_help FROM platform.case_help_requests x
  WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids);
  DELETE FROM platform.staff_notifications x
  WHERE x.organization_id = org AND (x.student_case_id = ANY (s.case_ids) OR x.case_task_id = ANY (v_tasks)
    OR x.help_request_id = ANY (v_help) OR x.recipient_membership_id = ANY (s.membership_ids));
  DELETE FROM platform_private.case_help_commands x WHERE x.organization_id = org AND x.help_request_id = ANY (v_help);
  DELETE FROM platform.case_help_requests x WHERE x.id = ANY (v_help);

  -- ===== Работа по делу =====
  DELETE FROM platform.case_notes x
  WHERE x.organization_id = org AND (x.student_case_id = ANY (s.case_ids) OR x.lead_id = ANY (s.lead_ids));
  DELETE FROM platform_private.case_coverage_tasks x WHERE x.organization_id = org AND x.case_task_id = ANY (v_tasks);
  DELETE FROM platform.case_task_events x WHERE x.organization_id = org AND x.case_task_id = ANY (v_tasks);
  DELETE FROM platform.case_tasks x WHERE x.id = ANY (v_tasks);
  GET DIAGNOSTICS n = ROW_COUNT; stats := stats || jsonb_build_object('caseTasks', n);
  DELETE FROM platform_private.staff_lead_task_links x WHERE x.organization_id = org AND x.lead_id = ANY (s.lead_ids);

  -- ===== Документы =====
  SELECT COALESCE(array_agg(x.id), '{}') INTO v_doc_versions FROM platform.document_versions x
  WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids);
  SELECT COALESCE(array_agg(x.id), '{}') INTO v_slots FROM platform.document_slots x
  WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids);
  SELECT COALESCE(array_agg(x.id), '{}') INTO v_artifacts FROM platform_private.document_export_artifacts x
  WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids);
  SELECT COALESCE(array_agg(x.id), '{}') INTO v_jobs FROM platform_private.document_recognition_jobs x
  WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids);
  SELECT COALESCE(array_agg(x.id), '{}') INTO v_attempts FROM platform_private.document_recognition_attempts x
  WHERE x.job_id = ANY (v_jobs);

  DELETE FROM platform_private.document_download_consumptions x
  WHERE x.organization_id = org AND x.document_download_grant_id IN (
    SELECT g.id FROM platform_private.document_download_grants g
    WHERE g.organization_id = org AND g.student_case_id = ANY (s.case_ids));
  DELETE FROM platform_private.application_document_download_contexts x
  WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids);
  DELETE FROM platform_private.document_download_grants x
  WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids);
  DELETE FROM platform.document_access_events x WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids);
  DELETE FROM platform.document_reviews x WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids);
  DELETE FROM platform.document_validation_events x WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids);
  DELETE FROM platform_private.document_recognition_proposal_links x WHERE x.attempt_id = ANY (v_attempts);
  DELETE FROM platform_private.document_recognition_provider_files x WHERE x.attempt_id = ANY (v_attempts);
  DELETE FROM platform_private.document_recognition_attempts x WHERE x.id = ANY (v_attempts);
  DELETE FROM platform_private.document_recognition_jobs x WHERE x.id = ANY (v_jobs);
  DELETE FROM platform.student_profile_field_reviews x WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids);
  DELETE FROM platform.student_profile_field_proposals x WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids);
  DELETE FROM platform.student_profile_fields x WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids);
  GET DIAGNOSTICS n = ROW_COUNT; stats := stats || jsonb_build_object('profileFacts', n);
  DELETE FROM platform_private.student_profile_export_attempts x
  WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids);
  DELETE FROM platform_private.document_export_download_grants x WHERE x.artifact_id = ANY (v_artifacts);
  DELETE FROM platform_private.document_export_events x WHERE x.artifact_id = ANY (v_artifacts);
  DELETE FROM platform_private.document_export_artifacts x WHERE x.id = ANY (v_artifacts);
  DELETE FROM platform.student_profiles x WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids);
  DELETE FROM platform_private.application_document_submission_reviews x
  WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids);
  DELETE FROM platform_private.application_package_items x WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids);
  DELETE FROM platform_private.application_document_submissions x
  WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids);
  DELETE FROM platform_private.message_media_attachment_completions x
  WHERE x.organization_id = org AND x.document_version_id = ANY (v_doc_versions);
  DELETE FROM platform_private.message_media_attachment_uploads x
  WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids);
  DELETE FROM platform_private.application_package_reviews x WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids);
  DELETE FROM platform_private.application_package_submissions x
  WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids);
  DELETE FROM platform_private.partner_packets x WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids);
  DELETE FROM platform_private.message_media_attachment_intents x
  WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids);
  DELETE FROM platform_private.student_document_scan_admissions x
  WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids);
  DELETE FROM platform.document_slot_case_links x WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids);
  -- The file chain has two cycles (slot -> current version, version -> scan
  -- proof -> version). One statement deletes all of its members, so the
  -- foreign keys are checked once, after every member is gone.
  WITH bindings AS (
    DELETE FROM platform_private.document_storage_bindings x
    WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids) RETURNING 1
  ), attestations AS (
    DELETE FROM platform_private.document_malware_scan_attestations x
    WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids) RETURNING 1
  ), finalizations AS (
    DELETE FROM platform_private.document_upload_finalizations x
    WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids) RETURNING 1
  ), reservations AS (
    DELETE FROM platform_private.document_upload_reservations x
    WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids) RETURNING 1
  ), upload_contexts AS (
    DELETE FROM platform_private.application_document_upload_contexts x
    WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids) RETURNING 1
  ), requirement_items AS (
    DELETE FROM platform_private.application_requirement_items x
    WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids) RETURNING 1
  ), requirement_revisions AS (
    DELETE FROM platform_private.application_requirement_revisions x
    WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids) RETURNING 1
  ), versions AS (
    DELETE FROM platform.document_versions x WHERE x.id = ANY (v_doc_versions) RETURNING 1
  ), slots AS (
    DELETE FROM platform.document_slots x WHERE x.id = ANY (v_slots) RETURNING 1
  ) SELECT jsonb_build_object('documentFiles', (SELECT count(*) FROM bindings),
      'documents', (SELECT count(*) FROM versions), 'documentSlots', (SELECT count(*) FROM slots),
      'uploads', (SELECT count(*) FROM reservations) + (SELECT count(*) FROM finalizations)
        + (SELECT count(*) FROM attestations) + (SELECT count(*) FROM upload_contexts),
      'applicationRequirements', (SELECT count(*) FROM requirement_items) + (SELECT count(*) FROM requirement_revisions))
    INTO c_stats;
  stats := stats || c_stats;
  DELETE FROM platform_private.catalog_preparation_bindings x
  WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids);

  -- ===== Заявки в вузы, виза, обновления, запросы документов =====
  SELECT COALESCE(array_agg(x.id), '{}') INTO v_univ_apps FROM platform.university_applications x
  WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids);
  SELECT COALESCE(array_agg(x.id), '{}') INTO v_visas FROM platform.visa_cases x
  WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids);
  DELETE FROM platform.university_application_events x WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids);
  DELETE FROM platform.university_applications x WHERE x.id = ANY (v_univ_apps);
  GET DIAGNOSTICS n = ROW_COUNT; stats := stats || jsonb_build_object('universityApplications', n);
  DELETE FROM platform.visa_case_events x WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids);
  DELETE FROM platform.visa_cases x WHERE x.id = ANY (v_visas);
  DELETE FROM platform.student_case_updates x WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids);
  DELETE FROM platform_private.docs_student_intake_requests x
  WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids);

  -- ===== Папка клиента в базе знаний =====
  SELECT COALESCE(array_agg(x.id), '{}') INTO v_kb_nodes FROM platform_private.kb_nodes x
  WHERE x.organization_id = org AND x.client_case_id = ANY (s.case_ids);
  SELECT COALESCE(array_agg(DISTINCT b), '{}') INTO v_kb_blobs FROM (
    SELECT x.blob_id AS b FROM platform_private.kb_nodes x WHERE x.id = ANY (v_kb_nodes) AND x.blob_id IS NOT NULL
    UNION SELECT x.source_blob_id FROM platform_private.kb_nodes x WHERE x.id = ANY (v_kb_nodes) AND x.source_blob_id IS NOT NULL) q;
  IF cardinality(v_kb_nodes) > 0 THEN
    DELETE FROM platform_private.kb_requests x
    WHERE x.organization_id = org
      AND x.receipt::TEXT ~ ('(' || array_to_string(v_kb_nodes::TEXT[], '|') || ')');
    DELETE FROM platform_private.kb_export_entries x
    WHERE x.snapshot::TEXT ~ ('(' || array_to_string(v_kb_nodes::TEXT[], '|') || ')');
  END IF;
  DELETE FROM platform_private.kb_sealed_values x WHERE x.node_id = ANY (v_kb_nodes);
  DELETE FROM platform_private.kb_versions x WHERE x.node_id = ANY (v_kb_nodes);
  DELETE FROM platform_private.kb_nodes x WHERE x.id = ANY (v_kb_nodes);
  GET DIAGNOSTICS n = ROW_COUNT; stats := stats || jsonb_build_object('knowledgeItems', n);
  DELETE FROM platform_private.kb_blob_parts x WHERE x.blob_id = ANY (v_kb_blobs)
    AND NOT EXISTS (SELECT 1 FROM platform_private.kb_nodes k WHERE x.blob_id IN (k.blob_id, k.source_blob_id));
  DELETE FROM platform_private.kb_blobs x WHERE x.id = ANY (v_kb_blobs)
    AND NOT EXISTS (SELECT 1 FROM platform_private.kb_nodes k WHERE x.id IN (k.blob_id, k.source_blob_id));

  -- ===== Файлы и текст договора (обезличить нельзя) =====
  DELETE FROM platform.payment_receipt_files x WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids);
  GET DIAGNOSTICS n = ROW_COUNT; stats := stats || jsonb_build_object('paymentReceiptFiles', n);
  DELETE FROM platform.case_contract_files x WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids);
  GET DIAGNOSTICS n = ROW_COUNT; stats := stats || jsonb_build_object('contractFiles', n);
  DELETE FROM platform.student_case_contract_drafts x WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids);

  -- ===== Идентификаторы и квитанции клиента и лида =====
  DELETE FROM platform.external_identifiers x
  WHERE x.organization_id = org AND (x.client_id = ANY (s.client_ids) OR x.lead_id = ANY (s.lead_ids));
  DELETE FROM platform.subject_provenance x
  WHERE x.organization_id = org AND (x.client_id = ANY (s.client_ids) OR x.lead_id = ANY (s.lead_ids));
  DELETE FROM platform_private.website_lead_receipts x WHERE x.organization_id = org AND x.lead_id = ANY (s.lead_ids);
  DELETE FROM platform_private.lead_sale_conditions_requests x
  WHERE x.organization_id = org AND (x.receipt ->> 'lead_id') = ANY (SELECT unnest(s.lead_ids)::TEXT);
  DELETE FROM platform_private.manual_lead_receipts x WHERE x.organization_id = org AND x.lead_id = ANY (s.lead_ids);

  -- ===== Журнал входов Supabase Auth (email, IP) =====
  PERFORM platform_private.account_deletion_auth_log_erase(r.subject_auth_user_id, v_email);

  -- ===== Старый V1-аккаунт (создаётся триггером регистрации) =====
  DELETE FROM public.accounts acc WHERE acc.owner_user_id = r.subject_auth_user_id;

  -- ===== Обезличивание того, что остаётся =====
  UPDATE platform.profiles p SET display_name = label, auth_user_id = NULL, status = 'blocked',
    access_version = p.access_version + 1
  WHERE p.id = s.profile_id AND (p.auth_user_id IS NOT NULL OR p.display_name <> label);
  UPDATE platform.organization_memberships m SET status = 'inactive'
  WHERE m.organization_id = org AND m.id = ANY (s.membership_ids) AND m.status <> 'inactive';
  UPDATE platform.student_cases sc SET student_display_name = label, next_action = NULL,
    admissions_facts = platform_private.account_erasure_scrub_jsonb(sc.admissions_facts, all_pattern),
    pipeline_hidden_at = COALESCE(sc.pipeline_hidden_at, clock_timestamp()),
    admissions_version = CASE WHEN sc.admissions_playbook_version_id IS NOT NULL
      AND (sc.next_action IS NOT NULL OR sc.admissions_facts IS DISTINCT FROM
        platform_private.account_erasure_scrub_jsonb(sc.admissions_facts, all_pattern))
      THEN sc.admissions_version + 1 ELSE sc.admissions_version END
  WHERE sc.organization_id = org AND sc.id = ANY (s.case_ids) AND sc.student_display_name <> label;
  UPDATE platform.clients k SET display_name = label, normalized_name = lower(label),
    email = NULL, normalized_email = NULL, phone = NULL, normalized_phone = NULL,
    lifecycle_state = CASE WHEN k.lifecycle_state = 'merged' THEN k.lifecycle_state ELSE 'inactive' END
  WHERE k.organization_id = org AND k.id = ANY (s.client_ids) AND k.display_name <> label;
  UPDATE platform.leads l SET next_action_text = NULL, next_action_due_date = NULL, lifecycle_state = 'archived'
  WHERE l.organization_id = org AND l.id = ANY (s.lead_ids) AND l.lifecycle_state <> 'archived';
  UPDATE platform.payment_obligations o SET next_action = NULL
  WHERE o.organization_id = org AND o.student_case_id = ANY (s.case_ids) AND o.next_action IS NOT NULL;
  UPDATE platform.post_contract_items i SET next_action = NULL, evidence_ref = NULL
  WHERE i.organization_id = org AND i.student_case_id = ANY (s.case_ids)
    AND (i.next_action IS NOT NULL OR i.evidence_ref IS NOT NULL);
  -- Contract and payment register: the name becomes the neutral label, the
  -- other free text of the person goes; amounts, currency, dates, the service,
  -- the university and the contract number stay (решение 3).
  UPDATE platform_private.sales_register sr SET
    fields = (SELECT jsonb_object_agg(e.key, CASE
        WHEN e.key = 'applicant_name' THEN to_jsonb(label)
        WHEN e.key IN ('phone', 'notes', 'email') AND jsonb_typeof(e.value) = 'string' THEN '""'::JSONB
        ELSE platform_private.account_erasure_scrub_jsonb(e.value, all_pattern) END) FROM jsonb_each(sr.fields) e),
    source_snapshot = CASE WHEN sr.source_snapshot IS NULL THEN NULL ELSE
      (SELECT jsonb_object_agg(e.key, CASE
        WHEN e.key = 'applicant_name' THEN to_jsonb(label)
        WHEN e.key IN ('phone', 'notes', 'email') AND jsonb_typeof(e.value) = 'string' THEN '""'::JSONB
        ELSE platform_private.account_erasure_scrub_jsonb(e.value, all_pattern) END) FROM jsonb_each(sr.source_snapshot) e) END
  WHERE sr.organization_id = org AND (sr.lead_id = ANY (s.lead_ids) OR sr.linked_lead_id = ANY (s.lead_ids))
    AND sr.fields <> '{}'::JSONB;
  UPDATE platform_private.lead_sale_conditions lc SET
    fields = (SELECT jsonb_object_agg(e.key, CASE
        WHEN (e.key LIKE 'education\_%' OR e.key LIKE 'wishes\_%' OR e.key IN ('conditions_note', 'payment_note',
          'conditions_scholarship', 'conditions_budget_raw')) AND jsonb_typeof(e.value) = 'string' THEN '""'::JSONB
        ELSE platform_private.account_erasure_scrub_jsonb(e.value, all_pattern) END) FROM jsonb_each(lc.fields) e)
  WHERE lc.organization_id = org AND lc.lead_id = ANY (s.lead_ids) AND lc.fields <> '{}'::JSONB;

  -- Names, emails, phones and document numbers left in the text and JSON of
  -- the kept rows of this subject.
  -- The journal names a task, a visa, an application or a document by its
  -- own id (review finding 3): the ids of the deleted rows count as this
  -- subject's too.
  v_scope_ids := s.case_ids || s.membership_ids || s.lead_ids || s.client_ids || s.application_ids
    || ARRAY[r.id] || CASE WHEN s.profile_id IS NULL THEN '{}'::UUID[] ELSE ARRAY[s.profile_id] END
    || v_tasks || v_help || v_notifications || v_doc_versions || v_slots || v_artifacts || v_jobs
    || v_univ_apps || v_visas || v_kb_nodes || v_receipts;
  n := 0;
  n := n + platform_private.account_erasure_scrub_rows(org, 'platform.student_cases', 'id', s.case_ids, all_pattern);
  n := n + platform_private.account_erasure_scrub_rows(org, 'platform.student_case_lifecycle_events', 'student_case_id', s.case_ids, all_pattern);
  n := n + platform_private.account_erasure_scrub_rows(org, 'platform.student_case_assignment_events', 'student_case_id', s.case_ids, all_pattern);
  n := n + platform_private.account_erasure_scrub_rows(org, 'platform.student_case_handoff_acknowledgements', 'student_case_id', s.case_ids, all_pattern);
  n := n + platform_private.account_erasure_scrub_rows(org, 'platform.student_case_op_handoffs', 'student_case_id', s.case_ids, all_pattern);
  n := n + platform_private.account_erasure_scrub_rows(org, 'platform.sales_admissions_handoffs', 'student_case_id', s.case_ids, all_pattern);
  n := n + platform_private.account_erasure_scrub_rows(org, 'platform.sales_admissions_handoffs', 'lead_id', s.lead_ids, all_pattern);
  n := n + platform_private.account_erasure_scrub_rows(org, 'platform_private.sales_admissions_handoff_receipts', 'lead_id', s.lead_ids, all_pattern);
  n := n + platform_private.account_erasure_scrub_rows(org, 'platform_private.sales_admissions_handoff_receipts', 'student_case_id', s.case_ids, all_pattern);
  n := n + platform_private.account_erasure_scrub_rows(org, 'platform_private.admissions_events', 'student_case_id', s.case_ids, all_pattern);
  n := n + platform_private.account_erasure_scrub_rows(org, 'platform.payment_obligations', 'student_case_id', s.case_ids, all_pattern);
  n := n + platform_private.account_erasure_scrub_rows(org, 'platform.payment_events', 'student_case_id', s.case_ids, all_pattern);
  n := n + platform_private.account_erasure_scrub_rows(org, 'platform.payment_evidence', 'student_case_id', s.case_ids, all_pattern);
  n := n + platform_private.account_erasure_scrub_rows(org, 'platform.stop_factors', 'student_case_id', s.case_ids, all_pattern);
  n := n + platform_private.account_erasure_scrub_rows(org, 'platform.stop_factor_events', 'student_case_id', s.case_ids, all_pattern);
  n := n + platform_private.account_erasure_scrub_rows(org, 'platform.post_contract_items', 'student_case_id', s.case_ids, all_pattern);
  n := n + platform_private.account_erasure_scrub_rows(org, 'platform.post_contract_reports', 'student_case_id', s.case_ids, all_pattern);
  n := n + platform_private.account_erasure_scrub_rows(org, 'platform.pilot_cohort_membership_events', 'student_case_id', s.case_ids, all_pattern);
  n := n + platform_private.account_erasure_scrub_rows(org, 'platform_private.pilot_cohort_membership_receipts', 'student_case_id', s.case_ids, all_pattern);
  n := n + platform_private.account_erasure_scrub_rows(org, 'platform_private.amocrm_command_attempts', 'student_case_id', s.case_ids, all_pattern);
  n := n + platform_private.account_erasure_scrub_rows(org, 'platform_private.amocrm_command_attempts', 'lead_id', s.lead_ids, all_pattern);
  n := n + platform_private.account_erasure_scrub_rows(org, 'platform_private.amocrm_command_attempts', 'person_id', s.client_ids, all_pattern);
  n := n + platform_private.account_erasure_scrub_rows(org, 'platform_private.amocrm_command_receipts', 'student_case_id', s.case_ids, all_pattern);
  n := n + platform_private.account_erasure_scrub_rows(org, 'platform_private.amocrm_command_receipts', 'lead_id', s.lead_ids, all_pattern);
  n := n + platform_private.account_erasure_scrub_rows(org, 'platform_private.amocrm_command_receipts', 'person_id', s.client_ids, all_pattern);
  n := n + platform_private.account_erasure_scrub_rows(org, 'platform_private.sales_register', 'lead_id', s.lead_ids, all_pattern);
  n := n + platform_private.account_erasure_scrub_rows(org, 'platform_private.sales_register', 'linked_lead_id', s.lead_ids, all_pattern);
  n := n + platform_private.account_erasure_scrub_rows(org, 'platform_private.lead_sale_conditions', 'lead_id', s.lead_ids, all_pattern);
  n := n + platform_private.account_erasure_scrub_rows(org, 'platform_private.sales_lead_workflow_receipts', 'lead_id', s.lead_ids, all_pattern);
  n := n + platform_private.account_erasure_scrub_rows(org, 'platform.lead_admissions_gates', 'lead_id', s.lead_ids, all_pattern);
  n := n + platform_private.account_erasure_scrub_rows(org, 'platform_private.lead_admissions_gate_receipts', 'lead_id', s.lead_ids, all_pattern);
  n := n + platform_private.account_erasure_scrub_rows(org, 'platform_private.lead_attribution_touches', 'lead_id', s.lead_ids, all_pattern);
  n := n + platform_private.account_erasure_scrub_rows(org, 'platform.leads', 'id', s.lead_ids, all_pattern);
  n := n + platform_private.account_erasure_scrub_rows(org, 'platform_private.client_duplicate_candidates', 'left_client_id', s.client_ids, all_pattern);
  n := n + platform_private.account_erasure_scrub_rows(org, 'platform_private.client_duplicate_candidates', 'right_client_id', s.client_ids, all_pattern);
  n := n + platform_private.account_erasure_scrub_rows(org, 'platform.membership_role_history', 'membership_id', s.membership_ids, all_pattern);
  n := n + platform_private.account_erasure_scrub_rows(org, 'platform.membership_scope_assignments', 'membership_id', s.membership_ids, all_pattern);
  n := n + platform_private.account_erasure_scrub_rows(org, 'platform.membership_permission_events', 'membership_id', s.membership_ids, all_pattern);
  stats := stats || jsonb_build_object('scrubbedValues', n);
  -- The organization's journal and Sales/finance free text, with the
  -- unambiguous identifiers only (review finding 1): another person's record
  -- may mention this one by email, phone or passport number, while a name, a
  -- school or a relationship word may belong to someone else.
  IF ids_pattern IS NOT NULL THEN
    n := 0;
    n := n + platform_private.account_erasure_scrub_rows(org, 'platform_private.sales_register', 'organization_id', ARRAY[org], ids_pattern);
    n := n + platform_private.account_erasure_scrub_rows(org, 'platform_private.lead_sale_conditions', 'organization_id', ARRAY[org], ids_pattern);
    n := n + platform_private.account_erasure_scrub_rows(org, 'platform_private.lead_sale_conditions_requests', 'organization_id', ARRAY[org], ids_pattern);
    n := n + platform_private.account_erasure_scrub_rows(org, 'platform_private.sales_lead_workflow_receipts', 'organization_id', ARRAY[org], ids_pattern);
    n := n + platform_private.account_erasure_scrub_rows(org, 'platform_private.manual_lead_receipts', 'organization_id', ARRAY[org], ids_pattern);
    n := n + platform_private.account_erasure_scrub_rows(org, 'platform_private.website_lead_receipts', 'organization_id', ARRAY[org], ids_pattern);
    n := n + platform_private.account_erasure_scrub_rows(org, 'platform.leads', 'organization_id', ARRAY[org], ids_pattern);
    n := n + platform_private.account_erasure_scrub_rows(org, 'platform.case_notes', 'organization_id', ARRAY[org], ids_pattern);
    n := n + platform_private.account_erasure_scrub_rows(org, 'platform.case_tasks', 'organization_id', ARRAY[org], ids_pattern);
    n := n + platform_private.account_erasure_scrub_rows(org, 'platform.student_case_updates', 'organization_id', ARRAY[org], ids_pattern);
    n := n + platform_private.account_erasure_scrub_rows(org, 'platform.payment_obligations', 'organization_id', ARRAY[org], ids_pattern);
    stats := stats || jsonb_build_object('scrubbedMentions', n);
  END IF;
  -- The journal. Entries about this subject get the full pattern: their
  -- resource is one of the subject's rows (the ids of the deleted tasks,
  -- visas, applications, document slots and versions, notifications and
  -- help requests included, so an entry naming the case only inside its
  -- state is found by its own resource: review finding 3) or their actor is
  -- the subject's profile; both by index. Every other entry of the
  -- organization only the unambiguous identifiers (review finding 1).
  IF all_pattern IS NOT NULL THEN
    UPDATE platform.audit_events e SET
      before_state = platform_private.account_erasure_scrub_jsonb(e.before_state, all_pattern),
      after_state = platform_private.account_erasure_scrub_jsonb(e.after_state, all_pattern),
      reason = platform_private.account_erasure_scrub_text(e.reason, all_pattern)
    WHERE e.organization_id = org
      AND (e.resource_id = ANY (v_scope_ids) OR (s.profile_id IS NOT NULL AND e.actor_profile_id = s.profile_id))
      AND (COALESCE(e.before_state::TEXT, '') || ' ' || e.after_state::TEXT || ' ' || e.reason) ~* all_pattern;
    GET DIAGNOSTICS c_count = ROW_COUNT;
    stats := stats || jsonb_build_object('scrubbedJournalEntries', c_count);
  END IF;
  IF ids_pattern IS NOT NULL THEN
    UPDATE platform.audit_events e SET
      before_state = platform_private.account_erasure_scrub_jsonb(e.before_state, ids_pattern),
      after_state = platform_private.account_erasure_scrub_jsonb(e.after_state, ids_pattern),
      reason = platform_private.account_erasure_scrub_text(e.reason, ids_pattern)
    WHERE e.organization_id = org
      AND (COALESCE(e.before_state::TEXT, '') || ' ' || e.after_state::TEXT || ' ' || e.reason) ~* ids_pattern;
    GET DIAGNOSTICS c_count = ROW_COUNT;
    stats := stats || jsonb_build_object('scrubbedJournalMentions', c_count);
  END IF;

  -- Self-check: no portal content of the subject is left.
  IF EXISTS (SELECT 1 FROM platform_private.student_applications x WHERE x.auth_user_id = r.subject_auth_user_id)
    OR EXISTS (SELECT 1 FROM platform.document_versions x WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids))
    OR EXISTS (SELECT 1 FROM platform.case_chat_messages x WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids))
    OR EXISTS (SELECT 1 FROM platform.notifications x WHERE x.organization_id = org
      AND (x.student_case_id = ANY (s.case_ids) OR x.recipient_membership_id = ANY (s.membership_ids)))
    OR EXISTS (SELECT 1 FROM platform.student_profiles x WHERE x.organization_id = org AND x.student_case_id = ANY (s.case_ids))
    OR EXISTS (SELECT 1 FROM platform.profiles x WHERE x.auth_user_id = r.subject_auth_user_id)
    OR EXISTS (SELECT 1 FROM public.accounts x WHERE x.owner_user_id = r.subject_auth_user_id)
    OR EXISTS (SELECT 1 FROM platform.communication_conversations x
      WHERE x.organization_id = org AND x.id = ANY (s.conversation_ids))
  THEN
    RAISE EXCEPTION 'account_deletion_incomplete' USING ERRCODE = '55000';
  END IF;

  -- The bypass ends with this statement: the token is cleared before return.
  UPDATE platform_private.account_deletion_requests x SET
    erasure_transaction_id = NULL,
    status = 'processing',
    processing_started_at = COALESCE(x.processing_started_at, clock_timestamp()),
    processing_started_by_membership_id = COALESCE(x.processing_started_by_membership_id, actor.membership_id),
    last_processed_at = clock_timestamp(),
    summary = CASE WHEN preview IS NOT NULL
      THEN preview || jsonb_build_object('deleted', stats)
      ELSE x.summary END
  WHERE x.id = r.id
  RETURNING * INTO r;

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_membership_id, actor_principal,
    action, resource_type, resource_id, after_state, reason, request_id
  ) VALUES (
    org, 'user', actor.profile_id, actor.membership_id, 'auth:' || actor.auth_user_id::TEXT,
    'account.deletion.process', 'account_deletion_request', r.id,
    jsonb_build_object('status', r.status, 'subject_kind', r.subject_kind, 'deleted', stats,
      'storage_objects', (SELECT count(*) FROM platform_private.account_deletion_storage_objects o
        WHERE o.deletion_request_id = r.id AND o.removed_at IS NULL)),
    CASE WHEN first_run THEN 'Account and personal data erased in the database'
      ELSE 'Account erasure repeated in the database' END,
    gen_random_uuid()
  );

  PERFORM pg_catalog.set_config('platform.account_erasure_request_id', '', TRUE);

  RETURN jsonb_build_object(
    'id', r.id,
    'status', r.status,
    'authUserId', (SELECT u.id FROM auth.users u WHERE u.id = r.subject_auth_user_id),
    'email', r.confirmation_email,
    'storageObjects', COALESCE((SELECT jsonb_agg(jsonb_build_object('bucket', o.bucket_id, 'name', o.object_name)
        ORDER BY o.bucket_id, o.object_name)
      FROM platform_private.account_deletion_storage_objects o
      WHERE o.deletion_request_id = r.id AND o.removed_at IS NULL), '[]'::JSONB),
    'summary', COALESCE(r.summary, '{}'::JSONB));
END
$$;

-- The last step: the database itself confirms that the Auth user and every
-- listed Storage object are gone; only then is the request completed. The
-- confirmation address is erased here. amoCRM is outside the database: when
-- the first processing found amoCRM links (summary remain.amocrmContacts),
-- completion needs the Admin's confirmation that the contact and the deal are
-- deleted there (p_amocrm_erased); it is kept in the summary and the journal.
CREATE FUNCTION platform.complete_account_deletion_v1(
  p_id UUID, p_confirmation_email_status TEXT, p_amocrm_erased BOOLEAN
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD; r platform_private.account_deletion_requests%ROWTYPE; remaining BIGINT; auth_log_left BIGINT;
  amocrm_required BOOLEAN;
BEGIN
  SELECT * INTO actor FROM platform_private.account_deletion_staff_actor();
  IF p_id IS NULL OR p_confirmation_email_status IS NULL OR p_amocrm_erased IS NULL
    OR p_confirmation_email_status NOT IN ('sent', 'failed', 'not_configured', 'no_address') THEN
    RAISE EXCEPTION 'account_deletion_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM platform_private.account_deletion_requests x
  WHERE x.id = p_id AND x.organization_id = actor.organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_deletion_not_found' USING ERRCODE = '42501';
  END IF;
  IF r.status = 'completed' THEN
    RETURN jsonb_build_object('id', r.id, 'status', r.status, 'completedAt', r.completed_at,
      'confirmationEmailStatus', r.confirmation_email_status);
  END IF;
  IF r.status <> 'processing' THEN
    RAISE EXCEPTION 'account_deletion_not_processed' USING ERRCODE = '55000';
  END IF;
  amocrm_required := COALESCE(NULLIF(r.summary #>> '{remain,amocrmContacts}', '')::BIGINT, 0) > 0;
  IF amocrm_required AND NOT p_amocrm_erased THEN
    RAISE EXCEPTION 'account_deletion_amocrm_unconfirmed' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users u WHERE u.id = r.subject_auth_user_id) THEN
    RAISE EXCEPTION 'account_deletion_auth_user_remains' USING ERRCODE = '55000';
  END IF;
  UPDATE platform_private.account_deletion_storage_objects o SET removed_at = clock_timestamp()
  WHERE o.deletion_request_id = r.id AND o.removed_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM storage.objects so WHERE so.bucket_id = o.bucket_id AND so.name = o.object_name);
  SELECT count(*) INTO remaining FROM platform_private.account_deletion_storage_objects o
  WHERE o.deletion_request_id = r.id AND o.removed_at IS NULL;
  IF remaining > 0 THEN
    RAISE EXCEPTION 'account_deletion_storage_remains' USING ERRCODE = '55000';
  END IF;

  auth_log_left := platform_private.account_deletion_auth_log_erase(r.subject_auth_user_id, r.confirmation_email);

  UPDATE platform_private.account_deletion_requests x SET
    status = 'completed', completed_at = clock_timestamp(), completed_by_membership_id = actor.membership_id,
    summary = COALESCE(x.summary, '{}'::JSONB) || jsonb_build_object('authLogEntriesLeft', GREATEST(auth_log_left, 0))
      || CASE WHEN amocrm_required THEN jsonb_build_object('amocrmErasureConfirmed', TRUE) ELSE '{}'::JSONB END,
    confirmation_email = NULL, confirmation_email_status = p_confirmation_email_status
  WHERE x.id = r.id RETURNING * INTO r;

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_membership_id, actor_principal,
    action, resource_type, resource_id, after_state, reason, request_id
  ) VALUES (
    r.organization_id, 'user', actor.profile_id, actor.membership_id, 'auth:' || actor.auth_user_id::TEXT,
    'account.deletion.complete', 'account_deletion_request', r.id,
    jsonb_build_object('status', r.status, 'confirmation_email_status', r.confirmation_email_status,
      'removed_storage_objects', (SELECT count(*) FROM platform_private.account_deletion_storage_objects o
        WHERE o.deletion_request_id = r.id),
      'completed_late', r.completed_at > r.due_at)
      || CASE WHEN amocrm_required THEN jsonb_build_object('amocrm_erasure_confirmed', TRUE) ELSE '{}'::JSONB END,
    'Account deletion completed: Auth account and files removed',
    public.uuid_generate_v5(r.id, 'account.deletion.complete')
  );
  RETURN jsonb_build_object('id', r.id, 'status', r.status, 'completedAt', r.completed_at,
    'confirmationEmailStatus', r.confirmation_email_status);
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
  platform.complete_account_deletion_v1(UUID, TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION
  platform.request_account_deletion_v2(UUID),
  platform.own_account_deletion_request_v1(),
  platform.staff_account_deletion_queue_v1(),
  platform.staff_account_deletion_detail_v1(UUID),
  platform.process_account_deletion_v1(UUID),
  platform.complete_account_deletion_v1(UUID, TEXT, BOOLEAN)
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
      'platform.complete_account_deletion_v1(uuid,text,boolean)'::REGPROCEDURE,
      'platform_private.account_erasure_bypass()'::REGPROCEDURE,
      'platform_private.account_deletion_scope(uuid)'::REGPROCEDURE,
      'platform_private.account_erasure_conversation_rows(uuid,uuid[],uuid[])'::REGPROCEDURE,
      'platform_private.account_erasure_delete_rows(jsonb)'::REGPROCEDURE)
  LOOP
    IF NOT routine.prosecdef OR routine.proconfig IS DISTINCT FROM ARRAY['search_path=""'] THEN
      RAISE EXCEPTION 'a279_account_deletion_verification_failed: %', routine.signature;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'platform.process_account_deletion_v1(uuid)', 'EXECUTE')
    OR has_function_privilege('service_role', 'platform.process_account_deletion_v1(uuid)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'platform_private.account_erasure_bypass()', 'EXECUTE')
    OR (SELECT count(*) FROM pg_catalog.pg_proc p
        WHERE strpos(p.prosrc, '279: account erasure bypass') <> 0) <> 22
  THEN
    RAISE EXCEPTION 'a279_account_deletion_verification_failed: grants or guards';
  END IF;
END
$a279_verify$;

NOTIFY pgrst, 'reload schema';
COMMIT;
