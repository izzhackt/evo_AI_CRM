\set ON_ERROR_STOP on

-- Current-boundary acceptance for migration 279 «Удаление аккаунта по
-- запросу» (docs/PLAN_CHANGES.md 2026-10-07 and the addendum 2026-10-08
-- «только своё»: the owner's rule «удаляем только своё; чужие записи никогда
-- не меняются без явного решения человека»). Runs at the 279 checkpoint
-- against the full schema. Accounts are created through the REAL анкета path
-- (submit_student_application_v1 + decide_student_application_v1), WhatsApp
-- chats through the REAL WAHA chain (raw webhook event, durable work,
-- projection; @lid with SenderAlt included); content a student produces
-- elsewhere is seeded directly (replica mode only for the fixtures, never for
-- the erasure). Every row rolls back at the end.
--
-- Proven here:
--   (i)   who may ask: an approved student (v2 and the released v1), an
--         applicant with a pending анкета, an account without any анкета;
--         staff (system Admin, Sales, Curator) and anon are refused;
--         idempotent by request_id, one open request per account; due_at is
--         the request + 30 days;
--   (ii)  who may process and review: only account.deletion.process (the
--         system Admin); Sales, Curator, a student, anon and service_role are
--         refused for the queue, the detail, the per-item decision,
--         processing and completion;
--   Invariants (each on a FULL snapshot of the database: every row of every
--   table of platform, platform_private, private, public, auth and storage):
--   (1)   after processing, no row outside the subject's owned set changed.
--         The owned set is found by foreign keys only (review a10c869b1
--         finding 4): the owned records themselves, every row whose foreign
--         key points at an owned row, and behind a link row the person's own
--         content (a staff task behind its lead link, a raw webhook event
--         behind a message); never a row that only mentions an owned id in
--         its text. A journal entry about another record that names an owned
--         row may lose the subject's OWN values and nothing else (compared
--         with those values masked on both sides);
--   (2)   every owned personal row is gone or anonymized: after completion
--         no row of the owned set (read by its primary key, changed or not:
--         review a10c869b1 finding 1) holds the subject's names, email,
--         phone (any writing), passport number or address, and no other row
--         holds them unless it is another person's row that was there before
--         and did not change;
--   (3)   every scenario of the previous reviews of this PR stays untouched
--         or is listed in the review list (with why it matched), never
--         changed automatically: namesakes, shared family phones, addresses
--         and numbers that only contain the subject's, two numbers side by
--         side in one field, parents' contacts, chats bound to another case,
--         another person's pending cabinet (with that person's анкета it
--         cannot be erased from here), LID chats, Kazakh phone forms, amoCRM
--         numbers only on a chat and its context, other people's journal
--         entries that name the subject's case;
--   (4)   a per-item decision changes exactly one item (and the rows that
--         depend on it) and nothing else; «Не этот человек» changes nothing;
--         «Удалить» is offered only for an item on the live list;
--   (5)   processing and completion refuse while an item of the review list
--         has no decision, and completion refuses without the Admin's amoCRM
--         confirmation whenever the owned or erased records carry amoCRM
--         numbers or a sent command; completion waits for the Auth user and
--         the Storage objects; the guard bypass exists only inside the
--         erasure; every table naming a student case, a membership, a lead,
--         a client or a conversation is classified, and so is every table a
--         row of such a record can point at.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

-- The lightweight Auth bootstrap of the harness (126/185/193 convention):
-- managed Supabase Auth owns these columns, its journal and auth.role();
-- add them transaction-locally where missing, ROLLBACK discards the DDL.
ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS confirmation_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS banned_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN NOT NULL DEFAULT FALSE;
DO $p279_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = ''
    AS $fn$ SELECT NULLIF(current_setting('request.jwt.claims', TRUE), '')::JSONB ->> 'role' $fn$;
  END IF;
END
$p279_auth_role$;
CREATE TABLE IF NOT EXISTS auth.audit_log_entries (
  instance_id UUID, id UUID PRIMARY KEY, payload JSON, created_at TIMESTAMPTZ, ip_address VARCHAR(64)
);

CREATE FUNCTION pg_temp.p279_id(n INTEGER) RETURNS UUID
LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('27900000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;

CREATE FUNCTION pg_temp.p279_assert(p_condition BOOLEAN, p_message TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Migration 279 assertion failed: %', p_message;
  END IF;
END
$$;

CREATE FUNCTION pg_temp.p279_error(p_sql TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
END
$$;

CREATE FUNCTION pg_temp.p279_questionnaire(p_request UUID, p_first TEXT, p_last TEXT, p_phone TEXT)
RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'schemaVersion', 1, 'requestId', p_request::TEXT,
    'firstName', p_first, 'lastName', p_last, 'phone', p_phone,
    'destinationCountries', jsonb_build_array('CN'), 'intakeSeason', 'autumn', 'intakeYear', 2027,
    'educationLevel', 'high_school', 'averageGrade', 4.5, 'gradeScale', '5',
    'studyFields', jsonb_build_array('Инженерия'), 'studyLevels', jsonb_build_array('bachelor'),
    'nationality', 'KG', 'english', jsonb_build_object('mode', 'self', 'level', 'beginner'),
    'tuitionBudget', 'under_5000', 'fundingSource', 'family',
    'consent', TRUE, 'consentVersion', '2026-09-18')
$$;

-- Every text/JSON column of every table: how many values match the pattern.
CREATE FUNCTION pg_temp.p279_needles(p_pattern TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE r RECORD; n BIGINT; found TEXT := '';
BEGIN
  FOR r IN SELECT c.table_schema AS s, c.table_name AS t, c.column_name AS col
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema IN ('platform', 'platform_private', 'private', 'public', 'auth', 'storage')
      AND c.udt_name IN ('text', 'varchar', 'jsonb', 'json', '_text')
    ORDER BY 1, 2, 3
  LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I::TEXT ~* $1', r.s, r.t, r.col) INTO n USING p_pattern;
    IF n > 0 THEN found := found || r.s || '.' || r.t || '.' || r.col || '=' || n || ' '; END IF;
  END LOOP;
  RETURN btrim(found);
END
$$;

-- ---------------------------------------------------------------------------
-- The owned set by foreign keys (invariants (1) and (2)). p279_closure keeps,
-- under a tag, the rows reachable from the root ids: the rows of any table
-- whose uuid id is a root; every row whose foreign key points at a reached
-- row (never into the person and organization records themselves: another
-- person's case, lead, client, chat or анкета that points at an owned one is
-- shared, not owned); behind a reached row, the parent it points at when
-- that parent is the person's own content (a staff task behind its lead link
-- or call task, a raw webhook event behind a message, a knowledge blob, the
-- frozen input of an export: the classification (vi-b) lists every other
-- parent); and the rows of every table with a uuid conversation_id of a
-- reached chat (the erasure's general rule). Each row is kept by its ctid
-- and by its primary key, so it is found again after it changed.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE p279_reach (tag TEXT NOT NULL, tbl TEXT NOT NULL, tid TID NOT NULL, rnd INTEGER NOT NULL,
  pk JSONB, PRIMARY KEY (tag, tbl, tid));
CREATE INDEX ON p279_reach (tag, rnd, tbl);

CREATE FUNCTION pg_temp.p279_closure(p_tag TEXT, p_roots TEXT[]) RETURNS BIGINT
LANGUAGE plpgsql AS $$
DECLARE
  rec RECORD; v_round INTEGER := 0; added BIGINT; m BIGINT;
  hubs CONSTANT TEXT[] := ARRAY['platform.organizations', 'platform.organization_memberships', 'platform.profiles',
    'auth.users', 'platform.record_scopes', 'platform.student_cases', 'platform.leads', 'platform.clients',
    'platform.communication_conversations', 'platform_private.student_applications',
    'platform_private.account_deletion_requests'];
  ups CONSTANT TEXT[] := ARRAY['platform.staff_tasks', 'platform_private.provider_webhook_events',
    'platform_private.kb_blobs', 'platform_private.document_export_input_snapshots'];
BEGIN
  DELETE FROM p279_reach WHERE tag = p_tag;
  FOR rec IN SELECT format('%I.%I', c.table_schema, c.table_name) AS t FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema IN ('platform', 'platform_private', 'private', 'public', 'auth', 'storage')
      AND c.column_name = 'id' AND c.udt_name = 'uuid'
  LOOP
    EXECUTE format('INSERT INTO p279_reach (tag, tbl, tid, rnd) SELECT $1, %L, x.ctid, 0 FROM %s x
      WHERE x.id::TEXT = ANY ($2) ON CONFLICT DO NOTHING', rec.t, rec.t) USING p_tag, p_roots;
  END LOOP;
  LOOP
    added := 0;
    FOR rec IN
      SELECT format('%I.%I', cn.nspname, cc.relname) AS child, format('%I.%I', pn.nspname, pc.relname) AS parent,
        (SELECT string_agg(format('c.%I', a.attname), ', ' ORDER BY k.i) FROM unnest(con.conkey) WITH ORDINALITY k(n, i)
          JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.n) AS ccols,
        (SELECT string_agg(format('p.%I', a.attname), ', ' ORDER BY k.i) FROM unnest(con.confkey) WITH ORDINALITY k(n, i)
          JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.n) AS pcols
      FROM pg_constraint con
      JOIN pg_class cc ON cc.oid = con.conrelid AND cc.relkind = 'r' JOIN pg_namespace cn ON cn.oid = cc.relnamespace
      JOIN pg_class pc ON pc.oid = con.confrelid JOIN pg_namespace pn ON pn.oid = pc.relnamespace
      WHERE con.contype = 'f'
        AND (format('%I.%I', pn.nspname, pc.relname) IN (SELECT z.tbl FROM p279_reach z WHERE z.tag = p_tag AND z.rnd = v_round)
          OR (format('%I.%I', pn.nspname, pc.relname) = ANY (ups)
            AND format('%I.%I', cn.nspname, cc.relname) IN (SELECT z.tbl FROM p279_reach z WHERE z.tag = p_tag AND z.rnd = v_round)))
    LOOP
      IF NOT (rec.child = ANY (hubs)) THEN
        EXECUTE format('INSERT INTO p279_reach (tag, tbl, tid, rnd) SELECT $1, %L, c.ctid, $2 + 1 FROM %s c
          WHERE (%s) IN (SELECT %s FROM %s p WHERE p.ctid = ANY (ARRAY(SELECT z.tid FROM p279_reach z
            WHERE z.tag = $1 AND z.tbl = %L AND z.rnd = $2))) ON CONFLICT DO NOTHING',
          rec.child, rec.child, rec.ccols, rec.pcols, rec.parent, rec.parent) USING p_tag, v_round;
        GET DIAGNOSTICS m = ROW_COUNT; added := added + m;
      END IF;
      IF rec.parent = ANY (ups) THEN
        EXECUTE format('INSERT INTO p279_reach (tag, tbl, tid, rnd) SELECT $1, %L, p.ctid, $2 + 1 FROM %s p
          WHERE (%s) IN (SELECT %s FROM %s c WHERE c.ctid = ANY (ARRAY(SELECT z.tid FROM p279_reach z
            WHERE z.tag = $1 AND z.tbl = %L AND z.rnd = $2))) ON CONFLICT DO NOTHING',
          rec.parent, rec.parent, rec.pcols, rec.ccols, rec.child, rec.child) USING p_tag, v_round;
        GET DIAGNOSTICS m = ROW_COUNT; added := added + m;
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM p279_reach z WHERE z.tag = p_tag AND z.rnd = v_round
        AND z.tbl = 'platform.communication_conversations') THEN
      FOR rec IN SELECT format('%I.%I', c.table_schema, c.table_name) AS t FROM information_schema.columns c
        JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
          AND t.table_type = 'BASE TABLE'
        WHERE c.table_schema IN ('platform', 'platform_private') AND c.column_name = 'conversation_id'
          AND c.udt_name = 'uuid' AND format('%I.%I', c.table_schema, c.table_name) <> ALL (hubs)
      LOOP
        EXECUTE format('INSERT INTO p279_reach (tag, tbl, tid, rnd) SELECT $1, %L, x.ctid, $2 + 1 FROM %s x
          WHERE x.conversation_id IN (SELECT cv.id FROM platform.communication_conversations cv
            WHERE cv.ctid = ANY (ARRAY(SELECT z.tid FROM p279_reach z WHERE z.tag = $1
              AND z.tbl = ''platform.communication_conversations'' AND z.rnd = $2))) ON CONFLICT DO NOTHING',
          rec.t, rec.t) USING p_tag, v_round;
        GET DIAGNOSTICS m = ROW_COUNT; added := added + m;
      END LOOP;
    END IF;
    EXIT WHEN added = 0;
    v_round := v_round + 1;
    IF v_round > 30 THEN RAISE EXCEPTION 'p279_closure_unbounded'; END IF;
  END LOOP;
  -- The primary key of each reached row (the whole row where a table has none).
  FOR rec IN SELECT DISTINCT z.tbl,
      (SELECT string_agg(format('%L, x.%I', a.attname, a.attname), ', ' ORDER BY a.attnum)
        FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
        WHERE i.indrelid = z.tbl::REGCLASS AND i.indisprimary) AS pkcols
    FROM p279_reach z WHERE z.tag = p_tag
  LOOP
    EXECUTE format('UPDATE p279_reach z SET pk = (SELECT %s FROM %s x WHERE x.ctid = z.tid)
      WHERE z.tag = $1 AND z.tbl = %L',
      CASE WHEN rec.pkcols IS NULL THEN 'to_jsonb(x)' ELSE 'jsonb_build_object(' || rec.pkcols || ')' END,
      rec.tbl, rec.tbl) USING p_tag;
  END LOOP;
  RETURN (SELECT count(*) FROM p279_reach z WHERE z.tag = p_tag);
END
$$;

-- ---------------------------------------------------------------------------
-- Snapshots for invariant (1): md5(row::text) of EVERY row of every base
-- table of the six schemas, except the owned set (p279_closure of the roots),
-- the journal entries whose resource is a row of the owned set, and the rows
-- of auth, storage and the sign-up limits that hold one of p_names (a
-- Storage object, the sign-up limit, the Auth journal of the account: no
-- foreign key reaches them). Journal entries keep their text for the masked
-- comparison of p279_changed.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE p279_snap (tag TEXT NOT NULL, tbl TEXT NOT NULL, h TEXT NOT NULL, id UUID, txt TEXT);
CREATE INDEX ON p279_snap (tag, tbl);

CREATE FUNCTION pg_temp.p279_rx(p_values TEXT[]) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN count(*) = 0 THEN NULL ELSE '(' || string_agg(regexp_replace(v, '([.^$*+?()\[\]{}|\\/-])', '\\\1', 'g'), '|') || ')' END
  FROM (SELECT DISTINCT v FROM unnest(p_values) AS v WHERE v IS NOT NULL AND v <> '') q
$$;

CREATE FUNCTION pg_temp.p279_snapshot(p_tag TEXT, p_roots TEXT[], p_names TEXT[] DEFAULT '{}') RETURNS BIGINT
LANGUAGE plpgsql AS $$
DECLARE r RECORD; n BIGINT := 0; m BIGINT; rx TEXT := pg_temp.p279_rx(p_names); ids TEXT[] := '{}'; got TEXT[];
BEGIN
  PERFORM pg_temp.p279_closure(p_tag, COALESCE(p_roots, '{}'));
  FOR r IN SELECT DISTINCT z.tbl FROM p279_reach z WHERE z.tag = p_tag
      AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = z.tbl::REGCLASS AND a.attname = 'id'
        AND a.atttypid = 'uuid'::REGTYPE AND NOT a.attisdropped)
  LOOP
    EXECUTE format('SELECT array_agg(x.id::TEXT) FROM %s x WHERE x.ctid = ANY (ARRAY(SELECT z.tid FROM p279_reach z
      WHERE z.tag = $1 AND z.tbl = %L))', r.tbl, r.tbl) INTO got USING p_tag;
    ids := ids || COALESCE(got, '{}');
  END LOOP;
  DELETE FROM p279_snap WHERE tag = p_tag;
  FOR r IN SELECT table_schema AS s, table_name AS t, format('%I.%I', table_schema, table_name) AS q
    FROM information_schema.tables
    WHERE table_type = 'BASE TABLE'
      AND table_schema IN ('platform', 'platform_private', 'private', 'public', 'auth', 'storage')
    ORDER BY 1, 2
  LOOP
    EXECUTE format('INSERT INTO p279_snap (tag, tbl, h, id, txt) SELECT $1, %L, md5(x::TEXT), %s, %s FROM %s x
      WHERE NOT EXISTS (SELECT 1 FROM p279_reach z WHERE z.tag = $1 AND z.tbl = %L AND z.tid = x.ctid)%s%s',
      r.q, CASE WHEN r.q = 'platform.audit_events' THEN 'x.id' ELSE 'NULL::UUID' END,
      CASE WHEN r.q = 'platform.audit_events' THEN 'x::TEXT' ELSE 'NULL' END, r.q, r.q,
      CASE WHEN r.q = 'platform.audit_events' THEN ' AND NOT COALESCE(x.resource_id::TEXT = ANY ($2), FALSE)' ELSE '' END,
      CASE WHEN rx IS NOT NULL AND (r.s IN ('auth', 'storage') OR r.q = 'platform_private.student_signup_limits')
        THEN ' AND x::TEXT !~* $3' ELSE '' END) USING p_tag, ids, rx;
    GET DIAGNOSTICS m = ROW_COUNT; n := n + m;
  END LOOP;
  RETURN n;
END
$$;

-- A text with the subject's own values and the erasure's «[удалено]» masked
-- alike (runs of them become one mark).
CREATE FUNCTION pg_temp.p279_mask(p_text TEXT, p_self TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(regexp_replace(CASE WHEN p_self IS NULL THEN p_text
      ELSE regexp_replace(p_text, p_self, '#', 'gi') END, '\[удалено\]', '#', 'g'), '#([[:space:]]*#)+', '#', 'g')
$$;

-- Tables where a row of the snapshot is gone or changed ('' = none). A
-- journal entry that changed only where the subject's own values (p_self)
-- were is no change: it is an entry about another record that names an owned
-- row, and only the subject's values left it.
CREATE FUNCTION pg_temp.p279_changed(p_tag TEXT, p_self TEXT DEFAULT NULL) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE r RECORD; n BIGINT; found TEXT := '';
BEGIN
  FOR r IN SELECT DISTINCT tbl FROM p279_snap WHERE tag = p_tag ORDER BY 1 LOOP
    IF r.tbl = 'platform.audit_events' THEN
      SELECT count(*) INTO n FROM p279_snap p
      WHERE p.tag = p_tag AND p.tbl = r.tbl
        AND NOT EXISTS (SELECT 1 FROM platform.audit_events e WHERE e.id = p.id AND md5(e::TEXT) = p.h)
        AND NOT EXISTS (SELECT 1 FROM platform.audit_events e WHERE e.id = p.id
          AND pg_temp.p279_mask(e::TEXT, p_self) = pg_temp.p279_mask(p.txt, p_self));
    ELSE
      EXECUTE format('SELECT count(*) FROM (SELECT h FROM p279_snap WHERE tag = $1 AND tbl = $2
        EXCEPT ALL SELECT md5(x::TEXT) FROM %s x) q', r.tbl) INTO n USING p_tag, r.tbl;
    END IF;
    IF n > 0 THEN found := found || r.tbl || '=' || n || ' '; END IF;
  END LOOP;
  RETURN btrim(found);
END
$$;

-- Invariant (2) on the owned set itself: rows of the closure kept under the
-- tag (by their primary key, changed or not) that still hold the pattern
-- ('' = none).
CREATE FUNCTION pg_temp.p279_owned_needles(p_tag TEXT, p_pattern TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE r RECORD; n BIGINT; found TEXT := '';
BEGIN
  FOR r IN SELECT DISTINCT z.tbl FROM p279_reach z WHERE z.tag = p_tag ORDER BY 1 LOOP
    EXECUTE format('SELECT count(*) FROM %s x WHERE x::TEXT ~* $1
      AND EXISTS (SELECT 1 FROM p279_reach z WHERE z.tag = $2 AND z.tbl = %L AND to_jsonb(x) @> z.pk)', r.tbl, r.tbl)
      INTO n USING p_pattern, p_tag;
    IF n > 0 THEN found := found || r.tbl || '=' || n || ' '; END IF;
  END LOOP;
  RETURN btrim(found);
END
$$;

-- Rows that hold the pattern and are NOT an unchanged row of the snapshot
-- ('' = none): after an erasure the subject's values may be left only in
-- other people's rows that were there before and did not change.
CREATE FUNCTION pg_temp.p279_needles_outside(p_tag TEXT, p_pattern TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE r RECORD; n BIGINT; found TEXT := '';
BEGIN
  FOR r IN SELECT table_schema AS s, table_name AS t FROM information_schema.tables
    WHERE table_type = 'BASE TABLE'
      AND table_schema IN ('platform', 'platform_private', 'private', 'public', 'auth', 'storage')
    ORDER BY 1, 2
  LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I x WHERE x::TEXT ~* $1 AND NOT EXISTS (SELECT 1 FROM p279_snap p
      WHERE p.tag = $2 AND p.tbl = $3 AND p.h = md5(x::TEXT))', r.s, r.t) INTO n USING p_pattern, p_tag, r.s || '.' || r.t;
    IF n > 0 THEN found := found || r.s || '.' || r.t || '=' || n || ' '; END IF;
  END LOOP;
  RETURN btrim(found);
END
$$;

-- The review list of a staff detail as "kind:id:reason,reason" lines, and the
-- difference to an expected list ('' = equal).
CREATE FUNCTION pg_temp.p279_review_diff(p_detail JSONB, p_expected TEXT[]) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  WITH got AS (
    SELECT (e ->> 'kind') || ':' || (e ->> 'id') || ':' || (SELECT string_agg(x, ',' ORDER BY x)
      FROM jsonb_array_elements_text(e -> 'reasons') AS x) AS item
    FROM jsonb_array_elements(p_detail -> 'review') AS e
  )
  SELECT btrim(COALESCE((SELECT string_agg('missing ' || x, ' ' ORDER BY x) FROM (
      SELECT unnest(p_expected) EXCEPT SELECT item FROM got) q(x)), '')
    || ' ' || COALESCE((SELECT string_agg('extra ' || x, ' ' ORDER BY x) FROM (
      SELECT item FROM got EXCEPT SELECT unnest(p_expected)) q(x)), ''))
$$;

GRANT EXECUTE ON FUNCTION
  pg_temp.p279_id(INTEGER), pg_temp.p279_assert(BOOLEAN, TEXT), pg_temp.p279_error(TEXT),
  pg_temp.p279_questionnaire(UUID, TEXT, TEXT, TEXT), pg_temp.p279_review_diff(JSONB, TEXT[])
  TO authenticated, anon, service_role;

SELECT 'P279_ACCOUNT_DELETION_SUITE_START' AS p279_suite_marker;

-- Zarina's values. _self: her OWN values (names, her email, the email she
-- gave as her own, her phones in any writing, her passport number): a
-- journal entry about another record that names her case may lose these and
-- nothing else. _needles: her values and those of her parents and emergency
-- contact as they appear in her own rows (her owned set must hold none).
SELECT '(Зарина Удалёва|Зарина|Удалёва|p279-zarina@example\.invalid|ainura279@example\.invalid|AN2790279|'
    || '(?:[+]|00)?996[ ().-]*700[ ().-]*279[ ().-]*(?:279|281|282)|0[ ().-]*700[ ().-]*279[ ().-]*(?:279|281|282))'
  AS p279_zarina_self,
  '(Зарина|Удалёва|Гульнара|p279-zarina@example\.invalid|996[ ()-]*700[ ()-]*279[ ()-]*279|0700 ?279 ?279|'
    || 'AN2790279|Синтетическая 279|996 ?555 ?279 ?000|ainura279@|0700 ?279 ?28[12])' AS p279_zarina_needles \gset
-- The other subjects' own values, for the same masked comparison.
SELECT '(Бекзат Анкетов|Бекзат|Анкетов|p279-bekzat@example\.invalid|p279-bare@example\.invalid|'
    || '(?:[+]|00)?996[ ().-]*700[ ().-]*279[ ().-]*105|0[ ().-]*700[ ().-]*279[ ().-]*105)' AS p279_bekzat_self,
  '(Дильназ|Дочерина|Самат|Племянников|Эмиль|Сыновьев|Эрлан|Командов|p279-(?:dilnaz|samat|emil|erlan)@example\.invalid|'
    || 'samat\.p279@example\.invalid|(?:[+]|00)?996[ ().-]*700[ ().-]*279[ ().-]*(?:444|601|600|777|446|447|701|555)|'
    || '0[ ().-]*700[ ().-]*279[ ().-]*(?:444|601|600|777|446|447|701|555))' AS p279_x_self,
  '(Мадина|Мамина|Лейла|Лидова|Данияр|Казахов|p279-(?:madina|leyla|daniyar)@example\.invalid|N2792790|'
    || '(?:[+]|00)?996[ ().-]*700[ ().-]*279[ ().-]*(?:910|901)|0[ ().-]*700[ ().-]*279[ ().-]*(?:910|901)|'
    || '(?:[+]|00)?7[ ().-]*701[ ().-]*279[ ().-]*279[01]|8[ ().-]*701[ ().-]*279[ ().-]*279[01])' AS p279_ab265_self \gset

-- ---------------------------------------------------------------------------
-- Seed: organization, staff (system Admin, Sales, Curator), the анкета
-- configuration with an intake owner (the Admin is an eligible lead owner),
-- so the анкета creates the canonical client and lead at submit: the «лид из
-- анкеты» path.
-- ---------------------------------------------------------------------------
INSERT INTO platform.organizations (id, name) VALUES (pg_temp.p279_id(1), 'Migration 279 synthetic organization');
INSERT INTO platform.record_scopes (id, organization_id, scope_kind, scope_key, scope_version)
VALUES (pg_temp.p279_id(2), pg_temp.p279_id(1), 'organization', pg_temp.p279_id(1), 1);

INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at)
VALUES
  (pg_temp.p279_id(101), 'p279-admin@example.invalid', '{}'::JSONB, statement_timestamp()),
  (pg_temp.p279_id(102), 'p279-sales@example.invalid', '{}'::JSONB, statement_timestamp()),
  (pg_temp.p279_id(103), 'p279-curator@example.invalid', '{}'::JSONB, statement_timestamp()),
  (pg_temp.p279_id(104), 'p279-zarina@example.invalid', '{}'::JSONB, statement_timestamp()),
  (pg_temp.p279_id(105), 'p279-bekzat@example.invalid', '{}'::JSONB, statement_timestamp()),
  (pg_temp.p279_id(106), 'p279-bare@example.invalid', '{}'::JSONB, statement_timestamp()),
  (pg_temp.p279_id(107), 'p279-timur@example.invalid', '{}'::JSONB, statement_timestamp());

INSERT INTO platform.profiles (id, auth_user_id, display_name, status, access_version)
VALUES
  (pg_temp.p279_id(201), pg_temp.p279_id(101), 'P279 Admin', 'active', 1),
  (pg_temp.p279_id(202), pg_temp.p279_id(102), 'P279 Sales', 'active', 1),
  (pg_temp.p279_id(203), pg_temp.p279_id(103), 'P279 Curator', 'active', 1);
INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin
)
SELECT pg_temp.p279_id(300 + a.n), pg_temp.p279_id(1), pg_temp.p279_id(200 + a.n), 'active',
  a.role::platform.business_role,
  (SELECT id FROM platform.role_bundle_versions WHERE role = a.role::platform.business_role
     AND status = 'published' ORDER BY version DESC LIMIT 1),
  a.role = 'admin'
FROM (VALUES (1, 'admin'), (2, 'sales'), (3, 'curator')) AS a(n, role);
INSERT INTO platform.membership_scope_assignments (
  organization_id, membership_id, scope_id, scope_version, assignment_version, granted, actor_kind, reason, request_id
)
SELECT pg_temp.p279_id(1), pg_temp.p279_id(300 + n), pg_temp.p279_id(2), 1, 1, TRUE, 'system',
  'P279 synthetic organization scope', pg_temp.p279_id(600 + n)
FROM generate_series(1, 3) AS n;

INSERT INTO platform.staff_departments (id, organization_id, name)
VALUES (pg_temp.p279_id(930), pg_temp.p279_id(1), 'Отдел сопровождения');
DELETE FROM platform_private.student_application_configuration;
INSERT INTO platform_private.student_application_configuration
  (singleton, organization_id, review_department_id, enabled, intake_owner_membership_id)
VALUES (TRUE, pg_temp.p279_id(1), pg_temp.p279_id(930), TRUE, pg_temp.p279_id(301));

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p279_id(101),
  'claims', jsonb_build_object('sub', pg_temp.p279_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS p279_admin \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p279_id(102),
  'claims', jsonb_build_object('sub', pg_temp.p279_id(102), 'role', 'authenticated'))) -> 'claims')::TEXT AS p279_sales \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p279_id(103),
  'claims', jsonb_build_object('sub', pg_temp.p279_id(103), 'role', 'authenticated'))) -> 'claims')::TEXT AS p279_curator \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p279_id(105),
  'claims', jsonb_build_object('sub', pg_temp.p279_id(105), 'role', 'authenticated'))) -> 'claims')::TEXT AS p279_bekzat \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p279_id(106),
  'claims', jsonb_build_object('sub', pg_temp.p279_id(106), 'role', 'authenticated'))) -> 'claims')::TEXT AS p279_bare \gset

-- ---------------------------------------------------------------------------
-- Real анкеты: Zarina (will be approved and erased), Timur (approved, stays),
-- Bekzat (pending, erased as an applicant). Bare has no анкета at all.
-- ---------------------------------------------------------------------------
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p279_id(104),
  'claims', jsonb_build_object('sub', pg_temp.p279_id(104), 'role', 'authenticated'))) -> 'claims')::TEXT AS p279_zarina_pre \gset
SET request.jwt.claims TO :'p279_zarina_pre';
SET ROLE authenticated;
SELECT (platform.submit_student_application_v1(pg_temp.p279_id(701),
  pg_temp.p279_questionnaire(pg_temp.p279_id(701), 'Зарина', 'Удалёва', '+996 700 279 279'), 0) ->> 'id')::UUID AS p279_zarina_app \gset
RESET ROLE;
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p279_id(107),
  'claims', jsonb_build_object('sub', pg_temp.p279_id(107), 'role', 'authenticated'))) -> 'claims')::TEXT AS p279_timur_pre \gset
SET request.jwt.claims TO :'p279_timur_pre';
SET ROLE authenticated;
SELECT (platform.submit_student_application_v1(pg_temp.p279_id(702),
  pg_temp.p279_questionnaire(pg_temp.p279_id(702), 'Тимур', 'Остаётся', '+996 700 279 107'), 0) ->> 'id')::UUID AS p279_timur_app \gset
RESET ROLE;
SET request.jwt.claims TO :'p279_bekzat';
SET ROLE authenticated;
SELECT (platform.submit_student_application_v1(pg_temp.p279_id(703),
  pg_temp.p279_questionnaire(pg_temp.p279_id(703), 'Бекзат', 'Анкетов', '+996 700 279 105'), 0) ->> 'id')::UUID AS p279_bekzat_app \gset
RESET ROLE;

SET request.jwt.claims TO :'p279_admin';
SET ROLE authenticated;
SELECT (platform.decide_student_application_v1(:'p279_zarina_app', 1, 'approve', 'P279 одобрение', pg_temp.p279_id(711))
  ->> 'student_case_id')::UUID AS p279_zarina_case \gset
SELECT (platform.decide_student_application_v1(:'p279_timur_app', 1, 'approve', 'P279 одобрение', pg_temp.p279_id(712))
  ->> 'student_case_id')::UUID AS p279_timur_case \gset
RESET ROLE;

SELECT sc.student_membership_id AS p279_zarina_member, sc.canonical_lead_id AS p279_zarina_lead,
  l.client_id AS p279_zarina_client, sc.current_scope_id AS p279_zarina_scope
FROM platform.student_cases sc JOIN platform.leads l ON l.id = sc.canonical_lead_id
WHERE sc.id = :'p279_zarina_case' \gset
SELECT sc.student_membership_id AS p279_timur_member, sc.canonical_lead_id AS p279_timur_lead
FROM platform.student_cases sc WHERE sc.id = :'p279_timur_case' \gset
SELECT a.canonical_lead_id AS p279_bekzat_lead FROM platform_private.student_applications a
WHERE a.id = :'p279_bekzat_app' \gset
SELECT m.profile_id AS p279_zarina_profile FROM platform.organization_memberships m WHERE m.id = :'p279_zarina_member' \gset

SELECT pg_temp.p279_assert(
  :'p279_zarina_member' <> '' AND :'p279_zarina_lead' <> '' AND :'p279_bekzat_lead' <> ''
    AND (SELECT count(*) FROM platform.clients k WHERE k.id = :'p279_zarina_client'
      AND k.normalized_email = 'p279-zarina@example.invalid') = 1,
  'the анкета path did not create the membership, case, lead and client'
);

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p279_id(104),
  'claims', jsonb_build_object('sub', pg_temp.p279_id(104), 'role', 'authenticated'))) -> 'claims')::TEXT AS p279_zarina \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p279_id(107),
  'claims', jsonb_build_object('sub', pg_temp.p279_id(107), 'role', 'authenticated'))) -> 'claims')::TEXT AS p279_timur \gset

-- ---------------------------------------------------------------------------
-- Zarina's working life: an active case with a curator, documents with a file,
-- chat, a notification, a test, a consultation, a favourite, a profile with a
-- passport number, a contract file, payments, the sales register and sale
-- conditions, staff tasks and notes, Supabase Auth journal entries. Timur's
-- sale conditions mention Zarina by her phone (a mention in another record).
-- ---------------------------------------------------------------------------
-- The config-provisioned private bucket (the disposable catalog has none).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('platform-documents', 'platform-documents', FALSE, 26214400,
  ARRAY['application/pdf', 'image/jpeg', 'image/png'])
ON CONFLICT (id) DO NOTHING;

SET LOCAL session_replication_role = replica;
UPDATE platform.student_cases SET state = 'active', current_curator_membership_id = pg_temp.p279_id(303),
  handoff_at = statement_timestamp(), next_action = 'Позвонить Зарина Удалёва', operational_stage = 'documents'
WHERE id = :'p279_zarina_case';
INSERT INTO platform.student_profile_fields (organization_id, student_case_id, student_profile_id, field_key, value,
  review_state, profile_revision)
SELECT pg_temp.p279_id(1), :'p279_zarina_case', sp.id, f.k, f.v, 'needs_review', sp.revision
FROM platform.student_profiles sp
CROSS JOIN (VALUES ('passport_number', 'AN2790279'), ('mother_first_name', 'Гульнара'),
  ('mother_last_name', 'Удалёва'), ('mobile_phone', '+996700279279'),
  ('whatsapp_telegram', '0700 279 281 0700 279 282'), ('student_email', 'ainura279@example.invalid'),
  ('mother_mobile_phone', '+996 700 279 333'),
  ('education_1_school_name', 'Школа-гимназия №5'), ('emergency_contact_relationship', 'Сестра'),
  ('emergency_contact_name', 'Айнура Удалёва'),
  ('emergency_contact_phone_email', '+996 555 279 000, ainura279@example.invalid'),
  ('permanent_address', 'Бишкек, ул. Синтетическая 279')) AS f(k, v)
WHERE sp.student_case_id = :'p279_zarina_case'
ON CONFLICT (organization_id, student_profile_id, field_key) DO UPDATE SET value = EXCLUDED.value;
INSERT INTO platform.document_slots (id, organization_id, student_case_id, requirement_id, status,
  current_version_id, current_version_no, created_by_membership_id, intent_kind, display_label, group_label, version)
VALUES (pg_temp.p279_id(801), pg_temp.p279_id(1), :'p279_zarina_case', NULL, 'submitted',
  pg_temp.p279_id(802), 1, pg_temp.p279_id(303), 'custom', 'Паспорт', 'Личные документы', 2);
INSERT INTO platform.document_versions (id, organization_id, student_case_id, document_slot_id, version_no,
  original_filename, declared_mime_type, byte_size, sha256_hex, ingest_evidence_ref, submitted_by_membership_id,
  integrity_status, malware_status, malware_scan_attestation_id)
VALUES (pg_temp.p279_id(802), pg_temp.p279_id(1), :'p279_zarina_case', pg_temp.p279_id(801), 1,
  'Паспорт Зарина Удалёва AN2790279.jpg', 'image/jpeg', 1000, repeat('a', 64),
  'storage-reservation:' || pg_temp.p279_id(803), :'p279_zarina_member', 'verified', 'clean', pg_temp.p279_id(805));
INSERT INTO platform_private.document_upload_reservations (id, request_id, organization_id, student_case_id,
  document_slot_id, document_version_id, uploader_profile_id, uploader_membership_id, uploader_auth_user_id,
  bucket_id, object_name, declared_mime_type, byte_size, sha256_hex, expires_at, ingress_scan_required,
  uploader_access_version)
VALUES (pg_temp.p279_id(803), pg_temp.p279_id(813), pg_temp.p279_id(1), :'p279_zarina_case', pg_temp.p279_id(801),
  pg_temp.p279_id(802), :'p279_zarina_profile', :'p279_zarina_member', pg_temp.p279_id(104),
  'platform-documents', 'a1/' || repeat('b', 62), 'image/jpeg', 1000, repeat('a', 64),
  statement_timestamp() + INTERVAL '10 minutes', FALSE, 1);
INSERT INTO platform_private.document_upload_finalizations (id, request_id, organization_id, upload_reservation_id,
  student_case_id, document_version_id, document_slot_id, finalization_audit_event_id, bucket_id, object_name,
  published_version_no, object_created_at, finalized_at)
VALUES (pg_temp.p279_id(804), pg_temp.p279_id(814), pg_temp.p279_id(1), pg_temp.p279_id(803), :'p279_zarina_case',
  pg_temp.p279_id(802), pg_temp.p279_id(801), pg_temp.p279_id(899), 'platform-documents', 'a1/' || repeat('b', 62),
  1, statement_timestamp(), statement_timestamp());
INSERT INTO platform_private.document_malware_scan_attestations (id, request_id, organization_id, student_case_id,
  document_slot_id, document_version_id, upload_finalization_id, scanned_sha256_hex, scanner_engine,
  scanner_engine_version, scanner_signature_version, scanner_protocol, scanned_at, service_principal)
VALUES (pg_temp.p279_id(805), pg_temp.p279_id(815), pg_temp.p279_id(1), :'p279_zarina_case', pg_temp.p279_id(801),
  pg_temp.p279_id(802), pg_temp.p279_id(804), repeat('a', 64), 'ClamAV', '1.5.4', '1', 'clamd-zinstream-v1',
  statement_timestamp(), 'service:platform-document-validation');
INSERT INTO platform_private.document_storage_bindings (id, organization_id, student_case_id, document_slot_id,
  document_version_id, upload_reservation_id, bucket_id, object_name)
VALUES (pg_temp.p279_id(806), pg_temp.p279_id(1), :'p279_zarina_case', pg_temp.p279_id(801), pg_temp.p279_id(802),
  pg_temp.p279_id(803), 'platform-documents', 'a1/' || repeat('b', 62));
INSERT INTO platform.audit_events (id, organization_id, actor_kind, actor_principal, action, resource_type,
  resource_id, after_state, reason, request_id)
VALUES (pg_temp.p279_id(899), pg_temp.p279_id(1), 'system', 'service:p279', 'document.upload.finalize',
  'document_version', pg_temp.p279_id(802),
  jsonb_build_object('original_filename', 'Паспорт Зарина Удалёва AN2790279.jpg', 'email', 'p279-zarina@example.invalid'),
  'P279 synthetic finalize for Зарина Удалёва', pg_temp.p279_id(898));
INSERT INTO storage.objects (bucket_id, name, metadata)
VALUES ('platform-documents', 'a1/' || repeat('b', 62), '{}'::JSONB),
  ('platform-documents', 'contracts/' || pg_temp.p279_id(820)::TEXT, '{}'::JSONB);
INSERT INTO platform.case_contract_files (id, organization_id, student_case_id, original_filename,
  declared_mime_type, byte_size, sha256_hex, storage_object_name, uploaded_by_membership_id)
VALUES (pg_temp.p279_id(820), pg_temp.p279_id(1), :'p279_zarina_case', 'Договор Зарина Удалёва.pdf',
  'application/pdf', 2000, repeat('c', 64), 'contracts/' || pg_temp.p279_id(820)::TEXT, pg_temp.p279_id(302));
INSERT INTO platform.case_chat_threads (organization_id, student_case_id, await_state, last_message_at,
  last_message_sequence_id)
VALUES (pg_temp.p279_id(1), :'p279_zarina_case', 'awaiting_student', statement_timestamp(), 2);
INSERT INTO platform.case_chat_messages (id, organization_id, student_case_id, sequence_id, author_membership_id, body)
OVERRIDING SYSTEM VALUE
VALUES
  (pg_temp.p279_id(831), pg_temp.p279_id(1), :'p279_zarina_case', 1, pg_temp.p279_id(303),
   'Зарина, здравствуйте! Пришлите паспорт.'),
  (pg_temp.p279_id(832), pg_temp.p279_id(1), :'p279_zarina_case', 2, :'p279_zarina_member',
   'Отправила, мой телефон +996 700 279 279');
INSERT INTO platform.notifications (id, organization_id, student_case_id, recipient_membership_id, category, title,
  body, dedupe_key, created_by_membership_id)
VALUES (pg_temp.p279_id(841), pg_temp.p279_id(1), :'p279_zarina_case', :'p279_zarina_member', 'document.review',
  'Document correction required', 'Зарина, проверьте паспорт', 'p279:' || pg_temp.p279_id(841), pg_temp.p279_id(303));
INSERT INTO platform.student_assessment_attempts (id, organization_id, student_membership_id, instrument_key,
  version_id, status, revision, answers)
VALUES (pg_temp.p279_id(851), pg_temp.p279_id(1), :'p279_zarina_member', 'english36', pg_temp.p279_id(852),
  'draft', 1, '{"grammar-01": "b"}'::JSONB);
INSERT INTO platform_private.portal_consultation_requests (id, organization_id, membership_id, request_id, note)
VALUES (pg_temp.p279_id(861), pg_temp.p279_id(1), :'p279_zarina_member', pg_temp.p279_id(862),
  'Хочу обсудить стипендию');
INSERT INTO platform_private.university_favorites (organization_id, membership_id, institution_id)
VALUES (pg_temp.p279_id(1), :'p279_zarina_member', pg_temp.p279_id(863));
INSERT INTO platform.payment_obligations (id, organization_id, student_case_id, label, category, amount_minor,
  currency, next_action, total_paid_minor, total_refunded_minor, created_by_membership_id)
VALUES (pg_temp.p279_id(871), pg_temp.p279_id(1), :'p279_zarina_case', 'Услуги EVO, 1-й платёж',
  'evo_service_fee', 150000, 'USD', 'Напомнить Зарина Удалёва', 150000, 0, pg_temp.p279_id(302));
INSERT INTO platform.payment_events (id, organization_id, student_case_id, payment_obligation_id, event_type,
  amount_minor, currency, occurred_at, source_key, actor_membership_id, request_id)
VALUES (pg_temp.p279_id(872), pg_temp.p279_id(1), :'p279_zarina_case', pg_temp.p279_id(871), 'payment',
  150000, 'USD', statement_timestamp(), 'case_agreement', pg_temp.p279_id(302), pg_temp.p279_id(873));
INSERT INTO platform.payment_evidence (id, organization_id, student_case_id, payment_obligation_id,
  payment_event_id, evidence_ref, recorded_by_membership_id)
VALUES (pg_temp.p279_id(874), pg_temp.p279_id(1), :'p279_zarina_case', pg_temp.p279_id(871), pg_temp.p279_id(872),
  'case-agreement:' || pg_temp.p279_id(872), pg_temp.p279_id(302));
INSERT INTO platform_private.sales_register (id, organization_id, version, report_month, owner_membership_id,
  source_kind, lead_id, client_id, fields, source_snapshot, paid_contract_minor, paid_contract_currency)
VALUES (pg_temp.p279_id(881), pg_temp.p279_id(1), 1, date_trunc('month', statement_timestamp())::DATE,
  pg_temp.p279_id(302), 'pipeline', :'p279_zarina_lead', :'p279_zarina_client',
  jsonb_build_object('applicant_name', 'Зарина Удалёва', 'phone', '+996700279279', 'notes', 'Мама Гульнара',
    'contract_number', 'EVO-279', 'signing_date', '2026-10-01', 'paid_minor', 150000, 'paid_currency', 'USD'),
  jsonb_build_object('applicant_name', 'Зарина Удалёва', 'phone', '+996700279279', 'notes', ''),
  150000, 'USD');
INSERT INTO platform_private.lead_sale_conditions (lead_id, organization_id, fields, revision, updated_by_membership_id)
VALUES
  (:'p279_zarina_lead', pg_temp.p279_id(1), jsonb_build_object('service_cost_minor', 300000,
    'service_label', 'Поступление в Китай, связь 0700 279 281 0700 279 282',
    'payment_note', 'Платит мама Гульнара Удалёва', 'education_current', 'Школа №5'), 1, pg_temp.p279_id(302)),
  (:'p279_timur_lead', pg_temp.p279_id(1), jsonb_build_object('service_cost_minor', 200000,
    'service_label', 'Поступление в Китай', 'payment_note', 'Рекомендация от клиента +996 700 279 279'), 1,
    pg_temp.p279_id(302));
INSERT INTO platform.case_tasks (id, organization_id, student_case_id, task_type, title, assignee_membership_id,
  priority, status, student_visible, created_by_membership_id, source_key, version)
VALUES (pg_temp.p279_id(891), pg_temp.p279_id(1), :'p279_zarina_case', 'follow_up', 'Позвонить Зарина Удалёва',
  pg_temp.p279_id(303), 'high', 'open', FALSE, pg_temp.p279_id(303), 'p279.task', 1);
INSERT INTO platform.case_notes (id, organization_id, lead_id, student_case_id, body, created_by_membership_id)
VALUES (pg_temp.p279_id(892), pg_temp.p279_id(1), :'p279_zarina_lead', NULL, 'Мама Гульнара просит общежитие',
  pg_temp.p279_id(302));
SET LOCAL session_replication_role = origin;

INSERT INTO auth.audit_log_entries (instance_id, id, payload, created_at, ip_address)
VALUES (NULL, pg_temp.p279_id(951),
  json_build_object('action', 'login', 'actor_id', pg_temp.p279_id(104),
    'actor_username', 'p279-zarina@example.invalid'), statement_timestamp(), '10.2.7.9');

-- ---------------------------------------------------------------------------
-- Review ec1b3aa82. Finding 1: ANOTHER person named «Зарина Удалёва» (client,
-- lead, sales register row, manual lead receipt, journal entry) and a note in
-- Timur's case with Zarina's school and the word «сестра»: never touched,
-- never listed (no name ever searches anything). Finding 3: journal entries
-- about Zarina's task and passport version that name her case only inside
-- their state and her first name only: they point at her deleted rows and
-- are cleaned.
-- ---------------------------------------------------------------------------
SET LOCAL session_replication_role = replica;
INSERT INTO platform.clients (id, organization_id, display_name, normalized_name, phone, normalized_phone)
VALUES (pg_temp.p279_id(1101), pg_temp.p279_id(1), 'Зарина Удалёва',
  platform_private.normalize_person_name('Зарина Удалёва'), '+996 777 000 111', '+996777000111');
INSERT INTO platform.leads (id, organization_id, client_id, current_owner_membership_id, stage_key, source_key,
  interest_direction)
VALUES (pg_temp.p279_id(1102), pg_temp.p279_id(1), pg_temp.p279_id(1101), pg_temp.p279_id(302), 'new', 'manual', 'CN');
INSERT INTO platform_private.sales_register (id, organization_id, version, report_month, owner_membership_id,
  source_kind, lead_id, client_id, fields, source_snapshot, paid_contract_minor, paid_contract_currency)
VALUES (pg_temp.p279_id(1103), pg_temp.p279_id(1), 1, date_trunc('month', statement_timestamp())::DATE,
  pg_temp.p279_id(302), 'pipeline', pg_temp.p279_id(1102), pg_temp.p279_id(1101),
  jsonb_build_object('applicant_name', 'Зарина Удалёва', 'phone', '+996777000111', 'notes', 'Сестра платит',
    'contract_number', 'EVO-1103', 'paid_minor', 100000, 'paid_currency', 'USD'),
  jsonb_build_object('applicant_name', 'Зарина Удалёва', 'phone', '+996777000111', 'notes', ''),
  100000, 'USD');
INSERT INTO platform_private.manual_lead_receipts (request_id, organization_id, actor_membership_id, payload, lead_id)
VALUES (pg_temp.p279_id(1104), pg_temp.p279_id(1), pg_temp.p279_id(302),
  jsonb_build_object('displayName', 'Зарина Удалёва', 'phone', '+996 777 000 111', 'school', 'Школа-гимназия №5'),
  pg_temp.p279_id(1102));
INSERT INTO platform.audit_events (id, organization_id, actor_kind, actor_principal, action, resource_type,
  resource_id, after_state, reason, request_id)
VALUES
  (pg_temp.p279_id(1105), pg_temp.p279_id(1), 'system', 'service:p279', 'lead.create', 'lead', pg_temp.p279_id(1102),
   jsonb_build_object('display_name', 'Зарина Удалёва', 'note', 'Сестра Айгуль'), 'P279 homonym lead Зарина Удалёва',
   pg_temp.p279_id(1106)),
  (pg_temp.p279_id(1108), pg_temp.p279_id(1), 'system', 'service:p279', 'task.create', 'case_task', pg_temp.p279_id(891),
   jsonb_build_object('student_case_id', :'p279_zarina_case', 'title', 'Позвонить Зарина'), 'P279 task created',
   pg_temp.p279_id(1109)),
  (pg_temp.p279_id(1110), pg_temp.p279_id(1), 'system', 'service:p279', 'document.version.review', 'document_version',
   pg_temp.p279_id(802), jsonb_build_object('student_case_id', :'p279_zarina_case', 'reason', 'Зарина, паспорт размыт'),
   'P279 document review', pg_temp.p279_id(1112));
INSERT INTO platform.case_notes (id, organization_id, lead_id, student_case_id, body, created_by_membership_id)
VALUES (pg_temp.p279_id(1107), pg_temp.p279_id(1), NULL, :'p279_timur_case',
  'Окончила Школа-гимназия №5; на встречу придёт сестра', pg_temp.p279_id(303));
SET LOCAL session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- Finding 2: Zarina's WhatsApp chat through the REAL WAHA chain (raw webhook
-- event, durable work, projection), bound to her client and lead; a media file
-- in platform-whatsapp-media; AI memory, an AI answer, the autosend journal, a
-- ticket, amoCRM context, a decision question on her case; an amoCRM contact
-- link of her client.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public) VALUES ('platform-whatsapp-media', 'platform-whatsapp-media', FALSE)
ON CONFLICT (id) DO NOTHING;
CREATE FUNCTION pg_temp.p279_wa(p_n INTEGER, p_payload JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  org CONSTANT UUID := pg_temp.p279_id(1);
  event_id CONSTANT UUID := pg_temp.p279_id(1200 + p_n);
  enq JSONB; claim JSONB; proj JSONB; work UUID; attempt UUID;
BEGIN
  INSERT INTO platform_private.provider_webhook_events (id, organization_id, provider, provider_account_ref,
    provider_conversation_ref, provider_event_variant_ref, provider_request_id, waha_session_name, payload_id,
    event_type, provider_occurred_at, verification_status, raw_payload, verification_headers,
    verification_evidence_ref, payload_sha256, request_id)
  VALUES (event_id, org, 'waha', 'waha:crm_primary', NULL, NULL, 'p279-' || p_n, 'crm_primary',
    p_payload ->> 'id', 'message.any', to_timestamp((p_payload ->> 'timestamp')::BIGINT),
    'verified', jsonb_build_object('event', 'message.any', 'session', 'crm_primary', 'payload', p_payload),
    '{"hmac_verified":true}', 'synthetic:p279:' || p_n, lpad(to_hex(2790000 + p_n), 64, '0'),
    pg_temp.p279_id(1300 + p_n));
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
  enq := platform.enqueue_verified_webhook_work(org, event_id,
    encode(sha256(convert_to('p279-message.any-' || (p_payload ->> 'id'), 'UTF8')), 'hex'), 8,
    pg_temp.p279_id(14000 + p_n * 10 + 1));
  work := (enq ->> 'work_item_id')::UUID;
  claim := platform.claim_waha_webhook_work_item(org, work, 60, 'p279', pg_temp.p279_id(14000 + p_n * 10 + 2));
  attempt := (claim ->> 'attempt_id')::UUID;
  proj := platform.project_claimed_waha_event(org, work, attempt, pg_temp.p279_id(301),
    pg_temp.p279_id(14000 + p_n * 10 + 3));
  PERFORM platform.finish_waha_webhook_work(org, work, attempt,
    (proj ->> 'disposition')::platform.durable_work_finish_outcome, proj ->> 'error_code', proj ->> 'evidence_ref',
    NULL, pg_temp.p279_id(14000 + p_n * 10 + 4));
  RETURN proj;
END
$$;
CREATE TEMP TABLE p279_wa_runs(n INTEGER PRIMARY KEY, result JSONB);
INSERT INTO p279_wa_runs VALUES
  (1, pg_temp.p279_wa(1, jsonb_build_object('id', 'false_996700279279@c.us_P279' || lpad('1', 15, '0'),
    'timestamp', extract(epoch FROM statement_timestamp() - INTERVAL '30 minutes')::BIGINT,
    'from', '996700279279@c.us', 'fromMe', false, 'source', 'app',
    'body', 'Здравствуйте, это Зарина Удалёва, мой номер +996 700 279 279')));
INSERT INTO p279_wa_runs VALUES
  (2, pg_temp.p279_wa(2, jsonb_build_object('id', 'false_996700279279@c.us_P279' || lpad('2', 15, '0'),
    'timestamp', extract(epoch FROM statement_timestamp() - INTERVAL '29 minutes')::BIGINT,
    'from', '996700279279@c.us', 'fromMe', false, 'source', 'app', 'body', 'Паспорт',
    'hasMedia', true, 'media', jsonb_build_object('mimetype', 'application/pdf',
      'filename', 'Паспорт Зарина Удалёва AN2790279.pdf'))));
INSERT INTO p279_wa_runs VALUES
  (3, pg_temp.p279_wa(3, jsonb_build_object('id', 'true_996700279279@c.us_P279' || lpad('3', 15, '0'),
    'timestamp', extract(epoch FROM statement_timestamp() - INTERVAL '28 minutes')::BIGINT,
    'from', '79967000000@c.us', 'to', '996700279279@c.us', 'fromMe', true, 'source', 'app',
    'body', 'Зарина, пришлите, пожалуйста, паспорт')));
RESET request.jwt.claims;
SELECT pg_temp.p279_assert((SELECT count(*) = 3 AND bool_and(result ->> 'disposition' = 'succeeded') FROM p279_wa_runs),
  'the three synthetic WhatsApp messages did not project through the real chain: '
    || (SELECT string_agg(result::TEXT, ' ') FROM p279_wa_runs));
SELECT b.conversation_id AS p279_conv FROM platform_private.waha_direct_chat_bindings b
WHERE b.organization_id = pg_temp.p279_id(1) AND b.normalized_chat_id = '996700279279@c.us' \gset
SELECT m.id AS p279_wa_in FROM platform.communication_messages m
WHERE m.conversation_id = :'p279_conv' AND m.direction = 'inbound' ORDER BY m.created_at, m.id LIMIT 1 \gset
SELECT m.id AS p279_wa_media_msg FROM platform.communication_messages m
WHERE m.conversation_id = :'p279_conv' AND m.source_webhook_event_id = pg_temp.p279_id(1202) \gset

-- The chain bound the chat to a client and lead it created from the number
-- («WhatsApp +996 ••• 27 92 79»), not to Zarina's анкета client: no foreign
-- key ties the chat to her own records, so it is never erased automatically.
-- It is listed for review by its number (her mobile_phone), and the Admin
-- erases the chat, its client and its lead item by item.
SELECT pg_temp.p279_assert((SELECT c.canonical_client_id IS DISTINCT FROM :'p279_zarina_client'::UUID
    AND c.canonical_client_id IS NOT NULL FROM platform.communication_conversations c WHERE c.id = :'p279_conv'),
  'fixture: the WAHA chain did not bind the chat to its own client');
SELECT c.canonical_client_id AS p279_wa_client, c.canonical_lead_id AS p279_wa_lead
FROM platform.communication_conversations c WHERE c.id = :'p279_conv' \gset

-- The archived media of the second message (the archive worker's result).
SET LOCAL session_replication_role = replica;
INSERT INTO platform.communication_message_media (id, organization_id, conversation_id, communication_message_id,
  ordinal, media_kind, mime_type, file_name, file_size_bytes, archival_status, archived_at)
VALUES (pg_temp.p279_id(1500), pg_temp.p279_id(1), :'p279_conv', :'p279_wa_media_msg', 0, 'pdf', 'application/pdf',
  'Паспорт Зарина Удалёва AN2790279.pdf', 2048, 'archived', statement_timestamp());
INSERT INTO platform_private.waha_media_object_bindings (id, organization_id, media_id, communication_message_id,
  source_webhook_event_id, waha_session_name, raw_chat_id, raw_message_id, bucket_id, object_name)
VALUES (pg_temp.p279_id(1501), pg_temp.p279_id(1), pg_temp.p279_id(1500), :'p279_wa_media_msg', pg_temp.p279_id(1202),
  'crm_primary', '996700279279@c.us', 'false_996700279279@c.us_P279' || lpad('2', 15, '0'),
  'platform-whatsapp-media', 'cd/' || repeat('e', 62));
INSERT INTO storage.objects (bucket_id, name, metadata)
VALUES ('platform-whatsapp-media', 'cd/' || repeat('e', 62), '{}'::JSONB);
INSERT INTO platform_private.ai_client_memory (conversation_id, organization_id, interest, summary, covered_message_id,
  covered_count, interest_message_id, interest_updated_at, model, version)
VALUES (:'p279_conv', pg_temp.p279_id(1), 'Китай, инженерия', 'Зарина Удалёва хочет в Китай, телефон +996 700 279 279',
  :'p279_wa_in', 1, :'p279_wa_in', statement_timestamp(), 'gemini-2.5-flash', 1);
INSERT INTO platform_private.conversation_ai_memory_versions (id, organization_id, conversation_id, version,
  short_summary, long_summary, short_summary_sha256, long_summary_sha256, source_message_id,
  recorded_by_membership_id, reason, request_id)
VALUES (pg_temp.p279_id(1502), pg_temp.p279_id(1), :'p279_conv', 1, 'Зарина Удалёва, Китай',
  'Зарина Удалёва, паспорт AN2790279, мама Гульнара Удалёва',
  platform_private.ai_memory_text_sha256('Зарина Удалёва, Китай'),
  platform_private.ai_memory_text_sha256('Зарина Удалёва, паспорт AN2790279, мама Гульнара Удалёва'),
  :'p279_wa_in', pg_temp.p279_id(302), 'P279 память', pg_temp.p279_id(1503));
INSERT INTO platform_private.ai_answers (id, organization_id, conversation_id, source_message_id, intent,
  knowledge_fingerprint, status, result)
VALUES (pg_temp.p279_id(1504), pg_temp.p279_id(1), :'p279_conv', :'p279_wa_in', 'reply', repeat('a', 64), 'ready',
  jsonb_build_object('text', 'Зарина Удалёва, спасибо, ждём паспорт'));
INSERT INTO platform_private.ai_autosend_log (id, organization_id, conversation_id, client_message_id, source_at,
  interval_start, interval_end, status, mode, body)
VALUES (pg_temp.p279_id(1505), pg_temp.p279_id(1), :'p279_conv', :'p279_wa_in', statement_timestamp(),
  statement_timestamp() - INTERVAL '1 hour', statement_timestamp(), 'considering', 'shadow',
  'Зарина Удалёва, номер +996 700 279 279');
INSERT INTO platform_private.ai_tickets (token_sha256, id, organization_id, membership_id, purpose, conversation_id,
  issued_at, expires_at)
VALUES (repeat('b', 64), pg_temp.p279_id(1506), pg_temp.p279_id(1), pg_temp.p279_id(302), 'answer', :'p279_conv',
  statement_timestamp(), statement_timestamp() + INTERVAL '30 seconds');
INSERT INTO platform_private.amocrm_canonical_context_observations (id, organization_id, conversation_id, request_id,
  payload_sha256, observed_state, amocrm_account_id, amocrm_contact_id, amocrm_lead_id, contact_name, lead_name,
  observed_capabilities, adapter_contract_version, projected_state, projected_public_json, projected_version)
VALUES (pg_temp.p279_id(1507), pg_temp.p279_id(1), :'p279_conv', pg_temp.p279_id(1508), repeat('c', 64), 'available',
  279, 279, 279, 'Зарина Удалёва', 'Сделка Зарина Удалёва', '{}', 1, 'available', '{}'::JSONB, 1);
INSERT INTO platform.decision_backlogs (id, organization_id, conversation_id, student_case_id, created_by_profile_id,
  created_by_membership_id)
VALUES (pg_temp.p279_id(1509), pg_temp.p279_id(1), :'p279_conv', :'p279_zarina_case', pg_temp.p279_id(202),
  pg_temp.p279_id(302));
INSERT INTO platform.decision_backlog_versions (id, organization_id, conversation_id, decision_backlog_id,
  effective_version, question, owner_role, status, affected_requirement_kind, input_sha256, created_by_profile_id,
  created_by_membership_id, request_id)
VALUES (pg_temp.p279_id(1510), pg_temp.p279_id(1), :'p279_conv', pg_temp.p279_id(1509), 1,
  'Какой вуз выбрала Зарина Удалёва?', 'sales', 'unresolved', 'general', repeat('d', 64), pg_temp.p279_id(202),
  pg_temp.p279_id(302), pg_temp.p279_id(1511));
-- Review 3397bca4f finding 4: the lead-agent linked the chat to amoCRM
-- (provider_linked, 044/077/082); there is no CRM→amoCRM binding.
UPDATE platform.communication_conversations SET sales_authority_source = 'provider_linked',
  amocrm_account_id = 279, amocrm_lead_id = 279, amocrm_contact_id = 279
WHERE id = :'p279_conv';
SET LOCAL session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- Review 3397bca4f (findings 1, 2, 3 and 5): other people around Zarina. With
-- the owned-set design none of them is ever changed automatically; those with
-- Zarina's own phone or email are listed for review.
--  * Her sister Ainura is her emergency contact AND an agency client herself
--    (client, lead, sales register row, manual lead receipt, journal entry,
--    all with her own phone and email). Zarina also gave Ainura's email as her
--    own student_email: an own identifier that another live client has.
--  * Their mother: mother_mobile_phone in Zarina's profile; the mother's own
--    client is the client of record of BOTH Zarina's and Timur's cases
--    (shared), and the mother writes on WhatsApp from her number (the WAHA
--    chain's own client, bound to nothing). Timur's note names her phone and
--    Ainura's email.
--  * The first number of Zarina's whatsapp_telegram: a chat from it is bound
--    to Timur's case (provider_linked), finding 2.
--  * The second one (the family number): Sales renamed the
--    chat's client «Айдана Сестрёнка» and prepared a cabinet for her from that
--    lead (no membership), finding 3.
--  * Timur's note and a journal entry with addresses that only END or BEGIN
--    with Zarina's email, longer phone and passport numbers, and her email and
--    phone written differently, finding 5.
-- Bekzat (applicant) gave his father's phone in his анкета: the father is a
-- client with a lead and a note under that number. Bekzat's анкета lead has
-- an amoCRM lead binding.
-- ---------------------------------------------------------------------------
INSERT INTO p279_wa_runs VALUES
  (4, pg_temp.p279_wa(4, jsonb_build_object('id', 'false_996700279333@c.us_P279' || lpad('4', 15, '0'),
    'timestamp', extract(epoch FROM statement_timestamp() - INTERVAL '27 minutes')::BIGINT,
    'from', '996700279333@c.us', 'fromMe', false, 'source', 'app',
    'body', 'Здравствуйте, это мама Тимура, мой номер +996 700 279 333'))),
  (5, pg_temp.p279_wa(5, jsonb_build_object('id', 'false_996700279281@c.us_P279' || lpad('5', 15, '0'),
    'timestamp', extract(epoch FROM statement_timestamp() - INTERVAL '26 minutes')::BIGINT,
    'from', '996700279281@c.us', 'fromMe', false, 'source', 'app',
    'body', 'Пишу по поводу брата Тимура'))),
  (6, pg_temp.p279_wa(6, jsonb_build_object('id', 'false_996700279282@c.us_P279' || lpad('6', 15, '0'),
    'timestamp', extract(epoch FROM statement_timestamp() - INTERVAL '25 minutes')::BIGINT,
    'from', '996700279282@c.us', 'fromMe', false, 'source', 'app',
    'body', 'Это Айдана, хочу учиться в Малайзии')));
RESET request.jwt.claims;
SELECT pg_temp.p279_assert((SELECT count(*) = 6 AND bool_and(result ->> 'disposition' = 'succeeded') FROM p279_wa_runs),
  'the review 3397bca4f WhatsApp messages did not project through the real chain: '
    || (SELECT string_agg(result::TEXT, ' ') FROM p279_wa_runs));
SELECT c.id AS p279_mom_conv, c.canonical_client_id AS p279_mom_wa_client
FROM platform_private.waha_direct_chat_bindings b
JOIN platform.communication_conversations c ON c.id = b.conversation_id
WHERE b.organization_id = pg_temp.p279_id(1) AND b.normalized_chat_id = '996700279333@c.us' \gset
SELECT c.id AS p279_timur_conv, c.canonical_client_id AS p279_timur_conv_client, c.canonical_lead_id AS p279_timur_conv_lead
FROM platform_private.waha_direct_chat_bindings b
JOIN platform.communication_conversations c ON c.id = b.conversation_id
WHERE b.organization_id = pg_temp.p279_id(1) AND b.normalized_chat_id = '996700279281@c.us' \gset
SELECT c.id AS p279_aidana_conv, c.canonical_client_id AS p279_aidana_client, c.canonical_lead_id AS p279_aidana_lead
FROM platform_private.waha_direct_chat_bindings b
JOIN platform.communication_conversations c ON c.id = b.conversation_id
WHERE b.organization_id = pg_temp.p279_id(1) AND b.normalized_chat_id = '996700279282@c.us' \gset

SET LOCAL session_replication_role = replica;
-- Ainura, the sister and emergency contact, is a client herself.
INSERT INTO platform.clients (id, organization_id, display_name, normalized_name, email, normalized_email, phone,
  normalized_phone)
VALUES (pg_temp.p279_id(1601), pg_temp.p279_id(1), 'Айнура Удалёва',
  platform_private.normalize_person_name('Айнура Удалёва'), 'ainura279@example.invalid', 'ainura279@example.invalid',
  '+996 555 279 000', '+996555279000');
INSERT INTO platform.leads (id, organization_id, client_id, current_owner_membership_id, stage_key, source_key,
  interest_direction)
VALUES (pg_temp.p279_id(1602), pg_temp.p279_id(1), pg_temp.p279_id(1601), pg_temp.p279_id(302), 'new', 'manual', 'MY');
INSERT INTO platform_private.sales_register (id, organization_id, version, report_month, owner_membership_id,
  source_kind, lead_id, client_id, fields, source_snapshot, paid_contract_minor, paid_contract_currency)
VALUES (pg_temp.p279_id(1603), pg_temp.p279_id(1), 1, date_trunc('month', statement_timestamp())::DATE,
  pg_temp.p279_id(302), 'pipeline', pg_temp.p279_id(1602), pg_temp.p279_id(1601),
  jsonb_build_object('applicant_name', 'Айнура Удалёва', 'phone', '+996555279000', 'email', 'ainura279@example.invalid',
    'notes', 'Звонить +996 555 279 000', 'contract_number', 'EVO-1603', 'paid_minor', 90000, 'paid_currency', 'USD'),
  jsonb_build_object('applicant_name', 'Айнура Удалёва', 'phone', '+996555279000', 'email', 'ainura279@example.invalid'),
  90000, 'USD');
INSERT INTO platform_private.manual_lead_receipts (request_id, organization_id, actor_membership_id, payload, lead_id)
VALUES (pg_temp.p279_id(1604), pg_temp.p279_id(1), pg_temp.p279_id(302),
  jsonb_build_object('displayName', 'Айнура Удалёва', 'phone', '+996 555 279 000', 'email', 'ainura279@example.invalid'),
  pg_temp.p279_id(1602));
INSERT INTO platform.audit_events (id, organization_id, actor_kind, actor_principal, action, resource_type,
  resource_id, after_state, reason, request_id)
VALUES (pg_temp.p279_id(1605), pg_temp.p279_id(1), 'system', 'service:p279', 'lead.create', 'lead', pg_temp.p279_id(1602),
  jsonb_build_object('display_name', 'Айнура Удалёва', 'phone', '+996 555 279 000', 'email', 'ainura279@example.invalid'),
  'P279 lead of Ainura, +996 555 279 000', pg_temp.p279_id(1606));
-- The mother's client: the client of record of both children's cases.
INSERT INTO platform.clients (id, organization_id, display_name, normalized_name, phone, normalized_phone)
VALUES (pg_temp.p279_id(1611), pg_temp.p279_id(1), 'Мама Тимура и Зарины',
  platform_private.normalize_person_name('Мама Тимура и Зарины'), '+996 700 279 333', '+996700279333');
UPDATE platform.student_cases SET canonical_client_id = pg_temp.p279_id(1611)
WHERE id IN (:'p279_zarina_case', :'p279_timur_case');
INSERT INTO platform.case_notes (id, organization_id, lead_id, student_case_id, body, created_by_membership_id)
VALUES (pg_temp.p279_id(1612), pg_temp.p279_id(1), NULL, :'p279_timur_case',
  'Мама: +996 700 279 333; сестра: ainura279@example.invalid, +996 555 279 000', pg_temp.p279_id(303));
-- Zarina's own WhatsApp number wrote about Timur: Sales bound the chat to his case.
UPDATE platform.communication_conversations SET student_case_id = :'p279_timur_case',
  sales_authority_source = 'provider_linked', amocrm_account_id = 279, amocrm_lead_id = 2795, amocrm_contact_id = 2795
WHERE id = :'p279_timur_conv';
-- The family number (Zarina's second WhatsApp number): the chat is Aidana's.
UPDATE platform.clients SET display_name = 'Айдана Сестрёнка',
  normalized_name = platform_private.normalize_person_name('Айдана Сестрёнка')
WHERE id = :'p279_aidana_client';
-- Finding 5: whole values only.
INSERT INTO platform.case_notes (id, organization_id, lead_id, student_case_id, body, created_by_membership_id)
VALUES (pg_temp.p279_id(1621), pg_temp.p279_id(1), NULL, :'p279_timur_case',
  'Связь: P279-ZARINA@Example.invalid, +996 (700) 279-279; не путать: dina.p279-zarina@example.invalid, '
    || 'p279-zarina@example.invalid.kg, +996 700 279 2791, 19967002792790, AN27902799', pg_temp.p279_id(303));
INSERT INTO platform.audit_events (id, organization_id, actor_kind, actor_principal, action, resource_type,
  resource_id, after_state, reason, request_id)
VALUES (pg_temp.p279_id(1622), pg_temp.p279_id(1), 'system', 'service:p279', 'lead.update', 'lead', :'p279_timur_lead',
  jsonb_build_object('email', 'dina.p279-zarina@example.invalid', 'backup', 'p279-zarina@example.invalid.kg'),
  'P279 other addresses', pg_temp.p279_id(1623));
-- Bekzat's анкета phone is his father's; the father is a client with a lead.
INSERT INTO platform.clients (id, organization_id, display_name, normalized_name, phone, normalized_phone)
VALUES (pg_temp.p279_id(1631), pg_temp.p279_id(1), 'Отец Бекзата',
  platform_private.normalize_person_name('Отец Бекзата'), '+996 700 279 105', '+996700279105');
INSERT INTO platform.leads (id, organization_id, client_id, current_owner_membership_id, stage_key, source_key,
  interest_direction)
VALUES (pg_temp.p279_id(1632), pg_temp.p279_id(1), pg_temp.p279_id(1631), pg_temp.p279_id(302), 'new', 'manual', 'CN');
INSERT INTO platform.case_notes (id, organization_id, lead_id, student_case_id, body, created_by_membership_id)
VALUES (pg_temp.p279_id(1633), pg_temp.p279_id(1), pg_temp.p279_id(1632), NULL,
  'Отец, тел. +996 700 279 105', pg_temp.p279_id(302));
INSERT INTO platform_private.amocrm_lead_bindings (organization_id, lead_id, provider_lead_id, latest_attempt_id)
VALUES (pg_temp.p279_id(1), :'p279_bekzat_lead', '1050', pg_temp.p279_id(1634));
SET LOCAL session_replication_role = origin;

-- Sales prepares Aidana's cabinet from the chat's lead (the released command).
SET request.jwt.claims TO :'p279_admin';
SET ROLE authenticated;
SELECT (platform.prepare_lead_cabinet_v1(pg_temp.p279_id(1), pg_temp.p279_id(1641), :'p279_aidana_lead')
  ->> 'student_case_id')::UUID AS p279_aidana_case \gset
RESET ROLE;
RESET request.jwt.claims;
SET LOCAL session_replication_role = replica;
INSERT INTO platform.case_notes (id, organization_id, lead_id, student_case_id, body, created_by_membership_id)
VALUES (pg_temp.p279_id(1642), pg_temp.p279_id(1), NULL, :'p279_aidana_case', 'Айдана: Малайзия, бюджет 5000',
  pg_temp.p279_id(302));
SET LOCAL session_replication_role = origin;
SELECT pg_temp.p279_assert(
  (SELECT sc.student_display_name = 'Айдана Сестрёнка' AND sc.student_membership_id IS NULL AND sc.state = 'pending'
    FROM platform.student_cases sc WHERE sc.id = :'p279_aidana_case'),
  'fixture: the cabinet prepared from the family number''s chat is not Aidana''s pending cabinet');

-- ---------------------------------------------------------------------------
-- Review 3397bca4f finding 4 / ab265b795 finding 1 (amoCRM numbers only on a
-- chat and its context): Sales linked a WhatsApp chat (from a number that is
-- not in Zarina's profile) to Zarina's own анкета client and lead; the
-- lead-agent linked it to amoCRM (provider_linked) and wrote amoCRM context.
-- Every link of the chat is Zarina's: it is owned and goes automatically,
-- and its amoCRM numbers require the Admin's confirmation.
-- Review ab265b795 finding 1, scenario A: Sales opened a second deal on
-- Bekzat's анкета client card and prepared a cabinet from it (another child
-- of the family, or a second deal): the client is shared and only listed;
-- Bekzat's own анкета lead (with an amoCRM deal, a note, sale conditions and
-- a sales register row in his name) is his and is anonymized.
-- ---------------------------------------------------------------------------
INSERT INTO p279_wa_runs VALUES
  (12, pg_temp.p279_wa(12, jsonb_build_object('id', 'false_996700279283@c.us_P279' || lpad('12', 15, '0'),
    'timestamp', extract(epoch FROM statement_timestamp() - INTERVAL '19 minutes')::BIGINT,
    'from', '996700279283@c.us', 'fromMe', false, 'source', 'app',
    'body', 'Зарина Удалёва, вопрос по договору')));
RESET request.jwt.claims;
SELECT pg_temp.p279_assert((SELECT result ->> 'disposition' = 'succeeded' FROM p279_wa_runs WHERE n = 12),
  'the linked chat did not project through the real chain');
SELECT c.id AS p279_owned_conv, c.canonical_client_id AS p279_owned_conv_wa_client,
  c.canonical_lead_id AS p279_owned_conv_wa_lead
FROM platform_private.waha_direct_chat_bindings b
JOIN platform.communication_conversations c ON c.id = b.conversation_id
WHERE b.organization_id = pg_temp.p279_id(1) AND b.normalized_chat_id = '996700279283@c.us' \gset
SET LOCAL session_replication_role = replica;
UPDATE platform.communication_conversations SET canonical_client_id = :'p279_zarina_client',
  canonical_lead_id = :'p279_zarina_lead', sales_authority_source = 'provider_linked',
  amocrm_account_id = 279, amocrm_lead_id = 2830, amocrm_contact_id = 2831
WHERE id = :'p279_owned_conv';
INSERT INTO platform_private.amocrm_canonical_context_observations (id, organization_id, conversation_id, request_id,
  payload_sha256, observed_state, amocrm_account_id, amocrm_contact_id, amocrm_lead_id, contact_name, lead_name,
  observed_capabilities, adapter_contract_version, projected_state, projected_public_json, projected_version)
VALUES (pg_temp.p279_id(1650), pg_temp.p279_id(1), :'p279_owned_conv', pg_temp.p279_id(1651), repeat('d', 64), 'available',
  279, 2831, 2830, 'Зарина Удалёва', 'Договор Зарина Удалёва', '{}', 1, 'available', '{}'::JSONB, 1);

-- Scenario A: Bekzat's анкета client gets a second deal with a cabinet.
SELECT l.client_id AS p279_bekzat_client FROM platform.leads l WHERE l.id = :'p279_bekzat_lead' \gset
INSERT INTO platform.leads (id, organization_id, client_id, current_owner_membership_id, stage_key, source_key,
  interest_direction)
VALUES (pg_temp.p279_id(1660), pg_temp.p279_id(1), :'p279_bekzat_client', pg_temp.p279_id(302), 'new', 'manual', 'MY');
INSERT INTO platform.case_notes (id, organization_id, lead_id, student_case_id, body, created_by_membership_id)
VALUES (pg_temp.p279_id(1661), pg_temp.p279_id(1), :'p279_bekzat_lead', NULL,
  'Бекзат Анкетов, почта p279-bekzat@example.invalid, перезвонить', pg_temp.p279_id(302));
INSERT INTO platform_private.lead_sale_conditions (lead_id, organization_id, fields, revision, updated_by_membership_id)
VALUES (:'p279_bekzat_lead', pg_temp.p279_id(1), jsonb_build_object('service_cost_minor', 180000,
  'service_label', 'Поступление в Китай', 'payment_note', 'Платит Бекзат Анкетов'), 1, pg_temp.p279_id(302));
INSERT INTO platform_private.sales_register (id, organization_id, version, report_month, owner_membership_id,
  source_kind, lead_id, client_id, fields, source_snapshot, paid_contract_minor, paid_contract_currency)
VALUES (pg_temp.p279_id(1662), pg_temp.p279_id(1), 1, date_trunc('month', statement_timestamp())::DATE,
  pg_temp.p279_id(302), 'pipeline', :'p279_bekzat_lead', :'p279_bekzat_client',
  jsonb_build_object('applicant_name', 'Бекзат Анкетов', 'email', 'p279-bekzat@example.invalid',
    'contract_number', 'EVO-1662', 'paid_minor', 50000, 'paid_currency', 'USD'),
  jsonb_build_object('applicant_name', 'Бекзат Анкетов'), 50000, 'USD');
SET LOCAL session_replication_role = origin;
SET request.jwt.claims TO :'p279_admin';
SET ROLE authenticated;
SELECT (platform.prepare_lead_cabinet_v1(pg_temp.p279_id(1), pg_temp.p279_id(1663), pg_temp.p279_id(1660))
  ->> 'student_case_id')::UUID AS p279_bekzat_sibling_case \gset
RESET ROLE;
RESET request.jwt.claims;
SELECT pg_temp.p279_assert(
  (SELECT sc.student_membership_id IS NULL AND sc.state = 'pending' AND sc.canonical_client_id = :'p279_bekzat_client'
    FROM platform.student_cases sc WHERE sc.id = :'p279_bekzat_sibling_case'),
  'fixture: the second deal''s cabinet is not a pending cabinet on Bekzat''s анкета client');

-- ---------------------------------------------------------------------------
-- Review a10c869b1.
-- Finding 1: Sales created a staff task from Zarina's own анкета lead (the
-- real 147 command) with her name, phone, email and passport number, and the
-- Admin closed it with a result note: the task, its history, receipts,
-- result, link and notification are hers and go with her lead.
-- Finding 2: her whatsapp_telegram holds two numbers side by side, separated
-- by a space only («0700 279 281 0700 279 282», above); both chats are
-- listed, and her own kept sale conditions lose both numbers.
-- Finding 4: journal entries about OTHER people's records that name her case
-- (her sister Ainura's lead, the mother's client of record, Timur's lead):
-- they lose only Zarina's own values; the sister's, the mother's and Timur's
-- stay.
-- ---------------------------------------------------------------------------
SELECT l.workflow_version AS p279_zarina_lead_version FROM platform.leads l WHERE l.id = :'p279_zarina_lead' \gset
SET request.jwt.claims TO :'p279_admin';
SET ROLE authenticated;
SELECT platform.create_staff_task_from_lead(pg_temp.p279_id(1), pg_temp.p279_id(1680), :'p279_zarina_lead',
  :p279_zarina_lead_version, 'Позвонить: Зарина Удалёва', pg_temp.p279_id(301),
  'Телефон +996 700 279 279, почта p279-zarina@example.invalid, паспорт AN2790279', 'high') ->> 'staff_task_id'
  AS p279_staff_task \gset
SELECT platform.complete_staff_task_with_result(pg_temp.p279_id(1), pg_temp.p279_id(1681), :'p279_staff_task', 1,
  'Дозвонились: Зарина Удалёва, +996 700 279 279') ->> 'status' AS p279_x_status \gset
RESET ROLE;
RESET request.jwt.claims;
-- The task's notification to Sales (the curator's and Sales' task rights are
-- not set up in this synthetic organization, so the Admin holds the task).
SET LOCAL session_replication_role = replica;
INSERT INTO platform.staff_notifications (organization_id, recipient_membership_id, event_key, kind, staff_task_id)
VALUES (pg_temp.p279_id(1), pg_temp.p279_id(302), 'p279:task:' || :'p279_staff_task', 'task_updated', :'p279_staff_task');
SET LOCAL session_replication_role = origin;
SELECT pg_temp.p279_assert(
  EXISTS (SELECT 1 FROM platform_private.staff_lead_task_links k WHERE k.staff_task_id = :'p279_staff_task'
    AND k.lead_id = :'p279_zarina_lead')
  AND EXISTS (SELECT 1 FROM platform_private.staff_task_outcomes o WHERE o.staff_task_id = :'p279_staff_task')
  AND EXISTS (SELECT 1 FROM platform.staff_notifications n WHERE n.staff_task_id = :'p279_staff_task')
  AND (SELECT count(*) FROM platform.staff_task_events e WHERE e.staff_task_id = :'p279_staff_task') = 2,
  'fixture: the staff task from Zarina''s lead, its result and notification were not created');
SET LOCAL session_replication_role = replica;
INSERT INTO platform.audit_events (id, organization_id, actor_kind, actor_principal, action, resource_type,
  resource_id, after_state, reason, request_id)
VALUES
  (pg_temp.p279_id(1691), pg_temp.p279_id(1), 'system', 'service:p279', 'lead.update', 'lead', pg_temp.p279_id(1602),
   jsonb_build_object('display_name', 'Айнура Удалёва', 'phone', '+996 555 279 000', 'email', 'ainura279@example.invalid',
     'related_case', :'p279_zarina_case'), 'P279 Ainura lead touched', pg_temp.p279_id(1694)),
  (pg_temp.p279_id(1692), pg_temp.p279_id(1), 'system', 'service:p279', 'client.update', 'client', pg_temp.p279_id(1611),
   jsonb_build_object('display_name', 'Мама Тимура и Зарины', 'phone', '+996 700 279 333', 'first_name', 'Гульнара',
     'cases', jsonb_build_array(:'p279_zarina_case', :'p279_timur_case')), 'P279 mother client touched',
   pg_temp.p279_id(1695)),
  (pg_temp.p279_id(1693), pg_temp.p279_id(1), 'system', 'service:p279', 'lead.update', 'lead', :'p279_timur_lead',
   jsonb_build_object('note', 'Сестра Зарина Удалёва, p279-zarina@example.invalid, +996 700 279 279',
     'phone', '+996 700 279 107', 'related_case', :'p279_zarina_case'), 'P279 Timur lead touched',
   pg_temp.p279_id(1696));
SET LOCAL session_replication_role = origin;
-- Finding 2: one key for each of two numbers written side by side.
SELECT pg_temp.p279_assert(
  (SELECT phones FROM platform_private.account_erasure_identifiers(ARRAY['0700 279 281 0555 123 456']))
    = ARRAY['996555123456', '996700279281']
  AND (SELECT phones FROM platform_private.account_erasure_identifiers(ARRAY['0700279281 0555123456']))
    = ARRAY['996555123456', '996700279281']
  AND (SELECT phones FROM platform_private.account_erasure_identifiers(ARRAY['+7 701 279 2790 8 701 279 2791']))
    = ARRAY['77012792790', '77012792791']
  AND (SELECT phones FROM platform_private.account_erasure_identifiers(ARRAY['+996 700 279 279 2026, 01.10.2026']))
    = ARRAY['996700279279']
  AND (SELECT phones FROM platform_private.account_erasure_identifiers(ARRAY['+996 700 279 2791', '19967002792790']))
    = ARRAY['19967002792790', '9967002792791'],
  'two phone numbers written side by side are not read as two keys');
-- ===========================================================================
-- (i) Who may ask.
-- ===========================================================================
SET request.jwt.claims TO :'p279_zarina';
SET ROLE authenticated;
SELECT platform.request_account_deletion_v2(pg_temp.p279_id(1001))::TEXT AS p279_zarina_receipt \gset
SELECT pg_temp.p279_assert(
  :'p279_zarina_receipt'::JSONB ->> 'status' = 'requested'
    AND (:'p279_zarina_receipt'::JSONB ->> 'requestId')::UUID = pg_temp.p279_id(1001)
    AND (:'p279_zarina_receipt'::JSONB ->> 'dueAt')::TIMESTAMPTZ
      = (:'p279_zarina_receipt'::JSONB ->> 'requestedAt')::TIMESTAMPTZ + INTERVAL '30 days',
  'student request receipt is not requested with a 30-day deadline'
);
SELECT pg_temp.p279_assert(
  platform.request_account_deletion_v2(pg_temp.p279_id(1001)) = :'p279_zarina_receipt'::JSONB
    AND platform.request_account_deletion_v2(pg_temp.p279_id(1002)) = :'p279_zarina_receipt'::JSONB
    AND platform.own_account_deletion_request_v1() = :'p279_zarina_receipt'::JSONB,
  'student request is not idempotent / not one open request per account'
);
RESET ROLE;

SET request.jwt.claims TO :'p279_bekzat';
SET ROLE authenticated;
SELECT pg_temp.p279_assert(platform.own_account_deletion_request_v1() = 'null'::JSONB,
  'an applicant without a request must read null');
SELECT platform.request_account_deletion_v2(pg_temp.p279_id(1003))::TEXT AS p279_bekzat_receipt \gset
RESET ROLE;
SET request.jwt.claims TO :'p279_bare';
SET ROLE authenticated;
SELECT platform.request_account_deletion_v2(pg_temp.p279_id(1004))::TEXT AS p279_bare_receipt \gset
RESET ROLE;
-- Timur uses the RELEASED 196 path; the row gets its subject and deadline.
SET request.jwt.claims TO :'p279_timur';
SET ROLE authenticated;
SELECT platform.request_account_deletion_v1(pg_temp.p279_id(1005))::TEXT AS p279_timur_v1 \gset
SELECT pg_temp.p279_assert(
  (platform.request_account_deletion_v2(pg_temp.p279_id(1006)) ->> 'requestId')::UUID = pg_temp.p279_id(1005),
  'v2 did not return the open request the released v1 created'
);
RESET ROLE;

SELECT pg_temp.p279_assert(
  (SELECT count(*) FROM platform_private.account_deletion_requests r WHERE r.organization_id = pg_temp.p279_id(1)) = 4
  AND (SELECT r.subject_kind || '/' || (r.membership_id IS NULL)::TEXT FROM platform_private.account_deletion_requests r
    WHERE r.subject_auth_user_id = pg_temp.p279_id(105)) = 'applicant/true'
  AND (SELECT r.subject_kind || '/' || (r.membership_id IS NULL)::TEXT FROM platform_private.account_deletion_requests r
    WHERE r.subject_auth_user_id = pg_temp.p279_id(106)) = 'applicant/true'
  AND (SELECT r.subject_kind || '/' || (r.due_at = r.created_at + INTERVAL '30 days')::TEXT
    FROM platform_private.account_deletion_requests r WHERE r.subject_auth_user_id = pg_temp.p279_id(107)) = 'student/true'
  AND (SELECT count(*) FROM platform.audit_events e WHERE e.action = 'account.deletion.request'
    AND e.organization_id = pg_temp.p279_id(1)) = 3,
  'requests: kinds, deadlines or journal entries are wrong'
);

-- Staff never ask through this path; anon cannot call it.
SET request.jwt.claims TO :'p279_admin';
SET ROLE authenticated;
SELECT pg_temp.p279_assert(pg_temp.p279_error('SELECT platform.request_account_deletion_v2(gen_random_uuid())')
  LIKE '42501 account_deletion_staff_forbidden', 'the system Admin could request own deletion');
RESET ROLE;
SET request.jwt.claims TO :'p279_sales';
SET ROLE authenticated;
SELECT pg_temp.p279_assert(pg_temp.p279_error('SELECT platform.request_account_deletion_v2(gen_random_uuid())')
  LIKE '42501 account_deletion_staff_forbidden', 'Sales could request own deletion');
RESET ROLE;
SET request.jwt.claims TO '{"role":"anon"}';
SET ROLE anon;
SELECT pg_temp.p279_assert(pg_temp.p279_error('SELECT platform.request_account_deletion_v2(gen_random_uuid())')
  LIKE '42501%', 'anon could request a deletion');
SELECT pg_temp.p279_assert(pg_temp.p279_error('SELECT platform.own_account_deletion_request_v1()')
  LIKE '42501%', 'anon could read a deletion status');
RESET ROLE;
RESET request.jwt.claims;

-- ===========================================================================
-- (ii) Who may process.
-- ===========================================================================
SELECT r.id AS p279_zarina_rid FROM platform_private.account_deletion_requests r
WHERE r.subject_auth_user_id = pg_temp.p279_id(104) \gset
SELECT r.id AS p279_bekzat_rid FROM platform_private.account_deletion_requests r
WHERE r.subject_auth_user_id = pg_temp.p279_id(105) \gset
SELECT r.id AS p279_bare_rid FROM platform_private.account_deletion_requests r
WHERE r.subject_auth_user_id = pg_temp.p279_id(106) \gset

SET request.jwt.claims TO :'p279_sales';
SET ROLE authenticated;
SELECT pg_temp.p279_assert(
  pg_temp.p279_error('SELECT platform.staff_account_deletion_queue_v1()') LIKE '42501 account_deletion_forbidden'
  AND pg_temp.p279_error(format('SELECT platform.staff_account_deletion_detail_v1(%L)', :'p279_zarina_rid'))
    LIKE '42501 account_deletion_forbidden'
  AND pg_temp.p279_error(format('SELECT platform.process_account_deletion_v1(%L)', :'p279_zarina_rid'))
    LIKE '42501 account_deletion_forbidden'
  AND pg_temp.p279_error(format('SELECT platform.complete_account_deletion_v1(%L, %L, TRUE)', :'p279_zarina_rid', 'sent'))
    LIKE '42501 account_deletion_forbidden',
  'Sales reached the deletion queue or processing'
);
RESET ROLE;
SET request.jwt.claims TO :'p279_curator';
SET ROLE authenticated;
SELECT pg_temp.p279_assert(
  pg_temp.p279_error('SELECT platform.staff_account_deletion_queue_v1()') LIKE '42501 account_deletion_forbidden'
  AND pg_temp.p279_error(format('SELECT platform.process_account_deletion_v1(%L)', :'p279_zarina_rid'))
    LIKE '42501 account_deletion_forbidden',
  'the Curator reached the deletion queue or processing'
);
RESET ROLE;
SET request.jwt.claims TO :'p279_timur';
SET ROLE authenticated;
SELECT pg_temp.p279_assert(
  pg_temp.p279_error('SELECT platform.staff_account_deletion_queue_v1()') LIKE '42501 account_deletion_forbidden'
  AND pg_temp.p279_error(format('SELECT platform.process_account_deletion_v1(%L)', :'p279_zarina_rid'))
    LIKE '42501 account_deletion_forbidden',
  'a student reached the deletion queue or processing'
);
RESET ROLE;
SET ROLE service_role;
SELECT pg_temp.p279_assert(
  pg_temp.p279_error(format('SELECT platform.process_account_deletion_v1(%L)', :'p279_zarina_rid')) LIKE '42501%'
  AND pg_temp.p279_error('SELECT platform.staff_account_deletion_queue_v1()') LIKE '42501%',
  'service_role could call the staff deletion RPCs'
);
RESET ROLE;
SELECT pg_temp.p279_assert(
  NOT has_function_privilege('anon', 'platform.process_account_deletion_v1(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'platform.staff_account_deletion_queue_v1()', 'EXECUTE')
  AND NOT has_table_privilege('authenticated', 'platform_private.account_deletion_requests', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'platform_private.account_deletion_storage_objects', 'SELECT'),
  'anon can execute the staff RPCs or authenticated can read the private tables'
);
SELECT pg_temp.p279_assert(
  (SELECT d.staff_system_only AND NOT d.staff_sensitive FROM platform.permission_definitions d
    WHERE d.permission_key = 'account.deletion.process')
  AND platform_private.staff_has_permission(pg_temp.p279_id(1), pg_temp.p279_id(301), 'account.deletion.process')
  AND NOT platform_private.staff_has_permission(pg_temp.p279_id(1), pg_temp.p279_id(302), 'account.deletion.process'),
  'account.deletion.process is not a system-only permission held by the Admin only'
);

SET request.jwt.claims TO :'p279_admin';
SET ROLE authenticated;
SELECT platform.staff_account_deletion_queue_v1()::TEXT AS p279_queue \gset
SELECT pg_temp.p279_assert(
  jsonb_array_length(:'p279_queue'::JSONB) = 4
  AND (SELECT count(*) FROM jsonb_array_elements(:'p279_queue'::JSONB) q
    WHERE q ->> 'status' = 'requested' AND (q ->> 'overdue')::BOOLEAN = FALSE
      AND (q ->> 'dueAt')::TIMESTAMPTZ = (q ->> 'requestedAt')::TIMESTAMPTZ + INTERVAL '30 days') = 4
  AND (SELECT q ->> 'displayName' FROM jsonb_array_elements(:'p279_queue'::JSONB) q
    WHERE (q ->> 'id')::UUID = :'p279_zarina_rid') = 'Зарина Удалёва'
  AND (SELECT q ->> 'displayName' FROM jsonb_array_elements(:'p279_queue'::JSONB) q
    WHERE (q ->> 'id')::UUID = :'p279_bekzat_rid') = 'Бекзат Анкетов',
  'the Admin queue does not list the four requests with names and deadlines'
);

-- ===========================================================================
-- (iii) Zarina (approved student): the card shows the owned set and the
-- review list; nothing can be processed or completed while an item is open.
-- ===========================================================================
SELECT platform.staff_account_deletion_detail_v1(:'p279_zarina_rid')::TEXT AS p279_detail \gset
SELECT pg_temp.p279_assert(
  (:'p279_detail'::JSONB #>> '{counts,delete,documents}')::INT = 1
  AND (:'p279_detail'::JSONB #>> '{counts,delete,files}')::INT = 2
  AND (:'p279_detail'::JSONB #>> '{counts,delete,chatMessages}')::INT = 2
  AND (:'p279_detail'::JSONB #>> '{counts,delete,whatsappChats}')::INT = 1
  AND (:'p279_detail'::JSONB #>> '{counts,anonymize,cases}')::INT = 1
  AND (:'p279_detail'::JSONB #>> '{counts,anonymize,clients}')::INT = 1
  AND (:'p279_detail'::JSONB #>> '{counts,anonymize,leads}')::INT = 1
  AND (:'p279_detail'::JSONB #>> '{counts,anonymize,paymentObligations}')::INT = 1
  AND (:'p279_detail'::JSONB #>> '{counts,anonymize,salesRecords}')::INT = 1
  AND (:'p279_detail'::JSONB ->> 'amocrmContacts')::INT = 2
  AND :'p279_detail'::JSONB -> 'amocrm' = '{"contactIds": ["2831"], "leadIds": ["2830"], "dispatchedCommands": 0}'::JSONB
  AND (:'p279_detail'::JSONB ->> 'reviewOpen')::INT = 12
  AND (:'p279_detail'::JSONB ->> 'authAccountExists')::BOOLEAN,
  'the detail does not count the owned set: ' || (:'p279_detail'::JSONB -> 'counts')::TEXT
);
-- (3) The review list: her own number's chat (and the WAHA chain's client and
-- lead of it), the chat from her first WhatsApp number bound to Timur's case,
-- the family number's chat of Aidana, her sister's client and lead (her
-- student_email is the sister's), the mother's client shared with Timur's
-- case. Not listed: the namesake, the mother's own chat, Timur's or Aidana's
-- case, the notes that mention her (nothing is searched by name or text).
SELECT pg_temp.p279_assert(
  pg_temp.p279_review_diff(:'p279_detail'::JSONB, ARRAY[
    'chat:' || :'p279_conv' || ':phone', 'chat:' || :'p279_timur_conv' || ':phone',
    'chat:' || :'p279_aidana_conv' || ':phone',
    'lead:' || :'p279_wa_lead' || ':phone', 'lead:' || :'p279_timur_conv_lead' || ':phone',
    'lead:' || :'p279_aidana_lead' || ':phone', 'lead:' || pg_temp.p279_id(1602) || ':email',
    'client:' || :'p279_wa_client' || ':phone', 'client:' || :'p279_timur_conv_client' || ':phone',
    'client:' || :'p279_aidana_client' || ':phone', 'client:' || pg_temp.p279_id(1601) || ':email',
    'client:' || pg_temp.p279_id(1611) || ':shared']) = '',
  'Zarina''s review list is not the expected one: ' || pg_temp.p279_review_diff(:'p279_detail'::JSONB, ARRAY[
    'chat:' || :'p279_conv' || ':phone', 'chat:' || :'p279_timur_conv' || ':phone',
    'chat:' || :'p279_aidana_conv' || ':phone',
    'lead:' || :'p279_wa_lead' || ':phone', 'lead:' || :'p279_timur_conv_lead' || ':phone',
    'lead:' || :'p279_aidana_lead' || ':phone', 'lead:' || pg_temp.p279_id(1602) || ':email',
    'client:' || :'p279_wa_client' || ':phone', 'client:' || :'p279_timur_conv_client' || ':phone',
    'client:' || :'p279_aidana_client' || ':phone', 'client:' || pg_temp.p279_id(1601) || ':email',
    'client:' || pg_temp.p279_id(1611) || ':shared'])
);
SELECT pg_temp.p279_assert(
  (SELECT e -> 'amocrm' = '{"contactIds": ["279"], "leadIds": ["279"], "dispatchedCommands": 0}'::JSONB
      AND (e -> 'facts' ->> 'messages')::INT = 3 AND (e ->> 'canErase')::BOOLEAN AND e ->> 'decision' IS NULL
    FROM jsonb_array_elements(:'p279_detail'::JSONB -> 'review') e WHERE e ->> 'id' = :'p279_conv')
  AND (SELECT e -> 'facts' ->> 'caseName' = 'Тимур Остаётся'
    FROM jsonb_array_elements(:'p279_detail'::JSONB -> 'review') e WHERE e ->> 'id' = :'p279_timur_conv'),
  'a listed chat does not show its amoCRM numbers, messages or the case it is bound to'
);
-- (5) Nothing is processed while an item is open; completion needs processing.
SELECT pg_temp.p279_assert(
  pg_temp.p279_error(format('SELECT platform.process_account_deletion_v1(%L)', :'p279_zarina_rid'))
    = '55000 account_deletion_review_unresolved'
  AND pg_temp.p279_error(format('SELECT platform.complete_account_deletion_v1(%L, %L, TRUE)', :'p279_zarina_rid', 'sent'))
    = '55000 account_deletion_not_processed',
  'processing or completion ran with open review items'
);
-- A decision is accepted only for an item of this request's list.
SELECT pg_temp.p279_assert(
  pg_temp.p279_error(format('SELECT platform.resolve_account_deletion_candidate_v1(%L, %L, %L, %L)',
    :'p279_zarina_rid', 'chat', :'p279_mom_conv', 'erase')) = '42501 account_deletion_candidate_not_found'
  AND pg_temp.p279_error(format('SELECT platform.resolve_account_deletion_candidate_v1(%L, %L, %L, %L)',
    :'p279_zarina_rid', 'client', pg_temp.p279_id(1101), 'erase')) = '42501 account_deletion_candidate_not_found'
  AND pg_temp.p279_error(format('SELECT platform.resolve_account_deletion_candidate_v1(%L, %L, %L, %L)',
    :'p279_zarina_rid', 'case', :'p279_timur_case', 'not_subject')) = '42501 account_deletion_candidate_not_found'
  AND pg_temp.p279_error(format('SELECT platform.resolve_account_deletion_candidate_v1(%L, %L, %L, %L)',
    :'p279_zarina_rid', 'lead', :'p279_conv', 'erase')) = '42501 account_deletion_candidate_not_found'
  AND pg_temp.p279_error(format('SELECT platform.resolve_account_deletion_candidate_v1(%L, %L, %L, %L)',
    :'p279_zarina_rid', 'message', :'p279_conv', 'erase')) = '22023 account_deletion_invalid'
  AND pg_temp.p279_error(format('SELECT platform.resolve_account_deletion_candidate_v1(%L, %L, %L, %L)',
    :'p279_zarina_rid', 'chat', :'p279_conv', 'delete')) = '22023 account_deletion_invalid',
  'a decision was accepted for an item outside the review list or with a wrong shape'
);
RESET ROLE;
SET request.jwt.claims TO :'p279_sales';
SET ROLE authenticated;
SELECT pg_temp.p279_assert(
  pg_temp.p279_error(format('SELECT platform.resolve_account_deletion_candidate_v1(%L, %L, %L, %L)',
    :'p279_zarina_rid', 'chat', :'p279_conv', 'erase')) = '42501 account_deletion_forbidden',
  'Sales could decide a review item'
);
RESET ROLE;
RESET request.jwt.claims;

-- ===========================================================================
-- (4) Per-item decisions change exactly one item. Each is checked on a full
-- snapshot that leaves out only the rows of that one item.
-- ===========================================================================
-- Her own number's chat: the chat, its messages, media and file, raw webhook
-- events and durable work, AI memory, answer, autosend journal, ticket,
-- amoCRM context. Not its client, not its lead, nothing else.
SELECT pg_temp.p279_snapshot('item:chat', ARRAY[:'p279_conv'], ARRAY['cd/' || repeat('e', 62)]) > 0 AS p279_snap_ok \gset
SET request.jwt.claims TO :'p279_admin';
SET ROLE authenticated;
SELECT platform.resolve_account_deletion_candidate_v1(:'p279_zarina_rid', 'chat', :'p279_conv', 'erase')::TEXT
  AS p279_item \gset
RESET ROLE;
SELECT pg_temp.p279_assert(pg_temp.p279_changed('item:chat', :'p279_zarina_self') = ''
    AND (SELECT count(*) FROM p279_reach z WHERE z.tag = 'item:chat'
      AND z.tbl IN ('platform_private.provider_webhook_events', 'platform_private.durable_work_items')) >= 6,
  '«Удалить этот чат» changed rows outside that chat: ' || pg_temp.p279_changed('item:chat', :'p279_zarina_self'));
SELECT pg_temp.p279_assert(
  :'p279_item'::JSONB ->> 'decision' = 'erased'
  AND NOT EXISTS (SELECT 1 FROM platform.communication_conversations x WHERE x.id = :'p279_conv')
  AND NOT EXISTS (SELECT 1 FROM platform.communication_messages x WHERE x.conversation_id = :'p279_conv')
  AND NOT EXISTS (SELECT 1 FROM platform.communication_message_media x WHERE x.conversation_id = :'p279_conv')
  AND NOT EXISTS (SELECT 1 FROM platform_private.provider_webhook_events x
    WHERE x.id IN (pg_temp.p279_id(1201), pg_temp.p279_id(1202), pg_temp.p279_id(1203)))
  AND NOT EXISTS (SELECT 1 FROM platform_private.durable_work_items x
    WHERE x.source_webhook_event_id IN (pg_temp.p279_id(1201), pg_temp.p279_id(1202), pg_temp.p279_id(1203)))
  AND NOT EXISTS (SELECT 1 FROM platform_private.waha_direct_chat_bindings x WHERE x.normalized_chat_id = '996700279279@c.us')
  AND NOT EXISTS (SELECT 1 FROM platform_private.waha_media_object_bindings x WHERE x.id = pg_temp.p279_id(1501))
  AND NOT EXISTS (SELECT 1 FROM platform_private.ai_client_memory x WHERE x.conversation_id = :'p279_conv')
  AND NOT EXISTS (SELECT 1 FROM platform_private.conversation_ai_memory_versions x WHERE x.conversation_id = :'p279_conv')
  AND NOT EXISTS (SELECT 1 FROM platform_private.ai_answers x WHERE x.conversation_id = :'p279_conv')
  AND NOT EXISTS (SELECT 1 FROM platform_private.ai_autosend_log x WHERE x.conversation_id = :'p279_conv')
  AND NOT EXISTS (SELECT 1 FROM platform_private.ai_tickets x WHERE x.conversation_id = :'p279_conv')
  AND NOT EXISTS (SELECT 1 FROM platform_private.amocrm_canonical_context_observations x
    WHERE x.conversation_id = :'p279_conv')
  AND EXISTS (SELECT 1 FROM platform_private.account_deletion_storage_objects o
    WHERE o.deletion_request_id = :'p279_zarina_rid' AND o.object_name = 'cd/' || repeat('e', 62))
  AND (SELECT d.amocrm = '{"contactIds": ["279"], "leadIds": ["279"], "dispatchedCommands": 0}'::JSONB
      AND d.reasons = ARRAY['phone']
    FROM platform_private.account_deletion_review_items d
    WHERE d.deletion_request_id = :'p279_zarina_rid' AND d.item_id = :'p279_conv')
  AND EXISTS (SELECT 1 FROM platform.audit_events e WHERE e.action = 'account.deletion.review.erase'
    AND e.resource_id = :'p279_zarina_rid' AND e.after_state ->> 'item_id' = :'p279_conv'),
  'the chat was not erased with every dependent row, its file and its amoCRM numbers'
);
-- Its lead, then its client (the WAHA chain's placeholders of her number).
SELECT pg_temp.p279_snapshot('item:lead', ARRAY[:'p279_wa_lead']) > 0 AS p279_snap_ok \gset
SET ROLE authenticated;
SELECT platform.resolve_account_deletion_candidate_v1(:'p279_zarina_rid', 'lead', :'p279_wa_lead', 'erase')::TEXT
  AS p279_item \gset
RESET ROLE;
SELECT pg_temp.p279_assert(pg_temp.p279_changed('item:lead', :'p279_zarina_self') = ''
    AND (SELECT l.lifecycle_state = 'archived' FROM platform.leads l WHERE l.id = :'p279_wa_lead'),
  '«Обезличить этого лида» changed rows outside that lead: ' || pg_temp.p279_changed('item:lead', :'p279_zarina_self'));
SELECT pg_temp.p279_snapshot('item:client', ARRAY[:'p279_wa_client']) > 0 AS p279_snap_ok \gset
SET ROLE authenticated;
SELECT platform.resolve_account_deletion_candidate_v1(:'p279_zarina_rid', 'client', :'p279_wa_client', 'erase')::TEXT
  AS p279_item \gset
RESET ROLE;
SELECT pg_temp.p279_assert(pg_temp.p279_changed('item:client', :'p279_zarina_self') = ''
    AND (SELECT k.display_name LIKE 'Удалённый пользователь · %' AND k.phone IS NULL AND k.normalized_phone IS NULL
      FROM platform.clients k WHERE k.id = :'p279_wa_client'),
  '«Обезличить этого клиента» changed rows outside that client: ' || pg_temp.p279_changed('item:client', :'p279_zarina_self'));
-- «Не этот человек» for everything else changes nothing at all.
SELECT pg_temp.p279_snapshot('item:keep', '{}') > 0 AS p279_snap_ok \gset
SET ROLE authenticated;
SELECT count(platform.resolve_account_deletion_candidate_v1(:'p279_zarina_rid', e ->> 'kind', (e ->> 'id')::UUID,
    'not_subject')) AS p279_kept
FROM jsonb_array_elements(platform.staff_account_deletion_detail_v1(:'p279_zarina_rid') -> 'review') e
WHERE e ->> 'decision' IS NULL \gset
SELECT platform.staff_account_deletion_detail_v1(:'p279_zarina_rid')::TEXT AS p279_detail \gset
-- Idempotent; an erased item cannot become «Не этот человек».
SELECT pg_temp.p279_assert(
  (platform.resolve_account_deletion_candidate_v1(:'p279_zarina_rid', 'chat', :'p279_conv', 'erase') ->> 'decision') = 'erased'
  AND (platform.resolve_account_deletion_candidate_v1(:'p279_zarina_rid', 'client', pg_temp.p279_id(1611), 'not_subject')
    ->> 'decision') = 'not_subject'
  AND pg_temp.p279_error(format('SELECT platform.resolve_account_deletion_candidate_v1(%L, %L, %L, %L)',
    :'p279_zarina_rid', 'chat', :'p279_conv', 'not_subject')) = '55000 account_deletion_candidate_decided',
  'decisions are not idempotent or an erased item was reopened'
);
RESET ROLE;
SELECT pg_temp.p279_assert(
  :'p279_kept'::INT = 9 AND pg_temp.p279_changed('item:keep') = ''
    AND (:'p279_detail'::JSONB ->> 'reviewOpen')::INT = 0
    AND (SELECT count(*) FROM jsonb_array_elements(:'p279_detail'::JSONB -> 'review') e
      WHERE e ->> 'decision' = 'not_subject') = 9
    AND (SELECT count(*) FROM jsonb_array_elements(:'p279_detail'::JSONB -> 'review') e
      WHERE e ->> 'decision' = 'erased') = 3
    -- The erased chat keeps its amoCRM numbers for the confirmation.
    AND :'p279_detail'::JSONB -> 'amocrm'
      = '{"contactIds": ["279", "2831"], "leadIds": ["279", "2830"], "dispatchedCommands": 0}'::JSONB,
  '«Не этот человек» changed something, or the card does not show every decision: '
    || pg_temp.p279_changed('item:keep') || ' ' || (:'p279_detail'::JSONB -> 'amocrm')::TEXT
);

-- ===========================================================================
-- (1) + (2) Processing Zarina. The snapshot leaves out only the rows that
-- reach by foreign keys from her owned records: her Auth user, profile,
-- membership, анкета, case, анкета lead and client, the chat linked to them,
-- the request, and the WAHA chain's lead and client the Admin erased above;
-- plus her files, her sign-up limit and her Auth journal (no foreign key
-- reaches those). Every other row of the database must stay byte for byte;
-- a journal entry about another record that names her case may lose only
-- her own values.
-- ===========================================================================
SELECT pg_temp.p279_snapshot('zarina', ARRAY[
  pg_temp.p279_id(104)::TEXT, :'p279_zarina_profile', :'p279_zarina_member', :'p279_zarina_app', :'p279_zarina_case',
  :'p279_zarina_lead', :'p279_zarina_client', :'p279_zarina_rid', :'p279_owned_conv', :'p279_wa_lead', :'p279_wa_client'],
  ARRAY['a1/' || repeat('b', 62), 'contracts/' || pg_temp.p279_id(820)::TEXT,
  -- the file of the chat erased above waits in her request's Storage list
  'cd/' || repeat('e', 62), pg_temp.p279_id(104)::TEXT,
  'email:' || encode(sha256(convert_to('p279-zarina@example.invalid', 'UTF8')), 'hex')]) > 0 AS p279_snap_ok \gset
SET request.jwt.claims TO :'p279_admin';
SET ROLE authenticated;
SELECT platform.process_account_deletion_v1(:'p279_zarina_rid')::TEXT AS p279_processed \gset
SELECT pg_temp.p279_assert(
  :'p279_processed'::JSONB ->> 'status' = 'processing'
  AND (:'p279_processed'::JSONB ->> 'authUserId')::UUID = pg_temp.p279_id(104)
  AND :'p279_processed'::JSONB ->> 'email' = 'p279-zarina@example.invalid'
  AND jsonb_array_length(:'p279_processed'::JSONB -> 'storageObjects') = 3
  AND (:'p279_processed'::JSONB -> 'storageObjects') @> jsonb_build_array(jsonb_build_object(
    'bucket', 'platform-whatsapp-media', 'name', 'cd/' || repeat('e', 62)))
  AND (:'p279_processed'::JSONB ->> 'amocrmContacts')::INT = 4
  AND (:'p279_processed'::JSONB #>> '{summary,deleted,whatsappChats}')::INT = 1
  AND :'p279_processed'::JSONB #> '{summary,review}' = '{"erased": 3, "notSubject": 9}'::JSONB,
  'processing did not return the Auth user, the address, the three Storage keys and the amoCRM count: '
    || :'p279_processed'
);
-- Re-run is safe and returns the same remaining keys.
SELECT pg_temp.p279_assert(
  (platform.process_account_deletion_v1(:'p279_zarina_rid') -> 'storageObjects')
    = (:'p279_processed'::JSONB -> 'storageObjects'),
  'a repeated processing did not return the same remaining Storage keys'
);
RESET ROLE;
-- (5) A record with her account email that appears after processing (the Auth
-- user still exists) is a new open review item: completion refuses until the
-- Admin decides it.
SET LOCAL session_replication_role = replica;
INSERT INTO platform.clients (id, organization_id, display_name, normalized_name, email, normalized_email)
VALUES (pg_temp.p279_id(1670), pg_temp.p279_id(1), 'Новый контакт', platform_private.normalize_person_name('Новый контакт'),
  'P279-Zarina@example.invalid', 'p279-zarina@example.invalid');
SET LOCAL session_replication_role = origin;
SET ROLE authenticated;
-- (4) Review a10c869b1 finding 5: «Удалить» is offered only for an item on
-- the live list. The new record is on it; the chat from her first WhatsApp
-- number (kept as «Не этот человек» before processing) was found by a number
-- that processing removed: it is no candidate any more, so no «Удалить».
SELECT platform.staff_account_deletion_detail_v1(:'p279_zarina_rid')::TEXT AS p279_detail \gset
SELECT pg_temp.p279_assert(
  (SELECT (e ->> 'canErase')::BOOLEAN AND e ->> 'decision' IS NULL
    FROM jsonb_array_elements(:'p279_detail'::JSONB -> 'review') e WHERE e ->> 'id' = pg_temp.p279_id(1670)::TEXT)
  AND (SELECT NOT (e ->> 'canErase')::BOOLEAN AND e ->> 'decision' = 'not_subject'
    FROM jsonb_array_elements(:'p279_detail'::JSONB -> 'review') e WHERE e ->> 'id' = :'p279_timur_conv')
  AND pg_temp.p279_error(format('SELECT platform.resolve_account_deletion_candidate_v1(%L, %L, %L, %L)',
    :'p279_zarina_rid', 'chat', :'p279_timur_conv', 'erase')) = '42501 account_deletion_candidate_not_found',
  'after processing «Удалить» is offered for an item that is no candidate any more'
);
SELECT pg_temp.p279_assert(
  pg_temp.p279_error(format('SELECT platform.complete_account_deletion_v1(%L, %L, TRUE)', :'p279_zarina_rid', 'sent'))
    = '55000 account_deletion_review_unresolved'
  AND (platform.resolve_account_deletion_candidate_v1(:'p279_zarina_rid', 'client', pg_temp.p279_id(1670), 'not_subject')
    ->> 'decision') = 'not_subject'
  AND pg_temp.p279_error(format('SELECT platform.complete_account_deletion_v1(%L, %L, TRUE)', :'p279_zarina_rid', 'sent'))
    = '55000 account_deletion_auth_user_remains',
  'completion did not wait for the new review item or for the Auth user'
);
RESET ROLE;
SET LOCAL session_replication_role = replica;
DELETE FROM platform.clients WHERE id = pg_temp.p279_id(1670);
SET LOCAL session_replication_role = origin;

-- The bypass is gone after processing, even in the same transaction.
SET LOCAL platform.account_erasure_request_id = :'p279_zarina_rid';
SELECT pg_temp.p279_assert(
  pg_temp.p279_error(format('DELETE FROM platform.audit_events WHERE id = %L', pg_temp.p279_id(899)))
    LIKE '55000%append-only%'
  AND pg_temp.p279_error(format('UPDATE platform.student_cases SET public_application_id = gen_random_uuid() WHERE id = %L',
    :'p279_timur_case')) LIKE '55000%immutable%',
  'a guard let a mutation through outside the processing statement'
);
SET LOCAL platform.account_erasure_request_id = '';

-- The server route: Storage API removes the objects, Auth Admin deletes the
-- user. A plain DELETE as the database owner proves no foreign key holds it.
SELECT pg_temp.p279_assert(
  (SELECT count(*) FROM auth.users u WHERE u.id = pg_temp.p279_id(104)) = 1, 'the Auth user vanished early');
DELETE FROM auth.users WHERE id = pg_temp.p279_id(104);
SET ROLE authenticated;
SELECT pg_temp.p279_assert(
  pg_temp.p279_error(format('SELECT platform.complete_account_deletion_v1(%L, %L, TRUE)', :'p279_zarina_rid', 'sent'))
    = '55000 account_deletion_storage_remains',
  'completion did not wait for the Storage objects'
);
RESET ROLE;
DO $p279_storage$
BEGIN
  PERFORM set_config('storage.allow_delete_query', 'true', TRUE);
  DELETE FROM storage.objects o USING platform_private.account_deletion_storage_objects d
  WHERE d.deletion_request_id = (SELECT r.id FROM platform_private.account_deletion_requests r
      WHERE r.subject_auth_user_id = '27900000-0000-4000-8000-000000000104')
    AND o.bucket_id = d.bucket_id AND o.name = d.object_name;
  PERFORM set_config('storage.allow_delete_query', 'false', TRUE);
END
$p279_storage$;
SET ROLE authenticated;
-- (5) amoCRM is outside the database: the owned chat's numbers (2830/2831)
-- and the erased chat's (279) need the Admin's confirmation.
SELECT pg_temp.p279_assert(
  pg_temp.p279_error(format('SELECT platform.complete_account_deletion_v1(%L, %L, FALSE)', :'p279_zarina_rid', 'sent'))
    = '55000 account_deletion_amocrm_unconfirmed'
  AND pg_temp.p279_error(format('SELECT platform.complete_account_deletion_v1(%L, %L, NULL)', :'p279_zarina_rid', 'sent'))
    = '22023 account_deletion_invalid',
  'completion did not require the amoCRM confirmation'
);
SELECT platform.complete_account_deletion_v1(:'p279_zarina_rid', 'sent', TRUE)::TEXT AS p279_completed \gset
SELECT pg_temp.p279_assert(
  :'p279_completed'::JSONB ->> 'status' = 'completed'
  AND :'p279_completed'::JSONB ->> 'confirmationEmailStatus' = 'sent'
  AND platform.complete_account_deletion_v1(:'p279_zarina_rid', 'failed', FALSE) = :'p279_completed'::JSONB
  AND (platform.process_account_deletion_v1(:'p279_zarina_rid') ->> 'status') = 'completed'
  AND pg_temp.p279_error(format('SELECT platform.resolve_account_deletion_candidate_v1(%L, %L, %L, %L)',
    :'p279_zarina_rid', 'client', pg_temp.p279_id(1611), 'erase')) = '55000 account_deletion_completed',
  'completion is not durable and idempotent, or a decision was taken after completion'
);
SELECT platform.staff_account_deletion_detail_v1(:'p279_zarina_rid')::TEXT AS p279_detail \gset
RESET ROLE;
SELECT pg_temp.p279_assert(
  :'p279_detail'::JSONB ->> 'displayName' = 'Удалённый пользователь · ' || left(replace(:'p279_zarina_rid', '-', ''), 8)
  AND :'p279_detail'::JSONB -> 'email' = 'null'::JSONB
  AND jsonb_array_length(:'p279_detail'::JSONB -> 'review') = 13
  AND :'p279_detail'::JSONB -> 'amocrm'
    = '{"contactIds": ["279", "2831"], "leadIds": ["279", "2830"], "dispatchedCommands": 0}'::JSONB
  AND (SELECT (r.summary ->> 'amocrmErasureConfirmed')::BOOLEAN FROM platform_private.account_deletion_requests r
    WHERE r.id = :'p279_zarina_rid')
  AND EXISTS (SELECT 1 FROM platform.audit_events e WHERE e.action = 'account.deletion.complete'
    AND e.resource_id = :'p279_zarina_rid' AND (e.after_state ->> 'amocrm_erasure_confirmed')::BOOLEAN),
  'a completed request still shows the person, or lost its decisions or amoCRM numbers: ' || :'p279_detail'
);
RESET request.jwt.claims;

-- (1) No row outside her owned set changed.
SELECT pg_temp.p279_assert(pg_temp.p279_changed('zarina', :'p279_zarina_self') = '',
  'processing Zarina changed rows outside her owned set: ' || pg_temp.p279_changed('zarina', :'p279_zarina_self'));
-- (2) Her names, email, phone (any writing), passport number, address and her
-- parents' and emergency contact's values are left only in other people's
-- rows that did not change (the namesake, her sister's own records, Timur's
-- note and sale conditions that mention her, the chats marked «Не этот
-- человек»).
SELECT pg_temp.p279_assert(pg_temp.p279_needles_outside('zarina', :'p279_zarina_needles') = '',
  'personal values of Zarina are left in rows that are not other people''s unchanged rows: '
    || pg_temp.p279_needles_outside('zarina', :'p279_zarina_needles'));
-- (2) Every row of her owned set (found again by its primary key, changed or
-- not: a staff task whose link to her lead was deleted is still hers) holds
-- none of them (review a10c869b1 finding 1).
SELECT pg_temp.p279_assert(pg_temp.p279_owned_needles('zarina', :'p279_zarina_needles') = '',
  'rows of Zarina''s owned set still hold her personal values: '
    || pg_temp.p279_owned_needles('zarina', :'p279_zarina_needles'));
-- What is gone.
SELECT pg_temp.p279_assert(
  NOT EXISTS (SELECT 1 FROM platform_private.student_applications a WHERE a.id = :'p279_zarina_app')
  AND NOT EXISTS (SELECT 1 FROM platform_private.student_application_receipts x WHERE x.application_id = :'p279_zarina_app')
  AND NOT EXISTS (SELECT 1 FROM platform.document_versions v WHERE v.student_case_id = :'p279_zarina_case')
  AND NOT EXISTS (SELECT 1 FROM platform.document_slots v WHERE v.student_case_id = :'p279_zarina_case')
  AND NOT EXISTS (SELECT 1 FROM platform_private.document_storage_bindings v WHERE v.student_case_id = :'p279_zarina_case')
  AND NOT EXISTS (SELECT 1 FROM platform.case_chat_messages v WHERE v.student_case_id = :'p279_zarina_case')
  AND NOT EXISTS (SELECT 1 FROM platform.case_chat_threads v WHERE v.student_case_id = :'p279_zarina_case')
  AND NOT EXISTS (SELECT 1 FROM platform.notifications v WHERE v.recipient_membership_id = :'p279_zarina_member')
  AND NOT EXISTS (SELECT 1 FROM platform.student_assessment_attempts v WHERE v.student_membership_id = :'p279_zarina_member')
  AND NOT EXISTS (SELECT 1 FROM platform_private.portal_consultation_requests v WHERE v.membership_id = :'p279_zarina_member')
  AND NOT EXISTS (SELECT 1 FROM platform_private.university_favorites v WHERE v.membership_id = :'p279_zarina_member')
  AND NOT EXISTS (SELECT 1 FROM platform.student_profiles v WHERE v.student_case_id = :'p279_zarina_case')
  AND NOT EXISTS (SELECT 1 FROM platform.student_profile_fields v WHERE v.student_case_id = :'p279_zarina_case')
  AND NOT EXISTS (SELECT 1 FROM platform.case_contract_files v WHERE v.student_case_id = :'p279_zarina_case')
  AND NOT EXISTS (SELECT 1 FROM platform.case_tasks v WHERE v.student_case_id = :'p279_zarina_case')
  AND NOT EXISTS (SELECT 1 FROM platform.case_notes v WHERE v.lead_id = :'p279_zarina_lead')
  AND NOT EXISTS (SELECT 1 FROM platform.external_identifiers v WHERE v.client_id = :'p279_zarina_client')
  AND NOT EXISTS (SELECT 1 FROM public.accounts v WHERE v.owner_user_id = pg_temp.p279_id(104))
  AND NOT EXISTS (SELECT 1 FROM platform.profiles v WHERE v.auth_user_id = pg_temp.p279_id(104))
  AND NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.name = 'a1/' || repeat('b', 62))
  -- The chat linked to her own client and lead, with its raw event, context
  -- and decision question.
  AND NOT EXISTS (SELECT 1 FROM platform.communication_conversations x WHERE x.id = :'p279_owned_conv')
  AND NOT EXISTS (SELECT 1 FROM platform_private.provider_webhook_events x WHERE x.id = pg_temp.p279_id(1212))
  AND NOT EXISTS (SELECT 1 FROM platform_private.amocrm_canonical_context_observations x
    WHERE x.conversation_id = :'p279_owned_conv')
  AND NOT EXISTS (SELECT 1 FROM platform.decision_backlogs x WHERE x.id = pg_temp.p279_id(1509)),
  'some personal content of the erased student is still in the database'
);
-- Review a10c869b1 finding 1: the staff task from her lead with its history,
-- receipts, result, link and notification.
SELECT pg_temp.p279_assert(
  NOT EXISTS (SELECT 1 FROM platform.staff_tasks t WHERE t.id = :'p279_staff_task')
  AND NOT EXISTS (SELECT 1 FROM platform.staff_task_events e WHERE e.staff_task_id = :'p279_staff_task')
  AND NOT EXISTS (SELECT 1 FROM platform_private.staff_task_receipts r WHERE r.staff_task_id = :'p279_staff_task')
  AND NOT EXISTS (SELECT 1 FROM platform_private.staff_task_outcomes o WHERE o.staff_task_id = :'p279_staff_task')
  AND NOT EXISTS (SELECT 1 FROM platform_private.staff_lead_task_links k WHERE k.staff_task_id = :'p279_staff_task')
  AND NOT EXISTS (SELECT 1 FROM platform.staff_notifications n WHERE n.staff_task_id = :'p279_staff_task')
  AND (:'p279_processed'::JSONB #>> '{summary,deleted,staffTasks}')::INT = 1,
  'the staff task created from her lead is still there: ' || (:'p279_processed'::JSONB #> '{summary,deleted}')::TEXT
);
-- Review a10c869b1 finding 4: other people's journal entries that name her
-- case lose only her own values (Ainura's email is the one Zarina gave as her
-- student_email, but the Admin kept Ainura's client as «Не этот человек»:
-- not Zarina's alone, so it stays, and so does the surname they share).
SELECT pg_temp.p279_assert(
  (SELECT e.after_state - 'related_case' FROM platform.audit_events e WHERE e.id = pg_temp.p279_id(1691))
    = '{"display_name": "Айнура Удалёва", "phone": "+996 555 279 000", "email": "ainura279@example.invalid"}'::JSONB
  AND (SELECT e.after_state - 'cases' FROM platform.audit_events e WHERE e.id = pg_temp.p279_id(1692))
    = '{"display_name": "Мама Тимура и Зарины", "phone": "+996 700 279 333", "first_name": "Гульнара"}'::JSONB
  AND (SELECT e.after_state - 'related_case' FROM platform.audit_events e WHERE e.id = pg_temp.p279_id(1693))
    = '{"note": "Сестра [удалено], [удалено], [удалено]", "phone": "+996 700 279 107"}'::JSONB,
  'other people''s journal entries lost more than Zarina''s own values: '
    || (SELECT string_agg(e.after_state::TEXT, ' ' ORDER BY e.id) FROM platform.audit_events e
      WHERE e.id IN (pg_temp.p279_id(1691), pg_temp.p279_id(1692), pg_temp.p279_id(1693)))
);
-- What is kept, anonymized.
SELECT pg_temp.p279_assert(
  (SELECT sc.state = 'closed' AND sc.student_display_name LIKE 'Удалённый пользователь · %'
      AND sc.public_application_id IS NULL AND sc.next_action IS NULL
    FROM platform.student_cases sc WHERE sc.id = :'p279_zarina_case')
  AND (SELECT p.auth_user_id IS NULL AND p.status = 'blocked' AND p.display_name LIKE 'Удалённый пользователь · %'
    FROM platform.profiles p WHERE p.id = :'p279_zarina_profile')
  AND (SELECT m.status = 'inactive' FROM platform.organization_memberships m WHERE m.id = :'p279_zarina_member')
  AND (SELECT k.email IS NULL AND k.phone IS NULL AND k.normalized_email IS NULL
      AND k.display_name LIKE 'Удалённый пользователь · %' AND k.lifecycle_state = 'inactive'
    FROM platform.clients k WHERE k.id = :'p279_zarina_client')
  AND (SELECT l.lifecycle_state = 'archived' FROM platform.leads l WHERE l.id = :'p279_zarina_lead')
  AND (SELECT o.amount_minor = 150000 AND o.currency = 'USD' AND o.total_paid_minor = 150000 AND o.next_action IS NULL
    FROM platform.payment_obligations o WHERE o.id = pg_temp.p279_id(871))
  AND EXISTS (SELECT 1 FROM platform.payment_events e WHERE e.id = pg_temp.p279_id(872) AND e.amount_minor = 150000)
  AND EXISTS (SELECT 1 FROM platform.payment_evidence e WHERE e.id = pg_temp.p279_id(874))
  AND (SELECT sr.fields ->> 'applicant_name' LIKE 'Удалённый пользователь · %'
      AND sr.fields ->> 'phone' = '' AND sr.fields ->> 'notes' = ''
      AND sr.fields ->> 'contract_number' = 'EVO-279' AND sr.paid_contract_minor = 150000
      AND sr.source_snapshot ->> 'applicant_name' LIKE 'Удалённый пользователь · %'
    FROM platform_private.sales_register sr WHERE sr.id = pg_temp.p279_id(881))
  AND (SELECT lc.fields ->> 'payment_note' = '' AND lc.fields ->> 'education_current' = ''
      AND (lc.fields ->> 'service_cost_minor')::INT = 300000
      -- review a10c869b1 finding 2: both numbers written side by side
      AND lc.fields ->> 'service_label' = 'Поступление в Китай, связь [удалено] [удалено]'
    FROM platform_private.lead_sale_conditions lc WHERE lc.lead_id = :'p279_zarina_lead')
  AND EXISTS (SELECT 1 FROM platform.student_case_lifecycle_events e
    WHERE e.student_case_id = :'p279_zarina_case' AND e.event_type = 'closed'),
  'the case, contract and payment records are not kept anonymized'
);
-- Journal entries about her task and passport version (they name her case
-- only inside their state) lose her first name; the entry about the file
-- loses her email.
SELECT pg_temp.p279_assert(
  (SELECT e.after_state ->> 'title' FROM platform.audit_events e WHERE e.id = pg_temp.p279_id(1108))
    = 'Позвонить [удалено]'
  AND (SELECT e.after_state ->> 'reason' FROM platform.audit_events e WHERE e.id = pg_temp.p279_id(1110))
    = '[удалено], паспорт размыт'
  AND (SELECT e.after_state ->> 'email' FROM platform.audit_events e WHERE e.id = pg_temp.p279_id(899)) = '[удалено]',
  'journal entries about her deleted rows kept her name or email'
);
-- (3) Spelled out for the earlier review scenarios (the snapshot above
-- already holds them): the namesake, the school and «сестра», Timur's note
-- and sale conditions that mention her, the addresses and numbers that only
-- contain hers, her sister's and mother's records, the chat bound to Timur's
-- case and Aidana's cabinet are exactly as they were.
SELECT pg_temp.p279_assert(
  (SELECT n.body FROM platform.case_notes n WHERE n.id = pg_temp.p279_id(1621))
    = 'Связь: P279-ZARINA@Example.invalid, +996 (700) 279-279; не путать: dina.p279-zarina@example.invalid, '
      || 'p279-zarina@example.invalid.kg, +996 700 279 2791, 19967002792790, AN27902799'
  AND (SELECT lc.fields ->> 'payment_note' FROM platform_private.lead_sale_conditions lc
    WHERE lc.lead_id = :'p279_timur_lead') = 'Рекомендация от клиента +996 700 279 279'
  AND (SELECT n.body FROM platform.case_notes n WHERE n.id = pg_temp.p279_id(1107))
    = 'Окончила Школа-гимназия №5; на встречу придёт сестра'
  AND (SELECT k.display_name = 'Зарина Удалёва' FROM platform.clients k WHERE k.id = pg_temp.p279_id(1101))
  AND (SELECT k.email = 'ainura279@example.invalid' FROM platform.clients k WHERE k.id = pg_temp.p279_id(1601))
  AND (SELECT k.display_name = 'Мама Тимура и Зарины' FROM platform.clients k WHERE k.id = pg_temp.p279_id(1611))
  AND EXISTS (SELECT 1 FROM platform.communication_conversations c WHERE c.id = :'p279_timur_conv'
    AND c.student_case_id = :'p279_timur_case')
  AND (SELECT sc.student_display_name = 'Айдана Сестрёнка' AND sc.state = 'pending'
    FROM platform.student_cases sc WHERE sc.id = :'p279_aidana_case')
  AND (SELECT sc.student_display_name = 'Тимур Остаётся' AND sc.state = 'pending'
    FROM platform.student_cases sc WHERE sc.id = :'p279_timur_case')
  AND (SELECT r.status = 'requested' FROM platform_private.account_deletion_requests r
    WHERE r.subject_auth_user_id = pg_temp.p279_id(107)),
  'another person''s record changed when Zarina was erased'
);

-- ===========================================================================
-- Bekzat (pending анкета, lead created from it; his анкета phone is his
-- father's) and Bare (no анкета). Scenario A of review ab265b795: his own
-- анкета lead is his (anonymized, its amoCRM deal needs the confirmation);
-- the client card is shared with a second deal and its cabinet: listed only.
-- ===========================================================================
SET request.jwt.claims TO :'p279_admin';
SET ROLE authenticated;
SELECT platform.staff_account_deletion_detail_v1(:'p279_bekzat_rid')::TEXT AS p279_bekzat_detail \gset
RESET ROLE;
SELECT pg_temp.p279_assert(
  pg_temp.p279_review_diff(:'p279_bekzat_detail'::JSONB, ARRAY[
    'client:' || pg_temp.p279_id(1631) || ':phone', 'lead:' || pg_temp.p279_id(1632) || ':phone',
    'client:' || :'p279_bekzat_client' || ':email,phone,shared', 'lead:' || pg_temp.p279_id(1660) || ':email,phone',
    'case:' || :'p279_bekzat_sibling_case' || ':shared']) = ''
  AND (:'p279_bekzat_detail'::JSONB #>> '{counts,anonymize,leads}')::INT = 1
  AND (:'p279_bekzat_detail'::JSONB #>> '{counts,anonymize,clients}')::INT = 0
  AND (:'p279_bekzat_detail'::JSONB #>> '{counts,anonymize,salesRecords}')::INT = 1
  AND :'p279_bekzat_detail'::JSONB -> 'amocrm' = '{"contactIds": [], "leadIds": ["1050"], "dispatchedCommands": 0}'::JSONB
  AND (SELECT (e ->> 'canErase')::BOOLEAN FROM jsonb_array_elements(:'p279_bekzat_detail'::JSONB -> 'review') e
    WHERE e ->> 'id' = :'p279_bekzat_sibling_case'),
  'Bekzat''s card is not the expected owned set and review list: '
    || pg_temp.p279_review_diff(:'p279_bekzat_detail'::JSONB, ARRAY[
    'client:' || pg_temp.p279_id(1631) || ':phone', 'lead:' || pg_temp.p279_id(1632) || ':phone',
    'client:' || :'p279_bekzat_client' || ':email,phone,shared', 'lead:' || pg_temp.p279_id(1660) || ':email,phone',
    'case:' || :'p279_bekzat_sibling_case' || ':shared']) || ' ' || (:'p279_bekzat_detail'::JSONB -> 'counts')::TEXT
);
-- Review a10c869b1 finding 3: Bekzat's sister accepted the invitation to the
-- second deal's cabinet (the server invite flow's receipt) and submitted her
-- анкета to it through the real path. The cabinet is hers now: listed as
-- shared with «есть аккаунт или анкета», no «Удалить», and the decision is
-- refused; her invitation, анкета and the cabinet stay as they are.
INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at)
VALUES (pg_temp.p279_id(115), 'p279-sister@example.invalid', '{}'::JSONB, statement_timestamp());
SET LOCAL session_replication_role = replica;
INSERT INTO platform_private.student_portal_provisioning_receipts (request_id, organization_id, student_case_id,
  normalized_email, student_display_name, case_shape, fingerprint_sha256, authorizing_auth_user_id,
  authorizing_profile_id, authorizing_membership_id, authorizing_access_version, required_permission_keys,
  provisioning_state, invite_delivery_status, auth_user_id, accepted_at, intake_flow)
VALUES (pg_temp.p279_id(1697), pg_temp.p279_id(1), :'p279_bekzat_sibling_case', 'p279-sister@example.invalid',
  'Сестра Бекзата', 'cabinet_pending', repeat('f', 64), pg_temp.p279_id(101), pg_temp.p279_id(201), pg_temp.p279_id(301),
  1, ARRAY['lead.sales.workflow.manage'], 'invite_succeeded', 'accepted', pg_temp.p279_id(115), statement_timestamp(),
  'anketa_v1');
SET LOCAL session_replication_role = origin;
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p279_id(115),
  'claims', jsonb_build_object('sub', pg_temp.p279_id(115), 'role', 'authenticated'))) -> 'claims')::TEXT AS p279_sister \gset
SET request.jwt.claims TO :'p279_sister';
SET ROLE authenticated;
SELECT (platform.submit_student_application_v1(pg_temp.p279_id(1698),
  pg_temp.p279_questionnaire(pg_temp.p279_id(1698), 'Айгерим', 'Сестрова', '+996 700 279 115'), 0) ->> 'id')::UUID
  AS p279_sister_app \gset
RESET ROLE;
SET request.jwt.claims TO :'p279_admin';
SET ROLE authenticated;
SELECT platform.staff_account_deletion_detail_v1(:'p279_bekzat_rid')::TEXT AS p279_bekzat_detail \gset
SELECT pg_temp.p279_error(format('SELECT platform.resolve_account_deletion_candidate_v1(%L, %L, %L, %L)',
  :'p279_bekzat_rid', 'case', :'p279_bekzat_sibling_case', 'erase')) AS p279_x_error \gset
RESET ROLE;
SELECT pg_temp.p279_assert(
  (SELECT a.status = 'pending' AND a.invited_case_id = :'p279_bekzat_sibling_case'::UUID
    FROM platform_private.student_applications a WHERE a.id = :'p279_sister_app')
  AND jsonb_array_length(:'p279_bekzat_detail'::JSONB -> 'review') = 5
  AND (SELECT (e -> 'facts' ->> 'hasAccount')::BOOLEAN AND NOT (e ->> 'canErase')::BOOLEAN
    FROM jsonb_array_elements(:'p279_bekzat_detail'::JSONB -> 'review') e WHERE e ->> 'id' = :'p279_bekzat_sibling_case')
  AND :'p279_x_error' = '55000 account_deletion_candidate_has_account',
  'a cabinet with another person''s accepted invitation and анкета can be erased from Bekzat''s list: '
    || :'p279_x_error' || ' ' || (:'p279_bekzat_detail'::JSONB -> 'review')::TEXT
);
SET ROLE authenticated;
SELECT count(platform.resolve_account_deletion_candidate_v1(:'p279_bekzat_rid', e ->> 'kind', (e ->> 'id')::UUID,
    'not_subject')) AS p279_kept
FROM jsonb_array_elements(:'p279_bekzat_detail'::JSONB -> 'review') e \gset
RESET ROLE;
SELECT pg_temp.p279_snapshot('bekzat', ARRAY[
  pg_temp.p279_id(105)::TEXT, :'p279_bekzat_app', :'p279_bekzat_lead', :'p279_bekzat_rid',
  pg_temp.p279_id(106)::TEXT, :'p279_bare_rid'],
  ARRAY[pg_temp.p279_id(105)::TEXT, pg_temp.p279_id(106)::TEXT,
  'email:' || encode(sha256(convert_to('p279-bekzat@example.invalid', 'UTF8')), 'hex'),
  'email:' || encode(sha256(convert_to('p279-bare@example.invalid', 'UTF8')), 'hex')]) > 0 AS p279_snap_ok \gset
SET ROLE authenticated;
SELECT platform.process_account_deletion_v1(:'p279_bekzat_rid')::TEXT AS p279_bekzat_processed \gset
SELECT platform.process_account_deletion_v1(:'p279_bare_rid')::TEXT AS p279_bare_processed \gset
RESET ROLE;
SELECT pg_temp.p279_assert(
  jsonb_array_length(:'p279_bekzat_processed'::JSONB -> 'storageObjects') = 0
  AND NOT EXISTS (SELECT 1 FROM platform_private.student_applications a WHERE a.id = :'p279_bekzat_app')
  AND (SELECT l.lifecycle_state = 'archived' FROM platform.leads l WHERE l.id = :'p279_bekzat_lead')
  AND (SELECT sr.fields ->> 'applicant_name' LIKE 'Удалённый пользователь · %' AND sr.fields ->> 'email' = ''
      AND sr.fields ->> 'contract_number' = 'EVO-1662'
    FROM platform_private.sales_register sr WHERE sr.id = pg_temp.p279_id(1662))
  AND (SELECT lc.fields ->> 'payment_note' = '' FROM platform_private.lead_sale_conditions lc
    WHERE lc.lead_id = :'p279_bekzat_lead')
  AND NOT EXISTS (SELECT 1 FROM platform.case_notes n WHERE n.id = pg_temp.p279_id(1661))
  AND EXISTS (SELECT 1 FROM platform_private.amocrm_lead_bindings b
    WHERE b.lead_id = :'p279_bekzat_lead' AND b.provider_lead_id = '1050')
  AND (:'p279_bekzat_processed'::JSONB ->> 'amocrmContacts')::INT = 1
  AND :'p279_kept'::INT = 5,
  'the applicant''s анкета and own lead were not erased, or the amoCRM deal is not counted: ' || :'p279_bekzat_processed'
);
DELETE FROM auth.users WHERE id IN (pg_temp.p279_id(105), pg_temp.p279_id(106));
SET ROLE authenticated;
SELECT pg_temp.p279_assert(
  pg_temp.p279_error(format('SELECT platform.complete_account_deletion_v1(%L, %L, FALSE)', :'p279_bekzat_rid',
    'not_configured')) = '55000 account_deletion_amocrm_unconfirmed'
  AND (platform.complete_account_deletion_v1(:'p279_bekzat_rid', 'not_configured', TRUE) ->> 'status') = 'completed'
  AND (platform.complete_account_deletion_v1(:'p279_bare_rid', 'no_address', FALSE) ->> 'status') = 'completed',
  'applicant requests did not complete'
);
RESET ROLE;
RESET request.jwt.claims;
-- (1) The father's client, lead and note, the shared client card, the second
-- deal and its cabinet with the sister's invitation and анкета: all exactly
-- as they were.
SELECT pg_temp.p279_assert(pg_temp.p279_changed('bekzat', :'p279_bekzat_self') = ''
    AND EXISTS (SELECT 1 FROM platform_private.student_portal_provisioning_receipts pr
      WHERE pr.request_id = pg_temp.p279_id(1697) AND pr.auth_user_id = pg_temp.p279_id(115))
    AND (SELECT sc.state = 'pending' AND sc.pipeline_hidden_at IS NULL AND sc.student_display_name NOT LIKE 'Удалённый%'
      FROM platform.student_cases sc WHERE sc.id = :'p279_bekzat_sibling_case'),
  'erasing Bekzat or Bare changed rows outside their owned sets: ' || pg_temp.p279_changed('bekzat', :'p279_bekzat_self'));
-- (2) Every row of their owned sets holds none of their values.
SELECT pg_temp.p279_assert(pg_temp.p279_owned_needles('bekzat',
    '(p279-bekzat@example\.invalid|p279-bare@example\.invalid|996 ?700 ?279 ?105|Бекзат|Анкетов)') = '',
  'rows of Bekzat''s or Bare''s owned sets still hold their values: ' || pg_temp.p279_owned_needles('bekzat',
    '(p279-bekzat@example\.invalid|p279-bare@example\.invalid|996 ?700 ?279 ?105|Бекзат|Анкетов)'));
-- (2) His values are left only in other people's rows and in the shared card
-- the Admin kept («Не этот человек»), all unchanged.
SELECT pg_temp.p279_assert(
  pg_temp.p279_needles_outside('bekzat',
    '(p279-bekzat@example\.invalid|p279-bare@example\.invalid|996 ?700 ?279 ?105|Бекзат|Анкетов)') = '',
  'personal values of the erased applicants are left in their own rows: '
    || pg_temp.p279_needles_outside('bekzat',
    '(p279-bekzat@example\.invalid|p279-bare@example\.invalid|996 ?700 ?279 ?105|Бекзат|Анкетов)')
);
SELECT pg_temp.p279_assert(
  (SELECT count(*) FROM platform.audit_events e WHERE e.organization_id = pg_temp.p279_id(1)
    AND e.action IN ('account.deletion.process', 'account.deletion.complete')) >= 6
  AND NOT EXISTS (SELECT 1 FROM platform_private.account_deletion_requests r
    WHERE r.status = 'completed' AND r.confirmation_email IS NOT NULL),
  'processing and completion are not journaled, or a completed request kept the address'
);

-- ===========================================================================
-- Review 9f0f9fa34 scenarios. Each now stays exactly as it was; those with
-- the subject's own number are listed for review, none is changed.
--  * Dilnaz (applicant, S1): her анкета phone is the family number her father
--    Marat writes from on WhatsApp; Sales renamed his chat's client «Марат
--    Отцов», wrote a note and sale conditions on his lead.
--  * Emil (student): the chat from his mobile_phone, whose lead Sales worked;
--    his whatsapp_telegram is also his father's mobile number in his own
--    profile, and the father writes from it.
--  * Erlan (applicant): a stranger's chat from his анкета phone; on his анкета
--    lead a CRM→amoCRM lead_create was sent and no answer came (status
--    unknown, no binding), and a contact update of his client carries the
--    amoCRM contact number (S4).
--  * Samat (student): his whatsapp_telegram is his father Bakyt's number,
--    which Sales wrote locally («0700 279 777») on Bakyt's manual client and
--    note, and Bakyt writes on WhatsApp from it (S2); his mobile_phone and
--    student_email are his aunt's, the payer in the sales register row, the
--    website and the manual receipts of his cousin Aibek (S3); his
--    passport_number is «Оформляется» and Aibek's note says his own passport
--    «оформляется» (S5); Samat's own анкета phone, written locally in another
--    note of Aibek's, is another person's record and stays.
-- ===========================================================================
INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at)
VALUES
  (pg_temp.p279_id(108), 'p279-dilnaz@example.invalid', '{}'::JSONB, statement_timestamp()),
  (pg_temp.p279_id(109), 'p279-samat@example.invalid', '{}'::JSONB, statement_timestamp()),
  (pg_temp.p279_id(110), 'p279-emil@example.invalid', '{}'::JSONB, statement_timestamp()),
  (pg_temp.p279_id(111), 'p279-erlan@example.invalid', '{}'::JSONB, statement_timestamp());
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p279_id(108),
  'claims', jsonb_build_object('sub', pg_temp.p279_id(108), 'role', 'authenticated'))) -> 'claims')::TEXT AS p279_dilnaz \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p279_id(109),
  'claims', jsonb_build_object('sub', pg_temp.p279_id(109), 'role', 'authenticated'))) -> 'claims')::TEXT AS p279_samat_pre \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p279_id(110),
  'claims', jsonb_build_object('sub', pg_temp.p279_id(110), 'role', 'authenticated'))) -> 'claims')::TEXT AS p279_emil_pre \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p279_id(111),
  'claims', jsonb_build_object('sub', pg_temp.p279_id(111), 'role', 'authenticated'))) -> 'claims')::TEXT AS p279_erlan \gset
SET request.jwt.claims TO :'p279_dilnaz';
SET ROLE authenticated;
SELECT (platform.submit_student_application_v1(pg_temp.p279_id(704),
  pg_temp.p279_questionnaire(pg_temp.p279_id(704), 'Дильназ', 'Дочерина', '+996 700 279 444'), 0) ->> 'id')::UUID AS p279_dilnaz_app \gset
RESET ROLE;
SET request.jwt.claims TO :'p279_samat_pre';
SET ROLE authenticated;
SELECT (platform.submit_student_application_v1(pg_temp.p279_id(705),
  pg_temp.p279_questionnaire(pg_temp.p279_id(705), 'Самат', 'Племянников', '+996 700 279 601'), 0) ->> 'id')::UUID AS p279_samat_app \gset
RESET ROLE;
SET request.jwt.claims TO :'p279_emil_pre';
SET ROLE authenticated;
SELECT (platform.submit_student_application_v1(pg_temp.p279_id(706),
  pg_temp.p279_questionnaire(pg_temp.p279_id(706), 'Эмиль', 'Сыновьев', '+996 700 279 701'), 0) ->> 'id')::UUID AS p279_emil_app \gset
RESET ROLE;
SET request.jwt.claims TO :'p279_erlan';
SET ROLE authenticated;
SELECT (platform.submit_student_application_v1(pg_temp.p279_id(707),
  pg_temp.p279_questionnaire(pg_temp.p279_id(707), 'Эрлан', 'Командов', '+996 700 279 555'), 0) ->> 'id')::UUID AS p279_erlan_app \gset
RESET ROLE;
SET request.jwt.claims TO :'p279_admin';
SET ROLE authenticated;
SELECT (platform.decide_student_application_v1(:'p279_samat_app', 1, 'approve', 'P279 одобрение', pg_temp.p279_id(713))
  ->> 'student_case_id')::UUID AS p279_samat_case \gset
SELECT (platform.decide_student_application_v1(:'p279_emil_app', 1, 'approve', 'P279 одобрение', pg_temp.p279_id(714))
  ->> 'student_case_id')::UUID AS p279_emil_case \gset
RESET ROLE;
RESET request.jwt.claims;
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p279_id(109),
  'claims', jsonb_build_object('sub', pg_temp.p279_id(109), 'role', 'authenticated'))) -> 'claims')::TEXT AS p279_samat \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p279_id(110),
  'claims', jsonb_build_object('sub', pg_temp.p279_id(110), 'role', 'authenticated'))) -> 'claims')::TEXT AS p279_emil \gset
SELECT a.canonical_lead_id AS p279_erlan_lead, l.client_id AS p279_erlan_client
FROM platform_private.student_applications a JOIN platform.leads l ON l.id = a.canonical_lead_id
WHERE a.id = :'p279_erlan_app' \gset

SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_profile_fields (organization_id, student_case_id, student_profile_id, field_key, value,
  review_state, profile_revision)
SELECT pg_temp.p279_id(1), sp.student_case_id, sp.id, f.k, f.v, 'needs_review', sp.revision
FROM platform.student_profiles sp
JOIN (VALUES
  (:'p279_samat_case'::UUID, 'mobile_phone', '+996700279600'),
  (:'p279_samat_case'::UUID, 'whatsapp_telegram', '+996 700 279 777'),
  (:'p279_samat_case'::UUID, 'student_email', 'samat.p279@example.invalid'),
  (:'p279_samat_case'::UUID, 'passport_number', 'Оформляется'),
  (:'p279_emil_case'::UUID, 'mobile_phone', '+996700279446'),
  (:'p279_emil_case'::UUID, 'whatsapp_telegram', '+996 700 279 447'),
  (:'p279_emil_case'::UUID, 'father_mobile_phone', '+996700279447')) AS f(c, k, v) ON f.c = sp.student_case_id
ON CONFLICT (organization_id, student_profile_id, field_key) DO UPDATE SET value = EXCLUDED.value;
SET LOCAL session_replication_role = origin;

INSERT INTO p279_wa_runs VALUES
  (7, pg_temp.p279_wa(7, jsonb_build_object('id', 'false_996700279444@c.us_P279' || lpad('7', 15, '0'),
    'timestamp', extract(epoch FROM statement_timestamp() - INTERVAL '24 minutes')::BIGINT,
    'from', '996700279444@c.us', 'fromMe', false, 'source', 'app',
    'body', 'Здравствуйте, я отец Арсена, хотим в Корею'))),
  (8, pg_temp.p279_wa(8, jsonb_build_object('id', 'false_996700279446@c.us_P279' || lpad('8', 15, '0'),
    'timestamp', extract(epoch FROM statement_timestamp() - INTERVAL '23 minutes')::BIGINT,
    'from', '996700279446@c.us', 'fromMe', false, 'source', 'app',
    'body', 'Добрый день, интересует Корея'))),
  (9, pg_temp.p279_wa(9, jsonb_build_object('id', 'false_996700279447@c.us_P279' || lpad('9', 15, '0'),
    'timestamp', extract(epoch FROM statement_timestamp() - INTERVAL '22 minutes')::BIGINT,
    'from', '996700279447@c.us', 'fromMe', false, 'source', 'app',
    'body', 'Это папа Эмиля, перезвоните'))),
  (10, pg_temp.p279_wa(10, jsonb_build_object('id', 'false_996700279555@c.us_P279' || lpad('10', 15, '0'),
    'timestamp', extract(epoch FROM statement_timestamp() - INTERVAL '21 minutes')::BIGINT,
    'from', '996700279555@c.us', 'fromMe', false, 'source', 'app',
    'body', 'Здравствуйте, сколько стоит Китай?'))),
  (11, pg_temp.p279_wa(11, jsonb_build_object('id', 'false_996700279777@c.us_P279' || lpad('11', 15, '0'),
    'timestamp', extract(epoch FROM statement_timestamp() - INTERVAL '20 minutes')::BIGINT,
    'from', '996700279777@c.us', 'fromMe', false, 'source', 'app',
    'body', 'Это Бакыт, звоните после шести')));
RESET request.jwt.claims;
SELECT pg_temp.p279_assert((SELECT count(*) = 5 AND bool_and(result ->> 'disposition' = 'succeeded') FROM p279_wa_runs
    WHERE n BETWEEN 7 AND 11),
  'the review 9f0f9fa34 WhatsApp messages did not project through the real chain: '
    || (SELECT string_agg(result::TEXT, ' ') FROM p279_wa_runs WHERE n BETWEEN 7 AND 11));
CREATE TEMP TABLE p279_chats AS
SELECT split_part(b.normalized_chat_id, '@', 1) AS number, c.id AS conv, c.canonical_client_id AS client,
  c.canonical_lead_id AS lead
FROM platform_private.waha_direct_chat_bindings b
JOIN platform.communication_conversations c ON c.id = b.conversation_id
WHERE b.organization_id = pg_temp.p279_id(1)
  AND b.normalized_chat_id IN ('996700279444@c.us', '996700279446@c.us', '996700279447@c.us',
    '996700279555@c.us', '996700279777@c.us');
SELECT pg_temp.p279_assert((SELECT count(*) = 5 AND bool_and(client IS NOT NULL AND lead IS NOT NULL) FROM p279_chats),
  'fixture: the five chats of review 9f0f9fa34 have no client and lead of the chain');
SELECT conv AS p279_marat_conv, client AS p279_marat_client, lead AS p279_marat_lead
FROM p279_chats WHERE number = '996700279444' \gset
SELECT conv AS p279_emil_conv, client AS p279_emil_conv_client, lead AS p279_emil_conv_lead
FROM p279_chats WHERE number = '996700279446' \gset

SET LOCAL session_replication_role = replica;
-- S1: Sales renamed Marat's client and worked his lead.
UPDATE platform.clients SET display_name = 'Марат Отцов',
  normalized_name = platform_private.normalize_person_name('Марат Отцов')
WHERE id = :'p279_marat_client';
INSERT INTO platform.case_notes (id, organization_id, lead_id, student_case_id, body, created_by_membership_id)
VALUES
  (pg_temp.p279_id(2001), pg_temp.p279_id(1), :'p279_marat_lead', NULL, 'сын Арсен, 11 класс, Корея 2027',
   pg_temp.p279_id(302)),
  (pg_temp.p279_id(2002), pg_temp.p279_id(1), :'p279_emil_conv_lead', NULL, 'Звонить вечером, интересуется Кореей',
   pg_temp.p279_id(302));
INSERT INTO platform_private.lead_sale_conditions (lead_id, organization_id, fields, revision, updated_by_membership_id)
VALUES
  (:'p279_marat_lead', pg_temp.p279_id(1), jsonb_build_object('service_cost_minor', 250000,
    'service_label', 'Поступление в Корею', 'payment_note', 'Платит Марат сам'), 1, pg_temp.p279_id(302)),
  (:'p279_emil_conv_lead', pg_temp.p279_id(1), jsonb_build_object('service_cost_minor', 250000,
    'service_label', 'Поступление в Корею', 'payment_note', 'Оплата частями'), 1, pg_temp.p279_id(302));
-- S2: Bakyt, Samat's father, a manual client in the local format.
INSERT INTO platform.clients (id, organization_id, display_name, normalized_name, phone, normalized_phone)
VALUES (pg_temp.p279_id(2011), pg_temp.p279_id(1), 'Бакыт Отец', platform_private.normalize_person_name('Бакыт Отец'),
  '0700 279 777', '0700279777');
INSERT INTO platform.leads (id, organization_id, client_id, current_owner_membership_id, stage_key, source_key,
  interest_direction)
VALUES (pg_temp.p279_id(2012), pg_temp.p279_id(1), pg_temp.p279_id(2011), pg_temp.p279_id(302), 'new', 'manual', 'CN');
INSERT INTO platform.case_notes (id, organization_id, lead_id, student_case_id, body, created_by_membership_id)
VALUES (pg_temp.p279_id(2013), pg_temp.p279_id(1), pg_temp.p279_id(2012), NULL,
  'Бакыт, WhatsApp +996 700 279 777, звонить после 18:00', pg_temp.p279_id(302));
-- S3 and S5: Aibek, Samat's cousin; the payer is their aunt.
INSERT INTO platform.clients (id, organization_id, display_name, normalized_name, phone, normalized_phone)
VALUES (pg_temp.p279_id(2021), pg_temp.p279_id(1), 'Айбек Двоюродный',
  platform_private.normalize_person_name('Айбек Двоюродный'), '+996 700 279 650', '+996700279650');
INSERT INTO platform.leads (id, organization_id, client_id, current_owner_membership_id, stage_key, source_key,
  interest_direction)
VALUES (pg_temp.p279_id(2022), pg_temp.p279_id(1), pg_temp.p279_id(2021), pg_temp.p279_id(302), 'new', 'manual', 'CN');
INSERT INTO platform_private.sales_register (id, organization_id, version, report_month, owner_membership_id,
  source_kind, lead_id, client_id, fields, source_snapshot, paid_contract_minor, paid_contract_currency)
VALUES (pg_temp.p279_id(2023), pg_temp.p279_id(1), 1, date_trunc('month', statement_timestamp())::DATE,
  pg_temp.p279_id(302), 'pipeline', pg_temp.p279_id(2022), pg_temp.p279_id(2021),
  jsonb_build_object('applicant_name', 'Айбек Двоюродный', 'phone', '+996700279600',
    'email', 'samat.p279@example.invalid', 'notes', 'Платит тётя', 'contract_number', 'EVO-2023',
    'paid_minor', 120000, 'paid_currency', 'USD'),
  jsonb_build_object('applicant_name', 'Айбек Двоюродный', 'phone', '+996700279600'), 120000, 'USD');
INSERT INTO platform_private.manual_lead_receipts (request_id, organization_id, actor_membership_id, payload, lead_id)
VALUES (pg_temp.p279_id(2024), pg_temp.p279_id(1), pg_temp.p279_id(302),
  jsonb_build_object('name', 'Айбек Двоюродный', 'phone', '+996 700 279 600', 'email', 'samat.p279@example.invalid'),
  pg_temp.p279_id(2022));
INSERT INTO platform_private.website_lead_receipts (request_id, organization_id, lead_id, payload)
VALUES (pg_temp.p279_id(2025), pg_temp.p279_id(1), pg_temp.p279_id(2022),
  jsonb_build_object('name', 'Айбек', 'phone', '+996700279600', 'age', 17, 'city', 'Бишкек', 'country', 'KR'));
INSERT INTO platform.case_notes (id, organization_id, lead_id, student_case_id, body, created_by_membership_id)
VALUES
  (pg_temp.p279_id(2026), pg_temp.p279_id(1), pg_temp.p279_id(2022), NULL, 'Паспорт Айбека оформляется, будет в мае',
   pg_temp.p279_id(302)),
  (pg_temp.p279_id(2027), pg_temp.p279_id(1), pg_temp.p279_id(2022), NULL, 'Двоюродный брат Самат: 0700 279 601',
   pg_temp.p279_id(302));
-- Finding 4: CRM→amoCRM commands on Erlan's анкета lead and client, no binding.
INSERT INTO platform_private.amocrm_command_receipts (id, organization_id, request_id, idempotency_key,
  actor_profile_id, actor_membership_id, actor_auth_user_id, actor_role, workflow_scope, workflow_lead_id,
  person_id, lead_id, operation_name, target_contact_id, payload)
VALUES
  (pg_temp.p279_id(2031), pg_temp.p279_id(1), pg_temp.p279_id(2041), 'p279-erlan-lead-create', pg_temp.p279_id(201),
   pg_temp.p279_id(301), pg_temp.p279_id(101), 'admin', 'sales_pre_handoff', :'p279_erlan_lead', NULL,
   :'p279_erlan_lead', 'lead_create', NULL,
   jsonb_build_object('name', 'Эрлан Командов', 'phone', '+996 700 279 555')),
  (pg_temp.p279_id(2033), pg_temp.p279_id(1), pg_temp.p279_id(2043), 'p279-erlan-contact-update', pg_temp.p279_id(201),
   pg_temp.p279_id(301), pg_temp.p279_id(101), 'admin', 'sales_pre_handoff', :'p279_erlan_lead', :'p279_erlan_client',
   NULL, 'contact_update', '5551', jsonb_build_object('name', 'Эрлан Командов'));
INSERT INTO platform_private.amocrm_command_attempts (id, organization_id, command_receipt_id, idempotency_key,
  actor_role, workflow_scope, workflow_lead_id, person_id, lead_id, operation_name, target_contact_id, payload, status,
  dispatch_request_id, dispatch_request_sha256, dispatch_worker_ref, dispatch_claimed_at, dispatch_lease_expires_at,
  provider_dispatched_at, result_contact_id)
VALUES
  (pg_temp.p279_id(2032), pg_temp.p279_id(1), pg_temp.p279_id(2031), 'p279-erlan-lead-create', 'admin',
   'sales_pre_handoff', :'p279_erlan_lead', NULL, :'p279_erlan_lead', 'lead_create', NULL,
   jsonb_build_object('name', 'Эрлан Командов', 'phone', '+996 700 279 555'), 'unknown',
   pg_temp.p279_id(2042), repeat('e', 64), 'p279-worker', statement_timestamp() - INTERVAL '1 hour',
   statement_timestamp() - INTERVAL '50 minutes', statement_timestamp() - INTERVAL '1 hour', NULL),
  (pg_temp.p279_id(2034), pg_temp.p279_id(1), pg_temp.p279_id(2033), 'p279-erlan-contact-update', 'admin',
   'sales_pre_handoff', :'p279_erlan_lead', :'p279_erlan_client', NULL, 'contact_update', '5551',
   jsonb_build_object('name', 'Эрлан Командов'), 'accepted',
   pg_temp.p279_id(2044), repeat('f', 64), 'p279-worker', statement_timestamp() - INTERVAL '2 hours',
   statement_timestamp() - INTERVAL '110 minutes', statement_timestamp() - INTERVAL '2 hours', '5551');
SET LOCAL session_replication_role = origin;

-- Requests, the Admin's card and processing.
SET request.jwt.claims TO :'p279_dilnaz';
SET ROLE authenticated;
SELECT platform.request_account_deletion_v2(pg_temp.p279_id(1007)) ->> 'status' AS p279_x_status \gset
RESET ROLE;
SET request.jwt.claims TO :'p279_samat';
SET ROLE authenticated;
SELECT platform.request_account_deletion_v2(pg_temp.p279_id(1008)) ->> 'status' AS p279_x_status \gset
RESET ROLE;
SET request.jwt.claims TO :'p279_emil';
SET ROLE authenticated;
SELECT platform.request_account_deletion_v2(pg_temp.p279_id(1009)) ->> 'status' AS p279_x_status \gset
RESET ROLE;
SET request.jwt.claims TO :'p279_erlan';
SET ROLE authenticated;
SELECT platform.request_account_deletion_v2(pg_temp.p279_id(1010)) ->> 'status' AS p279_x_status \gset
RESET ROLE;
SELECT r.id AS p279_dilnaz_rid FROM platform_private.account_deletion_requests r
WHERE r.subject_auth_user_id = pg_temp.p279_id(108) \gset
SELECT r.id AS p279_samat_rid FROM platform_private.account_deletion_requests r
WHERE r.subject_auth_user_id = pg_temp.p279_id(109) \gset
SELECT r.id AS p279_emil_rid FROM platform_private.account_deletion_requests r
WHERE r.subject_auth_user_id = pg_temp.p279_id(110) \gset
SELECT r.id AS p279_erlan_rid FROM platform_private.account_deletion_requests r
WHERE r.subject_auth_user_id = pg_temp.p279_id(111) \gset

SELECT conv AS p279_bakyt_conv, client AS p279_bakyt_wa_client, lead AS p279_bakyt_wa_lead
FROM p279_chats WHERE number = '996700279777' \gset
SELECT conv AS p279_emil_father_conv, client AS p279_emil_father_client, lead AS p279_emil_father_lead
FROM p279_chats WHERE number = '996700279447' \gset
SELECT conv AS p279_stranger_conv, client AS p279_stranger_client, lead AS p279_stranger_lead
FROM p279_chats WHERE number = '996700279555' \gset
SELECT a.canonical_lead_id AS p279_dilnaz_lead, l.client_id AS p279_dilnaz_client
FROM platform_private.student_applications a JOIN platform.leads l ON l.id = a.canonical_lead_id
WHERE a.id = :'p279_dilnaz_app' \gset
SELECT a.canonical_lead_id AS p279_samat_lead, l.client_id AS p279_samat_client
FROM platform_private.student_applications a JOIN platform.leads l ON l.id = a.canonical_lead_id
WHERE a.id = :'p279_samat_app' \gset
SELECT a.canonical_lead_id AS p279_emil_lead, l.client_id AS p279_emil_client
FROM platform_private.student_applications a JOIN platform.leads l ON l.id = a.canonical_lead_id
WHERE a.id = :'p279_emil_app' \gset

SET request.jwt.claims TO :'p279_admin';
SET ROLE authenticated;
SELECT platform.staff_account_deletion_detail_v1(:'p279_dilnaz_rid')::TEXT AS p279_dilnaz_detail \gset
SELECT platform.staff_account_deletion_detail_v1(:'p279_samat_rid')::TEXT AS p279_samat_detail \gset
SELECT platform.staff_account_deletion_detail_v1(:'p279_emil_rid')::TEXT AS p279_emil_detail \gset
SELECT platform.staff_account_deletion_detail_v1(:'p279_erlan_rid')::TEXT AS p279_erlan_detail \gset
RESET ROLE;
-- (3) S1: the father's chat, client and lead are listed by the анкета phone.
SELECT pg_temp.p279_assert(
  pg_temp.p279_review_diff(:'p279_dilnaz_detail'::JSONB, ARRAY['chat:' || :'p279_marat_conv' || ':phone',
    'client:' || :'p279_marat_client' || ':phone', 'lead:' || :'p279_marat_lead' || ':phone']) = ''
  AND (:'p279_dilnaz_detail'::JSONB #>> '{counts,delete,whatsappChats}')::INT = 0,
  'S1: Dilnaz''s review list: ' || pg_temp.p279_review_diff(:'p279_dilnaz_detail'::JSONB, ARRAY[
    'chat:' || :'p279_marat_conv' || ':phone', 'client:' || :'p279_marat_client' || ':phone',
    'lead:' || :'p279_marat_lead' || ':phone'])
);
-- (3) S2: Bakyt's manual client in the local format is the same number.
SELECT pg_temp.p279_assert(
  pg_temp.p279_review_diff(:'p279_samat_detail'::JSONB, ARRAY[
    'client:' || pg_temp.p279_id(2011) || ':phone', 'lead:' || pg_temp.p279_id(2012) || ':phone',
    'chat:' || :'p279_bakyt_conv' || ':phone', 'client:' || :'p279_bakyt_wa_client' || ':phone',
    'lead:' || :'p279_bakyt_wa_lead' || ':phone']) = '',
  'S2: Samat''s review list: ' || pg_temp.p279_review_diff(:'p279_samat_detail'::JSONB, ARRAY[
    'client:' || pg_temp.p279_id(2011) || ':phone', 'lead:' || pg_temp.p279_id(2012) || ':phone',
    'chat:' || :'p279_bakyt_conv' || ':phone', 'client:' || :'p279_bakyt_wa_client' || ':phone',
    'lead:' || :'p279_bakyt_wa_lead' || ':phone'])
);
-- (3) The chat of a lead Sales worked, and the father's number in the profile.
SELECT pg_temp.p279_assert(
  pg_temp.p279_review_diff(:'p279_emil_detail'::JSONB, ARRAY[
    'chat:' || :'p279_emil_conv' || ':phone', 'client:' || :'p279_emil_conv_client' || ':phone',
    'lead:' || :'p279_emil_conv_lead' || ':phone', 'chat:' || :'p279_emil_father_conv' || ':phone',
    'client:' || :'p279_emil_father_client' || ':phone', 'lead:' || :'p279_emil_father_lead' || ':phone']) = '',
  'Emil''s review list: ' || pg_temp.p279_review_diff(:'p279_emil_detail'::JSONB, ARRAY[
    'chat:' || :'p279_emil_conv' || ':phone', 'client:' || :'p279_emil_conv_client' || ':phone',
    'lead:' || :'p279_emil_conv_lead' || ':phone', 'chat:' || :'p279_emil_father_conv' || ':phone',
    'client:' || :'p279_emil_father_client' || ':phone', 'lead:' || :'p279_emil_father_lead' || ':phone'])
);
-- (3) A stranger's chat from the анкета phone; (5) S4: the sent command
-- without an answer and the contact number of a command are amoCRM links.
SELECT pg_temp.p279_assert(
  pg_temp.p279_review_diff(:'p279_erlan_detail'::JSONB, ARRAY[
    'chat:' || :'p279_stranger_conv' || ':phone', 'client:' || :'p279_stranger_client' || ':phone',
    'lead:' || :'p279_stranger_lead' || ':phone']) = ''
  AND (:'p279_erlan_detail'::JSONB ->> 'amocrmContacts')::INT = 2
  AND :'p279_erlan_detail'::JSONB -> 'amocrm' = '{"contactIds": ["5551"], "leadIds": [], "dispatchedCommands": 1}'::JSONB,
  'Erlan''s review list or amoCRM links: ' || pg_temp.p279_review_diff(:'p279_erlan_detail'::JSONB, ARRAY[
    'chat:' || :'p279_stranger_conv' || ':phone', 'client:' || :'p279_stranger_client' || ':phone',
    'lead:' || :'p279_stranger_lead' || ':phone']) || ' ' || (:'p279_erlan_detail'::JSONB -> 'amocrm')::TEXT
);
SET ROLE authenticated;
SELECT count(platform.resolve_account_deletion_candidate_v1(q.rid, e ->> 'kind', (e ->> 'id')::UUID, 'not_subject'))
  AS p279_kept
FROM (VALUES (:'p279_dilnaz_rid'::UUID, :'p279_dilnaz_detail'::JSONB), (:'p279_samat_rid'::UUID, :'p279_samat_detail'::JSONB),
  (:'p279_emil_rid'::UUID, :'p279_emil_detail'::JSONB), (:'p279_erlan_rid'::UUID, :'p279_erlan_detail'::JSONB)) AS q(rid, d),
  jsonb_array_elements(q.d -> 'review') e \gset
RESET ROLE;
SELECT pg_temp.p279_snapshot('x', ARRAY[
  pg_temp.p279_id(108)::TEXT, pg_temp.p279_id(109)::TEXT, pg_temp.p279_id(110)::TEXT, pg_temp.p279_id(111)::TEXT,
  :'p279_dilnaz_app', :'p279_samat_app', :'p279_emil_app', :'p279_erlan_app',
  :'p279_dilnaz_rid', :'p279_samat_rid', :'p279_emil_rid', :'p279_erlan_rid',
  :'p279_samat_case', :'p279_emil_case', (SELECT sc.student_membership_id::TEXT FROM platform.student_cases sc
    WHERE sc.id = :'p279_samat_case'), (SELECT sc.student_membership_id::TEXT FROM platform.student_cases sc
    WHERE sc.id = :'p279_emil_case'),
  (SELECT m.profile_id::TEXT FROM platform.student_cases sc JOIN platform.organization_memberships m
    ON m.id = sc.student_membership_id WHERE sc.id = :'p279_samat_case'),
  (SELECT m.profile_id::TEXT FROM platform.student_cases sc JOIN platform.organization_memberships m
    ON m.id = sc.student_membership_id WHERE sc.id = :'p279_emil_case'),
  :'p279_dilnaz_lead', :'p279_samat_lead', :'p279_emil_lead', :'p279_erlan_lead',
  :'p279_dilnaz_client', :'p279_samat_client', :'p279_emil_client', :'p279_erlan_client'],
  ARRAY[pg_temp.p279_id(108)::TEXT, pg_temp.p279_id(109)::TEXT, pg_temp.p279_id(110)::TEXT, pg_temp.p279_id(111)::TEXT,
  'email:' || encode(sha256(convert_to('p279-dilnaz@example.invalid', 'UTF8')), 'hex'),
  'email:' || encode(sha256(convert_to('p279-samat@example.invalid', 'UTF8')), 'hex'),
  'email:' || encode(sha256(convert_to('p279-emil@example.invalid', 'UTF8')), 'hex'),
  'email:' || encode(sha256(convert_to('p279-erlan@example.invalid', 'UTF8')), 'hex')]) > 0 AS p279_snap_ok \gset
SET ROLE authenticated;
SELECT platform.process_account_deletion_v1(:'p279_dilnaz_rid')::TEXT AS p279_dilnaz_processed \gset
SELECT platform.process_account_deletion_v1(:'p279_samat_rid')::TEXT AS p279_samat_processed \gset
SELECT platform.process_account_deletion_v1(:'p279_emil_rid')::TEXT AS p279_emil_processed \gset
SELECT platform.process_account_deletion_v1(:'p279_erlan_rid')::TEXT AS p279_erlan_processed \gset
RESET ROLE;
DELETE FROM auth.users WHERE id IN (pg_temp.p279_id(108), pg_temp.p279_id(109), pg_temp.p279_id(110), pg_temp.p279_id(111));
SET ROLE authenticated;
SELECT pg_temp.p279_assert(
  :'p279_kept'::INT = 17
  AND (:'p279_erlan_processed'::JSONB ->> 'amocrmContacts')::INT = 2
  AND pg_temp.p279_error(format('SELECT platform.complete_account_deletion_v1(%L, %L, FALSE)', :'p279_erlan_rid', 'sent'))
    = '55000 account_deletion_amocrm_unconfirmed'
  AND (platform.complete_account_deletion_v1(:'p279_erlan_rid', 'sent', TRUE) ->> 'status') = 'completed'
  AND (platform.complete_account_deletion_v1(:'p279_dilnaz_rid', 'sent', FALSE) ->> 'status') = 'completed'
  AND (platform.complete_account_deletion_v1(:'p279_samat_rid', 'sent', FALSE) ->> 'status') = 'completed'
  AND (platform.complete_account_deletion_v1(:'p279_emil_rid', 'sent', FALSE) ->> 'status') = 'completed',
  'the review 9f0f9fa34 requests did not complete as expected'
);
RESET ROLE;
RESET request.jwt.claims;
-- (1) S1, S2, S3, S5, the worked lead, the father's and the stranger's chats,
-- Aibek's note with Samat's own number: nothing changed.
SELECT pg_temp.p279_assert(pg_temp.p279_changed('x', :'p279_x_self') = '',
  'the review 9f0f9fa34 subjects changed rows outside their owned sets: ' || pg_temp.p279_changed('x', :'p279_x_self'));
SELECT pg_temp.p279_assert(
  (SELECT n.body FROM platform.case_notes n WHERE n.id = pg_temp.p279_id(2027)) = 'Двоюродный брат Самат: 0700 279 601'
  AND (SELECT n.body FROM platform.case_notes n WHERE n.id = pg_temp.p279_id(2026)) = 'Паспорт Айбека оформляется, будет в мае'
  AND (SELECT n.body FROM platform.case_notes n WHERE n.id = pg_temp.p279_id(2013))
    = 'Бакыт, WhatsApp +996 700 279 777, звонить после 18:00',
  'another person''s note that mentions a subject was changed'
);
-- (2)
SELECT pg_temp.p279_assert(
  pg_temp.p279_needles_outside('x',
    '(p279-(dilnaz|samat|emil|erlan)@example\.invalid|samat\.p279@|Дильназ|Дочерина|Самат|Племянников|Эмиль|Сыновьев|Эрлан|Командов|Оформляется)') = '',
  'personal values of the review 9f0f9fa34 subjects are left in their own rows: '
    || pg_temp.p279_needles_outside('x',
    '(p279-(dilnaz|samat|emil|erlan)@example\.invalid|samat\.p279@|Дильназ|Дочерина|Самат|Племянников|Эмиль|Сыновьев|Эрлан|Командов|Оформляется)')
);

-- ===========================================================================
-- Review ab265b795 scenarios.
--  * B, Madina (student): her mother writes from her own number; the
--    lead-agent linked the chat to amoCRM (provider_linked) and Sales bound
--    it to Madina's case. The chat is bound to her and to her mother's
--    client: listed as «linked», with its amoCRM numbers; once the Admin
--    erases it, completion needs the amoCRM confirmation.
--  * L2/L3, Leyla (student): her only chats came as `<lid>@lid` with
--    SenderAlt = her number and her WhatsApp name, and then as
--    `<number>@c.us`; both chats, their client and lead are listed by her
--    number and erased item by item.
--  * C, Daniyar (student, +7): his whatsapp_telegram is his father's number;
--    the father is a manual client written «8 701 279 2791» and writes on
--    WhatsApp from 77012792791; another person's note has Daniyar's own
--    number «8 701 279 2790». The father's records are listed by the one
--    key, none is changed; Daniyar's own kept sale conditions lose his number
--    in the 8… form. Timur's profile carries Daniyar's passport number: that
--    case is listed, and as it has its own student account it cannot be
--    erased from here.
-- ===========================================================================
INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at)
VALUES
  (pg_temp.p279_id(112), 'p279-madina@example.invalid', '{}'::JSONB, statement_timestamp()),
  (pg_temp.p279_id(113), 'p279-leyla@example.invalid', '{}'::JSONB, statement_timestamp()),
  (pg_temp.p279_id(114), 'p279-daniyar@example.invalid', '{}'::JSONB, statement_timestamp());
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p279_id(112),
  'claims', jsonb_build_object('sub', pg_temp.p279_id(112), 'role', 'authenticated'))) -> 'claims')::TEXT AS p279_madina_pre \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p279_id(113),
  'claims', jsonb_build_object('sub', pg_temp.p279_id(113), 'role', 'authenticated'))) -> 'claims')::TEXT AS p279_leyla_pre \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p279_id(114),
  'claims', jsonb_build_object('sub', pg_temp.p279_id(114), 'role', 'authenticated'))) -> 'claims')::TEXT AS p279_daniyar_pre \gset
SET request.jwt.claims TO :'p279_madina_pre';
SET ROLE authenticated;
SELECT (platform.submit_student_application_v1(pg_temp.p279_id(708),
  pg_temp.p279_questionnaire(pg_temp.p279_id(708), 'Мадина', 'Мамина', '+996 700 279 910'), 0) ->> 'id')::UUID AS p279_madina_app \gset
RESET ROLE;
SET request.jwt.claims TO :'p279_leyla_pre';
SET ROLE authenticated;
SELECT (platform.submit_student_application_v1(pg_temp.p279_id(709),
  pg_temp.p279_questionnaire(pg_temp.p279_id(709), 'Лейла', 'Лидова', '+996 700 279 901'), 0) ->> 'id')::UUID AS p279_leyla_app \gset
RESET ROLE;
SET request.jwt.claims TO :'p279_daniyar_pre';
SET ROLE authenticated;
SELECT (platform.submit_student_application_v1(pg_temp.p279_id(710),
  pg_temp.p279_questionnaire(pg_temp.p279_id(710), 'Данияр', 'Казахов', '+7 701 279 2790'), 0) ->> 'id')::UUID AS p279_daniyar_app \gset
RESET ROLE;
SET request.jwt.claims TO :'p279_admin';
SET ROLE authenticated;
SELECT (platform.decide_student_application_v1(:'p279_madina_app', 1, 'approve', 'P279 одобрение', pg_temp.p279_id(715))
  ->> 'student_case_id')::UUID AS p279_madina_case \gset
SELECT (platform.decide_student_application_v1(:'p279_leyla_app', 1, 'approve', 'P279 одобрение', pg_temp.p279_id(716))
  ->> 'student_case_id')::UUID AS p279_leyla_case \gset
SELECT (platform.decide_student_application_v1(:'p279_daniyar_app', 1, 'approve', 'P279 одобрение', pg_temp.p279_id(717))
  ->> 'student_case_id')::UUID AS p279_daniyar_case \gset
RESET ROLE;
RESET request.jwt.claims;
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p279_id(112),
  'claims', jsonb_build_object('sub', pg_temp.p279_id(112), 'role', 'authenticated'))) -> 'claims')::TEXT AS p279_madina \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p279_id(113),
  'claims', jsonb_build_object('sub', pg_temp.p279_id(113), 'role', 'authenticated'))) -> 'claims')::TEXT AS p279_leyla \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p279_id(114),
  'claims', jsonb_build_object('sub', pg_temp.p279_id(114), 'role', 'authenticated'))) -> 'claims')::TEXT AS p279_daniyar \gset
SELECT sc.canonical_lead_id AS p279_madina_lead, l.client_id AS p279_madina_client
FROM platform.student_cases sc JOIN platform.leads l ON l.id = sc.canonical_lead_id WHERE sc.id = :'p279_madina_case' \gset
SELECT sc.canonical_lead_id AS p279_leyla_lead, l.client_id AS p279_leyla_client
FROM platform.student_cases sc JOIN platform.leads l ON l.id = sc.canonical_lead_id WHERE sc.id = :'p279_leyla_case' \gset
SELECT sc.canonical_lead_id AS p279_daniyar_lead, l.client_id AS p279_daniyar_client
FROM platform.student_cases sc JOIN platform.leads l ON l.id = sc.canonical_lead_id WHERE sc.id = :'p279_daniyar_case' \gset

SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_profile_fields (organization_id, student_case_id, student_profile_id, field_key, value,
  review_state, profile_revision)
SELECT pg_temp.p279_id(1), sp.student_case_id, sp.id, f.k, f.v, 'needs_review', sp.revision
FROM platform.student_profiles sp
JOIN (VALUES
  (:'p279_leyla_case'::UUID, 'mobile_phone', '+996 700 279 901'),
  (:'p279_daniyar_case'::UUID, 'mobile_phone', '+7 701 279 2790'),
  (:'p279_daniyar_case'::UUID, 'whatsapp_telegram', '+7 701 279 2791'),
  (:'p279_daniyar_case'::UUID, 'passport_number', 'N2792790'),
  (:'p279_timur_case'::UUID, 'passport_number', 'N2792790')) AS f(c, k, v) ON f.c = sp.student_case_id
ON CONFLICT (organization_id, student_profile_id, field_key) DO UPDATE SET value = EXCLUDED.value;
-- C: the father, a manual client in the 8… form, with a lead and a note;
-- Daniyar's own sale conditions name his number in the 8… form; another
-- person's note names it too.
INSERT INTO platform.clients (id, organization_id, display_name, normalized_name, phone, normalized_phone)
VALUES (pg_temp.p279_id(2101), pg_temp.p279_id(1), 'Ерлан Отец', platform_private.normalize_person_name('Ерлан Отец'),
  '8 701 279 2791', '87012792791');
INSERT INTO platform.leads (id, organization_id, client_id, current_owner_membership_id, stage_key, source_key,
  interest_direction)
VALUES (pg_temp.p279_id(2102), pg_temp.p279_id(1), pg_temp.p279_id(2101), pg_temp.p279_id(302), 'new', 'manual', 'CN');
INSERT INTO platform.case_notes (id, organization_id, lead_id, student_case_id, body, created_by_membership_id)
VALUES
  (pg_temp.p279_id(2103), pg_temp.p279_id(1), pg_temp.p279_id(2102), NULL,
   'Ерлан, WhatsApp +7 701 279 2791, звонить утром', pg_temp.p279_id(302)),
  (pg_temp.p279_id(2104), pg_temp.p279_id(1), pg_temp.p279_id(2022), NULL,
   'Одноклассник Данияр: 8 701 279 2790', pg_temp.p279_id(302));
INSERT INTO platform_private.lead_sale_conditions (lead_id, organization_id, fields, revision, updated_by_membership_id)
VALUES (:'p279_daniyar_lead', pg_temp.p279_id(1), jsonb_build_object('service_cost_minor', 220000,
  'service_label', 'Поступление, связь 8 701 279 2790'), 1, pg_temp.p279_id(302));
SET LOCAL session_replication_role = origin;

INSERT INTO p279_wa_runs VALUES
  -- B: the mother's own number.
  (13, pg_temp.p279_wa(13, jsonb_build_object('id', 'false_996700279911@c.us_P279' || lpad('13', 15, '0'),
    'timestamp', extract(epoch FROM statement_timestamp() - INTERVAL '18 minutes')::BIGINT,
    'from', '996700279911@c.us', 'fromMe', false, 'source', 'app',
    'body', 'Здравствуйте, я мама Мадины'))),
  -- L2: Leyla by LID, her number only in SenderAlt, her WhatsApp name.
  (14, pg_temp.p279_wa(14, jsonb_build_object('id', 'false_555000279901001@lid_P279' || lpad('14', 15, '0'),
    'timestamp', extract(epoch FROM statement_timestamp() - INTERVAL '17 minutes')::BIGINT,
    'from', '555000279901001@lid', 'fromMe', false, 'source', 'app',
    'body', 'Здравствуйте, я Лейла Лидова, +996 700 279 901',
    '_data', jsonb_build_object('Info', jsonb_build_object('SenderAlt', '996700279901@s.whatsapp.net',
      'PushName', 'Лейла', 'Chat', '555000279901001@lid'))))),
  -- L3: then the same person by her phone chat.
  (15, pg_temp.p279_wa(15, jsonb_build_object('id', 'false_996700279901@c.us_P279' || lpad('15', 15, '0'),
    'timestamp', extract(epoch FROM statement_timestamp() - INTERVAL '16 minutes')::BIGINT,
    'from', '996700279901@c.us', 'fromMe', false, 'source', 'app',
    'body', 'Это снова Лейла'))),
  -- C: the father from 77012792791.
  (16, pg_temp.p279_wa(16, jsonb_build_object('id', 'false_77012792791@c.us_P279' || lpad('16', 15, '0'),
    'timestamp', extract(epoch FROM statement_timestamp() - INTERVAL '15 minutes')::BIGINT,
    'from', '77012792791@c.us', 'fromMe', false, 'source', 'app',
    'body', 'Здравствуйте, я отец Данияра')));
RESET request.jwt.claims;
SELECT pg_temp.p279_assert((SELECT count(*) = 4 AND bool_and(result ->> 'disposition' = 'succeeded') FROM p279_wa_runs
    WHERE n BETWEEN 13 AND 16),
  'the review ab265b795 WhatsApp messages did not project through the real chain: '
    || (SELECT string_agg(result::TEXT, ' ') FROM p279_wa_runs WHERE n BETWEEN 13 AND 16));
CREATE TEMP TABLE p279_chats2 AS
SELECT b.normalized_chat_id AS chat, c.id AS conv, c.canonical_client_id AS client, c.canonical_lead_id AS lead
FROM platform_private.waha_direct_chat_bindings b
JOIN platform.communication_conversations c ON c.id = b.conversation_id
WHERE b.organization_id = pg_temp.p279_id(1)
  AND b.normalized_chat_id IN ('996700279911@c.us', '555000279901001@lid', '996700279901@c.us', '77012792791@c.us');
SELECT conv AS p279_madina_mom_conv, client AS p279_madina_mom_client FROM p279_chats2 WHERE chat = '996700279911@c.us' \gset
SELECT conv AS p279_leyla_lid_conv, client AS p279_leyla_wa_client, lead AS p279_leyla_wa_lead
FROM p279_chats2 WHERE chat = '555000279901001@lid' \gset
SELECT conv AS p279_leyla_cus_conv FROM p279_chats2 WHERE chat = '996700279901@c.us' \gset
SELECT conv AS p279_daniyar_father_conv, client AS p279_daniyar_father_client, lead AS p279_daniyar_father_lead
FROM p279_chats2 WHERE chat = '77012792791@c.us' \gset
SELECT pg_temp.p279_assert(
  (SELECT count(*) = 4 FROM p279_chats2)
  AND (SELECT k.normalized_phone LIKE '%996700279901' FROM platform.clients k WHERE k.id = :'p279_leyla_wa_client')
  AND (SELECT c.canonical_client_id = :'p279_leyla_wa_client'::UUID FROM platform.communication_conversations c
    WHERE c.id = :'p279_leyla_cus_conv'),
  'fixture: the LID chat has no client with the SenderAlt phone, or the phone chat is not the same client');
-- B: the lead-agent linked the mother's chat to amoCRM and Sales bound it to
-- Madina's case.
SET LOCAL session_replication_role = replica;
UPDATE platform.communication_conversations SET student_case_id = :'p279_madina_case',
  sales_authority_source = 'provider_linked', amocrm_account_id = 279, amocrm_lead_id = 8801, amocrm_contact_id = 8802
WHERE id = :'p279_madina_mom_conv';
SET LOCAL session_replication_role = origin;

SET request.jwt.claims TO :'p279_madina';
SET ROLE authenticated;
SELECT platform.request_account_deletion_v2(pg_temp.p279_id(1011)) ->> 'status' AS p279_x_status \gset
RESET ROLE;
SET request.jwt.claims TO :'p279_leyla';
SET ROLE authenticated;
SELECT platform.request_account_deletion_v2(pg_temp.p279_id(1012)) ->> 'status' AS p279_x_status \gset
RESET ROLE;
SET request.jwt.claims TO :'p279_daniyar';
SET ROLE authenticated;
SELECT platform.request_account_deletion_v2(pg_temp.p279_id(1013)) ->> 'status' AS p279_x_status \gset
RESET ROLE;
SELECT r.id AS p279_madina_rid FROM platform_private.account_deletion_requests r
WHERE r.subject_auth_user_id = pg_temp.p279_id(112) \gset
SELECT r.id AS p279_leyla_rid FROM platform_private.account_deletion_requests r
WHERE r.subject_auth_user_id = pg_temp.p279_id(113) \gset
SELECT r.id AS p279_daniyar_rid FROM platform_private.account_deletion_requests r
WHERE r.subject_auth_user_id = pg_temp.p279_id(114) \gset

SET request.jwt.claims TO :'p279_admin';
SET ROLE authenticated;
SELECT platform.staff_account_deletion_detail_v1(:'p279_madina_rid')::TEXT AS p279_madina_detail \gset
SELECT platform.staff_account_deletion_detail_v1(:'p279_leyla_rid')::TEXT AS p279_leyla_detail \gset
SELECT platform.staff_account_deletion_detail_v1(:'p279_daniyar_rid')::TEXT AS p279_daniyar_detail \gset
RESET ROLE;
-- (3) B: listed as linked, with its amoCRM numbers; the owned set has none.
SELECT pg_temp.p279_assert(
  pg_temp.p279_review_diff(:'p279_madina_detail'::JSONB, ARRAY['chat:' || :'p279_madina_mom_conv' || ':linked']) = ''
  AND (:'p279_madina_detail'::JSONB ->> 'amocrmContacts')::INT = 0
  AND (SELECT e -> 'amocrm' = '{"contactIds": ["8802"], "leadIds": ["8801"], "dispatchedCommands": 0}'::JSONB
      AND e -> 'facts' ->> 'caseId' = :'p279_madina_case'
    FROM jsonb_array_elements(:'p279_madina_detail'::JSONB -> 'review') e),
  'B: the mother''s chat bound to Madina''s case is not listed as linked with its amoCRM numbers: '
    || pg_temp.p279_review_diff(:'p279_madina_detail'::JSONB, ARRAY['chat:' || :'p279_madina_mom_conv' || ':linked'])
);
-- (3) L2/L3: both chats, the client with the SenderAlt phone and its lead.
SELECT pg_temp.p279_assert(
  pg_temp.p279_review_diff(:'p279_leyla_detail'::JSONB, ARRAY[
    'chat:' || :'p279_leyla_lid_conv' || ':phone', 'chat:' || :'p279_leyla_cus_conv' || ':phone',
    'client:' || :'p279_leyla_wa_client' || ':phone', 'lead:' || :'p279_leyla_wa_lead' || ':phone']) = '',
  'L2/L3: Leyla''s LID and phone chats are not listed: ' || pg_temp.p279_review_diff(:'p279_leyla_detail'::JSONB, ARRAY[
    'chat:' || :'p279_leyla_lid_conv' || ':phone', 'chat:' || :'p279_leyla_cus_conv' || ':phone',
    'client:' || :'p279_leyla_wa_client' || ':phone', 'lead:' || :'p279_leyla_wa_lead' || ':phone'])
);
-- (3) C: the father's records by the one key (8 701 279 2791 = +7 701 279
-- 2791 = 77012792791), Timur's case by the passport number.
SELECT pg_temp.p279_assert(
  pg_temp.p279_review_diff(:'p279_daniyar_detail'::JSONB, ARRAY[
    'client:' || pg_temp.p279_id(2101) || ':phone', 'lead:' || pg_temp.p279_id(2102) || ':phone',
    'chat:' || :'p279_daniyar_father_conv' || ':phone', 'client:' || :'p279_daniyar_father_client' || ':phone',
    'lead:' || :'p279_daniyar_father_lead' || ':phone', 'case:' || :'p279_timur_case' || ':passport']) = ''
  AND NOT (SELECT (e ->> 'canErase')::BOOLEAN FROM jsonb_array_elements(:'p279_daniyar_detail'::JSONB -> 'review') e
    WHERE e ->> 'id' = :'p279_timur_case'),
  'C: Daniyar''s review list: ' || pg_temp.p279_review_diff(:'p279_daniyar_detail'::JSONB, ARRAY[
    'client:' || pg_temp.p279_id(2101) || ':phone', 'lead:' || pg_temp.p279_id(2102) || ':phone',
    'chat:' || :'p279_daniyar_father_conv' || ':phone', 'client:' || :'p279_daniyar_father_client' || ':phone',
    'lead:' || :'p279_daniyar_father_lead' || ':phone', 'case:' || :'p279_timur_case' || ':passport'])
);

-- (4) B: erasing the linked chat changes that chat only (not Madina's case,
-- not the mother's client or lead).
SELECT c.created_from_webhook_event_id AS p279_madina_mom_event FROM platform.communication_conversations c
WHERE c.id = :'p279_madina_mom_conv' \gset
SELECT pg_temp.p279_snapshot('item:linked', ARRAY[:'p279_madina_mom_conv']) > 0 AS p279_snap_ok \gset
SET ROLE authenticated;
SELECT platform.resolve_account_deletion_candidate_v1(:'p279_madina_rid', 'chat', :'p279_madina_mom_conv', 'erase')::TEXT
  AS p279_item \gset
RESET ROLE;
SELECT pg_temp.p279_assert(pg_temp.p279_changed('item:linked', :'p279_ab265_self') = ''
    AND NOT EXISTS (SELECT 1 FROM platform.communication_conversations c WHERE c.id = :'p279_madina_mom_conv')
    AND EXISTS (SELECT 1 FROM platform.clients k WHERE k.id = :'p279_madina_mom_client'),
  '«Удалить этот чат» (linked) changed rows outside that chat: ' || pg_temp.p279_changed('item:linked', :'p279_ab265_self'));
-- (4) L2/L3: the two chats, then the client, then the lead, one by one.
SELECT c.created_from_webhook_event_id AS p279_leyla_lid_event FROM platform.communication_conversations c
WHERE c.id = :'p279_leyla_lid_conv' \gset
SELECT c.created_from_webhook_event_id AS p279_leyla_cus_event FROM platform.communication_conversations c
WHERE c.id = :'p279_leyla_cus_conv' \gset
SELECT pg_temp.p279_snapshot('item:lid', ARRAY[:'p279_leyla_lid_conv']) > 0 AS p279_snap_ok \gset
SET ROLE authenticated;
SELECT platform.resolve_account_deletion_candidate_v1(:'p279_leyla_rid', 'chat', :'p279_leyla_lid_conv', 'erase')::TEXT
  AS p279_item \gset
RESET ROLE;
SELECT pg_temp.p279_assert(pg_temp.p279_changed('item:lid', :'p279_ab265_self') = ''
    AND NOT EXISTS (SELECT 1 FROM platform.communication_conversations c WHERE c.id = :'p279_leyla_lid_conv')
    AND EXISTS (SELECT 1 FROM platform.communication_conversations c WHERE c.id = :'p279_leyla_cus_conv'),
  '«Удалить этот чат» (LID) changed rows outside that chat: ' || pg_temp.p279_changed('item:lid', :'p279_ab265_self'));
SET ROLE authenticated;
SELECT count(*) AS p279_x FROM (
  SELECT platform.resolve_account_deletion_candidate_v1(:'p279_leyla_rid', 'chat', :'p279_leyla_cus_conv', 'erase')
  UNION ALL SELECT platform.resolve_account_deletion_candidate_v1(:'p279_leyla_rid', 'client', :'p279_leyla_wa_client', 'erase')
  UNION ALL SELECT platform.resolve_account_deletion_candidate_v1(:'p279_leyla_rid', 'lead', :'p279_leyla_wa_lead', 'erase')) q \gset
-- C: a case with its own student account is never erased from here.
SELECT pg_temp.p279_assert(
  pg_temp.p279_error(format('SELECT platform.resolve_account_deletion_candidate_v1(%L, %L, %L, %L)',
    :'p279_daniyar_rid', 'case', :'p279_timur_case', 'erase')) = '55000 account_deletion_candidate_has_account',
  'a case with its own student account was erased from another person''s review list'
);
SELECT count(platform.resolve_account_deletion_candidate_v1(:'p279_daniyar_rid', e ->> 'kind', (e ->> 'id')::UUID,
    'not_subject')) AS p279_kept
FROM jsonb_array_elements(:'p279_daniyar_detail'::JSONB -> 'review') e \gset
RESET ROLE;

-- (1) + (2) Processing the three.
SELECT pg_temp.p279_snapshot('ab265', ARRAY[
  pg_temp.p279_id(112)::TEXT, pg_temp.p279_id(113)::TEXT, pg_temp.p279_id(114)::TEXT,
  :'p279_madina_app', :'p279_leyla_app', :'p279_daniyar_app', :'p279_madina_rid', :'p279_leyla_rid', :'p279_daniyar_rid',
  :'p279_madina_case', :'p279_leyla_case', :'p279_daniyar_case',
  :'p279_madina_lead', :'p279_leyla_lead', :'p279_daniyar_lead',
  :'p279_madina_client', :'p279_leyla_client', :'p279_daniyar_client', :'p279_leyla_wa_client', :'p279_leyla_wa_lead']
  || ARRAY(SELECT x::TEXT FROM platform.student_cases sc JOIN platform.organization_memberships m
    ON m.id = sc.student_membership_id, unnest(ARRAY[m.id, m.profile_id]) AS x
    WHERE sc.id IN (:'p279_madina_case', :'p279_leyla_case', :'p279_daniyar_case')),
  ARRAY[pg_temp.p279_id(112)::TEXT, pg_temp.p279_id(113)::TEXT, pg_temp.p279_id(114)::TEXT,
  'email:' || encode(sha256(convert_to('p279-madina@example.invalid', 'UTF8')), 'hex'),
  'email:' || encode(sha256(convert_to('p279-leyla@example.invalid', 'UTF8')), 'hex'),
  'email:' || encode(sha256(convert_to('p279-daniyar@example.invalid', 'UTF8')), 'hex')]) > 0 AS p279_snap_ok \gset
SET ROLE authenticated;
SELECT platform.process_account_deletion_v1(:'p279_madina_rid')::TEXT AS p279_madina_processed \gset
SELECT platform.process_account_deletion_v1(:'p279_leyla_rid')::TEXT AS p279_leyla_processed \gset
SELECT platform.process_account_deletion_v1(:'p279_daniyar_rid')::TEXT AS p279_daniyar_processed \gset
RESET ROLE;
DELETE FROM auth.users WHERE id IN (pg_temp.p279_id(112), pg_temp.p279_id(113), pg_temp.p279_id(114));
SET ROLE authenticated;
SELECT pg_temp.p279_assert(
  :'p279_kept'::INT = 6
  AND (:'p279_madina_processed'::JSONB ->> 'amocrmContacts')::INT = 2
  AND pg_temp.p279_error(format('SELECT platform.complete_account_deletion_v1(%L, %L, FALSE)', :'p279_madina_rid', 'sent'))
    = '55000 account_deletion_amocrm_unconfirmed'
  AND (platform.complete_account_deletion_v1(:'p279_madina_rid', 'sent', TRUE) ->> 'status') = 'completed'
  AND (platform.complete_account_deletion_v1(:'p279_leyla_rid', 'sent', FALSE) ->> 'status') = 'completed'
  AND (platform.complete_account_deletion_v1(:'p279_daniyar_rid', 'sent', FALSE) ->> 'status') = 'completed',
  'the review ab265b795 requests did not complete as expected: ' || :'p279_madina_processed'
);
RESET ROLE;
RESET request.jwt.claims;
SELECT pg_temp.p279_assert(pg_temp.p279_changed('ab265', :'p279_ab265_self') = '',
  'the review ab265b795 subjects changed rows outside their owned sets: ' || pg_temp.p279_changed('ab265', :'p279_ab265_self'));
SELECT pg_temp.p279_assert(
  (SELECT lc.fields ->> 'service_label' FROM platform_private.lead_sale_conditions lc
    WHERE lc.lead_id = :'p279_daniyar_lead') = 'Поступление, связь [удалено]'
  AND (SELECT n.body FROM platform.case_notes n WHERE n.id = pg_temp.p279_id(2104)) = 'Одноклассник Данияр: 8 701 279 2790'
  AND (SELECT n.body FROM platform.case_notes n WHERE n.id = pg_temp.p279_id(2103))
    = 'Ерлан, WhatsApp +7 701 279 2791, звонить утром'
  AND (SELECT f.value FROM platform.student_profile_fields f WHERE f.student_case_id = :'p279_timur_case'
    AND f.field_key = 'passport_number') = 'N2792790',
  'C: Daniyar''s own number in the 8… form is left in his kept row, or another person''s record changed'
);
SELECT pg_temp.p279_assert(
  pg_temp.p279_needles_outside('ab265',
    '(p279-(madina|leyla|daniyar)@example\.invalid|Мадина|Мамина|Лейла|Лидова|Данияр|Казахов|996 ?700 ?279 ?(901|910)|'
    || '7 ?701 ?279 ?2790|8 ?701 ?279 ?2790|N2792790)') = '',
  'personal values of the review ab265b795 subjects are left in their own rows: '
    || pg_temp.p279_needles_outside('ab265',
    '(p279-(madina|leyla|daniyar)@example\.invalid|Мадина|Мамина|Лейла|Лидова|Данияр|Казахов|996 ?700 ?279 ?(901|910)|'
    || '7 ?701 ?279 ?2790|8 ?701 ?279 ?2790|N2792790)')
);
-- ===========================================================================
-- (vi) Classification: every table naming a student case, a student
-- membership, a notification recipient, a lead, a client or a conversation is
-- either erased, kept anonymized, kept as a link without personal values or
-- staff-only. A table with a uuid conversation_id column is erased by the
-- general rule of account_erasure_conversation_rows (review finding 2).
-- ===========================================================================
DO $p279_classification$
DECLARE missing TEXT;
BEGIN
  SELECT string_agg(DISTINCT c.table_schema || '.' || c.table_name, ', ') INTO missing
  FROM information_schema.columns c
  JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    AND t.table_type = 'BASE TABLE'
  WHERE c.table_schema IN ('platform', 'platform_private', 'private')
    AND c.column_name IN ('student_case_id', 'student_membership_id', 'recipient_membership_id', 'client_case_id',
      'previous_student_case_id', 'new_student_case_id', 'lead_id', 'client_id', 'canonical_lead_id',
      'canonical_client_id', 'linked_lead_id', 'person_id', 'conversation_id')
    AND NOT EXISTS (SELECT 1 FROM information_schema.columns cc
      WHERE cc.table_schema = c.table_schema AND cc.table_name = c.table_name
        AND cc.column_name = 'conversation_id' AND cc.udt_name = 'uuid'
        AND c.table_schema IN ('platform', 'platform_private'))
    AND (c.table_schema || '.' || c.table_name) NOT IN (
      -- erased
      'platform.case_chat_messages', 'platform.case_chat_threads', 'platform.case_help_requests',
      'platform.case_notes', 'platform.case_task_events', 'platform.case_tasks', 'platform.case_contract_files',
      'platform.payment_receipt_files', 'platform.student_case_contract_drafts', 'platform.document_access_events',
      'platform.document_reviews', 'platform.document_slot_case_links', 'platform.document_slots',
      'platform.document_validation_events', 'platform.document_versions', 'platform.learning_lesson_attempts',
      'platform.notification_delivery_intents', 'platform.notification_events', 'platform.notifications',
      'platform.staff_notifications', 'platform.student_assessment_attempts',
      'platform.student_portal_notification_projection_v1', 'platform.student_portal_overdue_notification_projection_v1',
      'platform.student_profile_field_proposals', 'platform.student_profile_field_reviews',
      'platform.student_profile_fields', 'platform.student_profiles', 'platform.student_case_updates',
      'platform.university_application_events', 'platform.university_applications', 'platform.visa_case_events',
      'platform.visa_cases', 'platform_private.application_document_download_contexts',
      'platform_private.application_document_submission_reviews', 'platform_private.application_document_submissions',
      'platform_private.application_document_upload_contexts', 'platform_private.application_package_items',
      'platform_private.application_package_reviews', 'platform_private.application_package_submissions',
      'platform_private.application_requirement_items', 'platform_private.application_requirement_revisions',
      'platform_private.case_chat_read_positions', 'platform_private.catalog_preparation_bindings',
      'platform_private.docs_student_intake_requests', 'platform_private.document_download_grants',
      'platform_private.document_export_artifacts', 'platform_private.document_malware_scan_attestations',
      'platform_private.document_recognition_jobs', 'platform_private.document_storage_bindings',
      'platform_private.document_upload_finalizations', 'platform_private.document_upload_reservations',
      'platform_private.kb_nodes', 'platform_private.learning_requests',
      'platform_private.message_media_attachment_uploads',
      'platform_private.partner_packets', 'platform_private.student_applications',
      'platform_private.student_assessment_requests', 'platform_private.student_document_scan_admissions',
      'platform_private.student_portal_overdue_transition_state', 'platform_private.student_portal_provisioning_receipts',
      'platform_private.student_profile_export_attempts',
      'platform.communication_conversations', 'platform.external_identifiers', 'platform.subject_provenance',
      'platform_private.manual_lead_receipts', 'platform_private.staff_lead_task_links',
      'platform_private.website_lead_receipts',
      -- kept anonymized (contract, payments, lifecycle, journal-like records)
      'platform.student_cases', 'platform.payment_events', 'platform.payment_evidence',
      'platform.payment_obligations', 'platform.stop_factor_events', 'platform.stop_factors',
      'platform.post_contract_items', 'platform.post_contract_reports', 'platform.sales_admissions_handoffs',
      'platform.student_case_assignment_events', 'platform.student_case_handoff_acknowledgements',
      'platform.student_case_lifecycle_events', 'platform.student_case_op_handoffs',
      'platform.pilot_cohort_membership_events', 'platform_private.pilot_cohort_membership_receipts',
      'platform_private.admissions_events', 'platform_private.sales_admissions_handoff_receipts',
      'platform_private.amocrm_command_attempts', 'platform_private.amocrm_command_receipts',
      'platform_private.case_curator_coverages', 'platform_private.sales_handoff_owner_sync_receipts',
      'platform.leads', 'platform.lead_admissions_gates', 'platform_private.lead_admissions_gate_receipts',
      'platform_private.lead_attribution_touches', 'platform_private.lead_sale_conditions',
      'platform_private.sales_lead_workflow_receipts', 'platform_private.sales_register',
      -- kept: links without personal values (client merge aliases; amoCRM
      -- numbers, deleted in amoCRM by the Admin before completion)
      'platform_private.client_aliases', 'platform_private.amocrm_contact_bindings',
      'platform_private.amocrm_lead_bindings')
    ;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 279 classification: unclassified tables %', missing;
  END IF;
END
$p279_classification$;

-- (vi-b) Review a10c869b1 finding 1: a table that a row of a person's record
-- points at through a link row (the link has a foreign key to a case, lead,
-- client, chat or анкета and another one to the table), and that names no
-- case, lead, client or chat itself, is classified too: such a parent is
-- either the person's own content (erased with the link: p279_closure
-- follows it) or a catalog, configuration, staff or id-only record.
DO $p279_link_classification$
DECLARE missing TEXT;
BEGIN
  WITH record AS (
    SELECT unnest(ARRAY['platform.student_cases', 'platform.leads', 'platform.clients',
      'platform.communication_conversations', 'platform_private.student_applications']::REGCLASS[]) AS r
  ), hubs AS (
    SELECT unnest(ARRAY['platform.organizations', 'platform.organization_memberships', 'platform.profiles',
      'platform.record_scopes', 'platform.student_cases', 'platform.leads', 'platform.clients',
      'platform.communication_conversations', 'platform_private.student_applications']::REGCLASS[]) AS r
  )
  SELECT string_agg(DISTINCT o.confrelid::REGCLASS::TEXT, ', ') INTO missing
  FROM pg_catalog.pg_constraint l
  JOIN pg_catalog.pg_constraint o ON o.conrelid = l.conrelid AND o.contype = 'f' AND o.oid <> l.oid
  JOIN pg_catalog.pg_class c ON c.oid = l.conrelid AND c.relkind = 'r'
  WHERE l.contype = 'f' AND l.confrelid IN (SELECT r FROM record)
    AND o.confrelid NOT IN (SELECT r FROM hubs) AND o.confrelid <> l.conrelid
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint t
      WHERE t.contype = 'f' AND t.conrelid = o.confrelid AND t.confrelid IN (SELECT r FROM record))
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid = o.confrelid AND NOT a.attisdropped
      AND a.attname IN ('conversation_id', 'student_case_id', 'lead_id', 'client_id'))
    AND o.confrelid::REGCLASS::TEXT NOT IN (
      -- the person's own content, erased with the person's rows (p279_closure reaches it)
      'platform.staff_tasks', 'platform_private.provider_webhook_events', 'platform_private.durable_work_items',
      'platform_private.durable_work_attempts', 'platform_private.waha_message_bindings',
      'platform_private.waha_media_object_bindings', 'platform_private.waha_media_archive_work',
      'platform_private.waha_media_archive_effects', 'platform_private.student_portal_invite_attempts',
      'platform_private.document_export_input_snapshots', 'platform_private.kb_blobs',
      -- accounts: the subject's own is deleted by the server route; any other
      -- is a staff member who acted
      'auth.users',
      -- catalog and configuration without personal values
      'platform.role_bundle_versions', 'platform.document_requirements', 'platform.approved_knowledge_versions',
      'platform.workflow_contract_versions', 'platform.country_requirement_versions',
      'platform_private.ai_prompt_artifact_versions', 'platform.catalog_institutions',
      'platform.contract_template_versions', 'platform.pilot_cohort_configurations',
      'platform_private.admissions_playbook_versions', 'platform_private.university_form_templates',
      'platform_private.university_form_inspection_receipts', 'platform_private.university_form_mapping_versions',
      'platform_private.university_form_mapping_reviews',
      -- ids only
      'platform_private.sales_report_handoff_requests');
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 279 classification: unclassified link targets %', missing;
  END IF;
END
$p279_link_classification$;

SELECT 'P279_ACCOUNT_DELETION_SUITE_PASSED' AS p279_suite_marker;
ROLLBACK;
