\set ON_ERROR_STOP on
-- Boundary suite for migration 279 («Продажи → WhatsApp»: «Сортировка» —
-- «Сначала новые» / «Неотвеченные», owner request 08.10.2026). Runs right
-- after 279 with its own synthetic organizations; every number and message is
-- invented, and the transaction is rolled back. Chats come from the REAL WAHA
-- projection chain (verified event -> enqueue -> claim -> project -> finish):
-- customer messages and messages sent from the sales phone. The reader is
-- called as members whose claims come from the real access-token hook.
--
-- Proves:
--  1. contract: one 11-argument reader per schema (the 9-argument routines
--     are gone, so no call is ambiguous), the two new arguments default to
--     FALSE / NULL, the definer/invoker split, empty search_path, 16 result
--     keys and EXECUTE for authenticated only are exactly 122's;
--  2. «Сначала новые» is unchanged: omitted arguments, explicit FALSE and
--     NULL give 122's order (sort_at DESC, id DESC) and its cursor;
--  3. «Неотвеченные»: chats whose latest message is the customer's first,
--     freshest first, then every other chat, freshest first; a tie on the
--     time falls back to the id;
--  4. pages: walking the reader page by page with the (waiting, sort_at, id)
--     cursor of the last row gives exactly the one-page order — no duplicate,
--     no gap — for page sizes 1, 2, 3 and 4, in both orders;
--  5. new messages: an answer from the phone moves a chat out of the awaiting
--     group, a new customer message moves one to its top;
--  6. search and «only awaiting» keep working together with the order;
--  7. the cursor: «Неотвеченные» with a cursor needs p_before_waiting, the
--     other order refuses it, a cursor without its time is refused (22023);
--  8. the snapshot reader (9 positional arguments) still resolves;
--  9. refusals: a member without communication.read.full, another
--     organization's Admin, anon and the service role.
BEGIN;

DO $n279_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$n279_auth_role$;

CREATE FUNCTION pg_temp.n279_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('27900000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.n279_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'N279: %', message; END IF;
END
$$;

SELECT 'N279_INBOX_UNANSWERED_FIRST_SUITE_START' AS n279_suite_marker;

-- ---------------------------------------------------------------------------
-- 1. Contract.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n279_assert(
  to_regprocedure('platform.staff_communication_page(uuid,integer,timestamp with time zone,uuid,platform.communication_queue,platform.communication_status,uuid,text,boolean)') IS NULL
  AND to_regprocedure('private.staff_communication_page(uuid,integer,timestamp with time zone,uuid,platform.communication_queue,platform.communication_status,uuid,text,boolean)') IS NULL
  AND (SELECT count(*) = 2 FROM pg_proc r JOIN pg_namespace n ON n.oid = r.pronamespace
       WHERE r.proname = 'staff_communication_page' AND n.nspname IN ('platform', 'private')),
  'the 9-argument readers are replaced, not overloaded: one reader per schema');
SELECT pg_temp.n279_assert((SELECT r.prosecdef AND r.provolatile = 's' AND r.proconfig @> ARRAY['search_path=""']::TEXT[]
    AND pg_get_userbyid(r.proowner) = 'postgres' AND r.pronargs = 11 AND r.pronargdefaults = 9
    AND cardinality(r.proallargtypes) = 27
    AND pg_get_function_arguments(r.oid) LIKE '%p_waiting_only boolean DEFAULT false, p_unanswered_first boolean DEFAULT false, p_before_waiting boolean DEFAULT NULL::boolean'
    AND has_function_privilege('authenticated', r.oid, 'EXECUTE')
    AND NOT has_function_privilege('anon', r.oid, 'EXECUTE')
    AND NOT has_function_privilege('service_role', r.oid, 'EXECUTE')
    AND NOT EXISTS (SELECT 1 FROM aclexplode(r.proacl) a WHERE a.grantee = 0)
  FROM pg_proc r WHERE r.oid = 'private.staff_communication_page(uuid,integer,timestamp with time zone,uuid,platform.communication_queue,platform.communication_status,uuid,text,boolean,boolean,boolean)'::regprocedure),
  'the private reader: a stable definer, empty search_path, two optional arguments, 16 result keys, EXECUTE for authenticated only');
SELECT pg_temp.n279_assert((SELECT NOT r.prosecdef AND r.provolatile = 's' AND r.proconfig @> ARRAY['search_path=""']::TEXT[]
    AND r.pronargs = 11 AND r.pronargdefaults = 9 AND cardinality(r.proallargtypes) = 27
    AND pg_get_function_arguments(r.oid) LIKE '%p_waiting_only boolean DEFAULT false, p_unanswered_first boolean DEFAULT false, p_before_waiting boolean DEFAULT NULL::boolean'
    AND has_function_privilege('authenticated', r.oid, 'EXECUTE')
    AND NOT has_function_privilege('anon', r.oid, 'EXECUTE')
    AND NOT has_function_privilege('service_role', r.oid, 'EXECUTE')
    AND NOT EXISTS (SELECT 1 FROM aclexplode(r.proacl) a WHERE a.grantee = 0)
  FROM pg_proc r WHERE r.oid = 'platform.staff_communication_page(uuid,integer,timestamp with time zone,uuid,platform.communication_queue,platform.communication_status,uuid,text,boolean,boolean,boolean)'::regprocedure),
  'the public reader: a stable invoker wrapper, empty search_path, the same arguments and keys, EXECUTE for authenticated only');
SELECT pg_temp.n279_assert(
  (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, NULL), ',' ORDER BY a.ordinality)
   FROM unnest((SELECT proargnames FROM pg_proc WHERE oid = 'platform.staff_communication_page(uuid,integer,timestamp with time zone,uuid,platform.communication_queue,platform.communication_status,uuid,text,boolean,boolean,boolean)'::regprocedure)[12:27],
               (SELECT proallargtypes FROM pg_proc WHERE oid = 'platform.staff_communication_page(uuid,integer,timestamp with time zone,uuid,platform.communication_queue,platform.communication_status,uuid,text,boolean,boolean,boolean)'::regprocedure)[12:27])
     WITH ORDINALITY AS a(attname, atttypid, ordinality))
  = 'conversation_id:uuid,student_case_id:uuid,queue:platform.communication_queue,status:platform.communication_status,subject:text,waha_session_name:text,kommo_account_id:bigint,kommo_conversation_id:text,amocrm_account_id:bigint,amocrm_lead_id:bigint,amocrm_contact_id:bigint,created_at:timestamp with time zone,sort_at:timestamp with time zone,last_message_direction:platform.communication_direction,last_message_at:timestamp with time zone,waiting_since:timestamp with time zone',
  'the 16 result keys and types are exactly 122''s (the running application checks them)');

-- ---------------------------------------------------------------------------
-- Fixture. Organization 1: 1 Admin (system; the intake owner), 2 a member
-- without any permission. Organization 2: 5 Admin.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE n279_actors(n INTEGER, org INTEGER, coarse platform.business_role, claims TEXT);
INSERT INTO n279_actors(n, org, coarse) VALUES (1, 1, 'admin'), (2, 1, NULL), (5, 2, 'admin');
INSERT INTO platform.organizations(id, name) VALUES (pg_temp.n279_id(1), 'N279 Fictional organization'),
  (pg_temp.n279_id(2), 'N279 Other fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.n279_id(100 + n), 'n279-' || n || '@example.invalid', '{}'::JSONB FROM n279_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.n279_id(200 + n), pg_temp.n279_id(100 + n), 'N279 Actor ' || n, 'active', 1 FROM n279_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.n279_id(300 + a.n), pg_temp.n279_id(a.org), pg_temp.n279_id(200 + a.n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM n279_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE
  WHERE id IN (pg_temp.n279_id(301), pg_temp.n279_id(305));
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.n279_id(401), pg_temp.n279_id(1), 'organization', pg_temp.n279_id(1), 1),
  (pg_temp.n279_id(402), pg_temp.n279_id(2), 'organization', pg_temp.n279_id(2), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.n279_id(1), pg_temp.n279_id(301), pg_temp.n279_id(401), 1, 1, TRUE, 'system',
    'N279 synthetic organization scope', pg_temp.n279_id(601)),
  (pg_temp.n279_id(2), pg_temp.n279_id(305), pg_temp.n279_id(402), 1, 1, TRUE, 'system',
    'N279 synthetic other-organization scope', pg_temp.n279_id(602));
UPDATE n279_actors a SET claims = (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.n279_id(100 + a.n),
  'claims', jsonb_build_object('sub', pg_temp.n279_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT;

-- The live chain (as in the 259/260/266/278 suites). Every message is dated
-- T + p_minute (T far ahead of the transaction clock), so the shown time of a
-- chat is its latest message, never the projection's own conversation update.
UPDATE pgmq.q_platform_work_v1 SET vt = pg_catalog.clock_timestamp() + INTERVAL '1 day'
  WHERE vt <= pg_catalog.clock_timestamp();
CREATE FUNCTION pg_temp.n279_t(p_minute INTEGER) RETURNS TIMESTAMPTZ LANGUAGE SQL IMMUTABLE AS $$
  SELECT '2031-01-07 09:00:00+00'::TIMESTAMPTZ + p_minute * INTERVAL '1 minute'
$$;
CREATE FUNCTION pg_temp.n279_live(p_n INTEGER, p_minute INTEGER, p_payload JSONB) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE
  org CONSTANT UUID := pg_temp.n279_id(1);
  event_id CONSTANT UUID := pg_temp.n279_id(1000 + p_n);
  enq JSONB; claim JSONB; proj JSONB; fin JSONB; work UUID; attempt UUID;
BEGIN
  INSERT INTO platform_private.provider_webhook_events (id, organization_id, provider, provider_account_ref,
    provider_conversation_ref, provider_event_variant_ref, provider_request_id, waha_session_name, payload_id,
    event_type, provider_occurred_at, verification_status, raw_payload, verification_headers,
    verification_evidence_ref, payload_sha256, request_id)
  VALUES (event_id, org, 'waha', 'waha:crm_primary', NULL, NULL, 'n279-' || p_n, 'crm_primary',
    p_payload ->> 'id', 'message.any', pg_temp.n279_t(p_minute),
    'verified', jsonb_build_object('event', 'message.any', 'session', 'crm_primary', 'payload', p_payload),
    '{"hmac_verified":true}', 'synthetic:n279:' || p_n, lpad(to_hex(p_n + 279000), 64, '0'), pg_temp.n279_id(1500 + p_n));
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
  enq := platform.enqueue_verified_webhook_work(org, event_id,
    encode(sha256(convert_to('n279-message.any-' || (p_payload ->> 'id'), 'UTF8')), 'hex'), 8, pg_temp.n279_id(2000 + p_n * 10 + 1));
  work := (enq ->> 'work_item_id')::UUID;
  claim := platform.claim_waha_webhook_work_item(org, work, 60, 'n279', pg_temp.n279_id(2000 + p_n * 10 + 2));
  attempt := (claim ->> 'attempt_id')::UUID;
  proj := platform.project_claimed_waha_event(org, work, attempt, pg_temp.n279_id(301), pg_temp.n279_id(2000 + p_n * 10 + 3));
  fin := platform.finish_waha_webhook_work(org, work, attempt, (proj ->> 'disposition')::platform.durable_work_finish_outcome,
    proj ->> 'error_code', proj ->> 'evidence_ref', NULL, pg_temp.n279_id(2000 + p_n * 10 + 4));
  PERFORM set_config('request.jwt.claims', '', TRUE);
  RETURN proj ->> 'disposition' = 'succeeded' AND fin ->> 'state' = 'succeeded';
END
$$;
-- A customer message in chat p_chat.
CREATE FUNCTION pg_temp.n279_in(p_n INTEGER, p_chat TEXT, p_minute INTEGER) RETURNS BOOLEAN LANGUAGE SQL AS $$
  SELECT pg_temp.n279_live(p_n, p_minute, jsonb_build_object('id', 'n279-in-' || p_n, 'timestamp', 1788343200,
    'from', p_chat, 'fromMe', false, 'source', 'app', 'body', 'Здравствуйте', '_data', '{}'::JSONB))
$$;
-- An answer sent from the sales phone (WEBJS shape: from = own, to = customer).
CREATE FUNCTION pg_temp.n279_out(p_n INTEGER, p_chat TEXT, p_minute INTEGER) RETURNS BOOLEAN LANGUAGE SQL AS $$
  SELECT pg_temp.n279_live(p_n, p_minute, jsonb_build_object('id', 'n279-out-' || p_n, 'timestamp', 1788343200,
    'from', '996700000000@c.us', 'to', p_chat, 'fromMe', true, 'source', 'app', 'body', 'Ответ с телефона',
    '_data', '{}'::JSONB))
$$;
CREATE FUNCTION pg_temp.n279_conv(p_chat TEXT) RETURNS UUID LANGUAGE SQL AS $$
  SELECT b.conversation_id FROM platform_private.waha_direct_chat_bindings b
  WHERE b.organization_id = pg_temp.n279_id(1) AND b.normalized_chat_id = p_chat
$$;

-- Eight chats (synthetic numbers). Minutes after T:
--   a1  customer 5, phone answer 60       -> answered, the newest chat
--   w1  customer 50                       -> awaiting
--   w4  customer 1, answer 3, customer 45 -> awaiting again
--   a2  customer 20, answer 40            -> answered
--   w2  customer 30                       -> awaiting (same time as w5)
--   w5  customer 30                       -> awaiting (same time as w2)
--   w3  customer 10                       -> awaiting
--   a3  customer 2, answer 4              -> answered, the oldest chat
CREATE TEMP TABLE n279_chats(key TEXT PRIMARY KEY, chat TEXT NOT NULL);
INSERT INTO n279_chats VALUES ('a1', '996700279001@c.us'), ('w1', '996700279002@c.us'), ('w4', '996700279003@c.us'),
  ('a2', '996700279004@c.us'), ('w2', '996700279005@c.us'), ('w5', '996700279006@c.us'), ('w3', '996700279007@c.us'),
  ('a3', '996700279008@c.us');
CREATE FUNCTION pg_temp.n279_c(p_key TEXT) RETURNS UUID LANGUAGE SQL AS $$
  SELECT pg_temp.n279_conv((SELECT chat FROM n279_chats WHERE key = p_key))
$$;
CREATE FUNCTION pg_temp.n279_chat(p_key TEXT) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT chat FROM n279_chats WHERE key = p_key
$$;
SELECT pg_temp.n279_assert(
  pg_temp.n279_in(1, pg_temp.n279_chat('a1'), 5) AND pg_temp.n279_out(2, pg_temp.n279_chat('a1'), 60)
  AND pg_temp.n279_in(3, pg_temp.n279_chat('w1'), 50)
  AND pg_temp.n279_in(4, pg_temp.n279_chat('w4'), 1) AND pg_temp.n279_out(5, pg_temp.n279_chat('w4'), 3)
  AND pg_temp.n279_in(6, pg_temp.n279_chat('w4'), 45)
  AND pg_temp.n279_in(7, pg_temp.n279_chat('a2'), 20) AND pg_temp.n279_out(8, pg_temp.n279_chat('a2'), 40)
  AND pg_temp.n279_in(9, pg_temp.n279_chat('w2'), 30)
  AND pg_temp.n279_in(10, pg_temp.n279_chat('w5'), 30)
  AND pg_temp.n279_in(11, pg_temp.n279_chat('w3'), 10)
  AND pg_temp.n279_in(12, pg_temp.n279_chat('a3'), 2) AND pg_temp.n279_out(13, pg_temp.n279_chat('a3'), 4)
  AND (SELECT count(DISTINCT pg_temp.n279_c(key)) = 8 FROM n279_chats),
  'fixture: eight chats projected through the real WAHA chain');
-- The two chats with the same time, in the reader's tie order (id DESC).
SELECT (SELECT array_agg(id ORDER BY id DESC) FROM unnest(ARRAY[pg_temp.n279_c('w2'), pg_temp.n279_c('w5')]) AS t(id)) AS tie \gset

GRANT EXECUTE ON FUNCTION pg_temp.n279_id(INTEGER) TO authenticated;

-- The reader as one actor: ordered conversation ids as a JSON array, or the
-- SQLSTATE of the refusal. NULL arguments mean «omitted».
CREATE FUNCTION pg_temp.n279_read(
  p_role TEXT, p_claims TEXT, p_org UUID, p_limit INTEGER,
  p_unanswered BOOLEAN DEFAULT NULL, p_before_waiting BOOLEAN DEFAULT NULL,
  p_before_at TIMESTAMPTZ DEFAULT NULL, p_before_id UUID DEFAULT NULL,
  p_query TEXT DEFAULT NULL, p_waiting_only BOOLEAN DEFAULT NULL
) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE result TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims, TRUE);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN
    IF p_unanswered IS NULL AND p_before_waiting IS NULL AND p_waiting_only IS NULL THEN
      -- The running application's exact call shape: no new argument at all.
      SELECT COALESCE(jsonb_agg(page.conversation_id ORDER BY page.ord), '[]'::JSONB)::TEXT INTO result
      FROM platform.staff_communication_page(p_org, p_limit, p_before_at, p_before_id, NULL, NULL, NULL, p_query)
        WITH ORDINALITY AS page(conversation_id, student_case_id, queue, status, subject, waha_session_name,
          kommo_account_id, kommo_conversation_id, amocrm_account_id, amocrm_lead_id, amocrm_contact_id,
          created_at, sort_at, last_message_direction, last_message_at, waiting_since, ord);
    ELSE
      SELECT COALESCE(jsonb_agg(page.conversation_id ORDER BY page.ord), '[]'::JSONB)::TEXT INTO result
      FROM platform.staff_communication_page(p_org, p_limit, p_before_at, p_before_id, NULL, NULL, NULL, p_query,
          p_waiting_only => COALESCE(p_waiting_only, FALSE), p_unanswered_first => p_unanswered,
          p_before_waiting => p_before_waiting)
        WITH ORDINALITY AS page(conversation_id, student_case_id, queue, status, subject, waha_session_name,
          kommo_account_id, kommo_conversation_id, amocrm_account_id, amocrm_lead_id, amocrm_contact_id,
          created_at, sort_at, last_message_direction, last_message_at, waiting_since, ord);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    result := SQLSTATE;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', TRUE);
  RETURN result;
END
$$;
CREATE FUNCTION pg_temp.n279_admin(
  p_limit INTEGER, p_unanswered BOOLEAN DEFAULT NULL, p_before_waiting BOOLEAN DEFAULT NULL,
  p_before_at TIMESTAMPTZ DEFAULT NULL, p_before_id UUID DEFAULT NULL, p_query TEXT DEFAULT NULL,
  p_waiting_only BOOLEAN DEFAULT NULL
) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT pg_temp.n279_read('authenticated', (SELECT claims FROM n279_actors WHERE n = 1), pg_temp.n279_id(1),
    p_limit, p_unanswered, p_before_waiting, p_before_at, p_before_id, p_query, p_waiting_only)
$$;
SELECT set_config('n279.tie', :'tie', FALSE) AS tie_set \gset
-- Expected order as a JSON array of ids; 'tie' stands for the w2/w5 pair in id DESC.
CREATE FUNCTION pg_temp.n279_expect(VARIADIC p_keys TEXT[]) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT jsonb_agg(id ORDER BY ord, sub)::TEXT
  FROM unnest(p_keys) WITH ORDINALITY AS k(key, ord)
  CROSS JOIN LATERAL (
    SELECT t.id, t.sub FROM unnest(current_setting('n279.tie')::UUID[]) WITH ORDINALITY AS t(id, sub) WHERE k.key = 'tie'
    UNION ALL
    SELECT pg_temp.n279_c(k.key), 1 WHERE k.key <> 'tie'
  ) AS x
$$;

-- Walk the reader page by page with the cursor of each page's last row, as
-- the application does (limit + 1 rows, the extra row only says «more»).
CREATE FUNCTION pg_temp.n279_walk(p_page INTEGER, p_unanswered BOOLEAN) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  claims CONSTANT TEXT := (SELECT claims FROM n279_actors WHERE n = 1);
  acc UUID[] := ARRAY[]::UUID[];
  cur_at TIMESTAMPTZ; cur_id UUID; cur_waiting BOOLEAN;
  rows_read INTEGER; guard INTEGER := 0;
  page_row RECORD;
BEGIN
  PERFORM set_config('request.jwt.claims', claims, TRUE);
  SET LOCAL ROLE authenticated;
  LOOP
    guard := guard + 1;
    IF guard > 50 THEN RAISE EXCEPTION 'N279: the walk did not end'; END IF;
    rows_read := 0;
    FOR page_row IN
      SELECT page.conversation_id, page.sort_at, page.waiting_since
      FROM platform.staff_communication_page(pg_temp.n279_id(1), p_page + 1, cur_at, cur_id,
        p_unanswered_first => p_unanswered, p_before_waiting => CASE WHEN p_unanswered THEN cur_waiting END) AS page
    LOOP
      rows_read := rows_read + 1;
      EXIT WHEN rows_read > p_page;
      acc := acc || page_row.conversation_id;
      cur_at := page_row.sort_at;
      cur_id := page_row.conversation_id;
      cur_waiting := page_row.waiting_since IS NOT NULL;
    END LOOP;
    EXIT WHEN rows_read <= p_page;
  END LOOP;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', TRUE);
  RETURN to_jsonb(acc)::TEXT;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. «Сначала новые» is 122's order.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n279_assert(
  pg_temp.n279_admin(50)::JSONB = pg_temp.n279_expect('a1', 'w1', 'w4', 'a2', 'tie', 'w3', 'a3')::JSONB,
  '«Сначала новые» (no new argument): freshest first, the tie by id');
SELECT pg_temp.n279_assert(
  pg_temp.n279_admin(50, FALSE) = pg_temp.n279_admin(50)
  AND pg_temp.n279_read('authenticated', (SELECT claims FROM n279_actors WHERE n = 1), pg_temp.n279_id(1), 50,
    p_waiting_only => FALSE) = pg_temp.n279_admin(50),
  'explicit FALSE and a NULL p_unanswered_first are the compatibility default');
SELECT pg_temp.n279_assert(
  pg_temp.n279_admin(50, p_before_at => pg_temp.n279_t(45), p_before_id => pg_temp.n279_c('w4'))::JSONB
    = pg_temp.n279_expect('a2', 'tie', 'w3', 'a3')::JSONB,
  'the 122 cursor (sort_at, id) is unchanged');

-- ---------------------------------------------------------------------------
-- 3. «Неотвеченные».
-- ---------------------------------------------------------------------------
SELECT pg_temp.n279_assert(
  pg_temp.n279_admin(50, TRUE)::JSONB = pg_temp.n279_expect('w1', 'w4', 'tie', 'w3', 'a1', 'a2', 'a3')::JSONB,
  '«Неотвеченные»: awaiting chats first, freshest first; then the rest, freshest first');
SELECT pg_temp.n279_assert(
  pg_temp.n279_admin(3, TRUE)::JSONB = (SELECT jsonb_agg(e ORDER BY o)
    FROM jsonb_array_elements(pg_temp.n279_expect('w1', 'w4', 'tie')::JSONB) WITH ORDINALITY AS x(e, o) WHERE o <= 3),
  'the order is applied before LIMIT: the first page holds the awaiting chats, not the newest ones');

-- ---------------------------------------------------------------------------
-- 4. Pages: no duplicate, no gap.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n279_assert(
  pg_temp.n279_walk(1, TRUE) = pg_temp.n279_admin(50, TRUE)
  AND pg_temp.n279_walk(2, TRUE) = pg_temp.n279_admin(50, TRUE)
  AND pg_temp.n279_walk(3, TRUE) = pg_temp.n279_admin(50, TRUE)
  AND pg_temp.n279_walk(4, TRUE) = pg_temp.n279_admin(50, TRUE)
  AND jsonb_array_length(pg_temp.n279_walk(3, TRUE)::JSONB) = 8,
  '«Неотвеченные» page by page (1, 2, 3, 4 rows) is the one-page order: every chat once, the tie and the group border included');
SELECT pg_temp.n279_assert(
  pg_temp.n279_walk(1, FALSE) = pg_temp.n279_admin(50)
  AND pg_temp.n279_walk(3, FALSE) = pg_temp.n279_admin(50),
  '«Сначала новые» page by page is the one-page order');
SELECT pg_temp.n279_assert(
  pg_temp.n279_admin(50, TRUE, TRUE, pg_temp.n279_t(10), pg_temp.n279_c('w3'))::JSONB
    = pg_temp.n279_expect('a1', 'a2', 'a3')::JSONB
  AND pg_temp.n279_admin(50, TRUE, FALSE, pg_temp.n279_t(60), pg_temp.n279_c('a1'))::JSONB
    = pg_temp.n279_expect('a2', 'a3')::JSONB,
  'the cursor after the last awaiting chat starts the rest at its newest chat; inside the rest it continues there');

-- ---------------------------------------------------------------------------
-- 5. New messages move chats between the groups.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n279_assert(pg_temp.n279_out(14, pg_temp.n279_chat('w1'), 70)
  AND pg_temp.n279_admin(50, TRUE)::JSONB = pg_temp.n279_expect('w4', 'tie', 'w3', 'w1', 'a1', 'a2', 'a3')::JSONB,
  'an answer from the phone moves the chat out of the awaiting group, to the top of the rest');
SELECT pg_temp.n279_assert(pg_temp.n279_in(15, pg_temp.n279_chat('a3'), 80)
  AND pg_temp.n279_admin(50, TRUE)::JSONB = pg_temp.n279_expect('a3', 'w4', 'tie', 'w3', 'w1', 'a1', 'a2')::JSONB
  AND pg_temp.n279_admin(50)::JSONB = pg_temp.n279_expect('a3', 'w1', 'a1', 'w4', 'a2', 'tie', 'w3')::JSONB,
  'a new customer message puts its chat at the top of the awaiting group; «Сначала новые» simply follows the time');
SELECT pg_temp.n279_assert(
  pg_temp.n279_walk(2, TRUE) = pg_temp.n279_admin(50, TRUE),
  'pages stay exact after the moves');

-- ---------------------------------------------------------------------------
-- 6. Search and «only awaiting» with the order.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n279_assert(
  pg_temp.n279_admin(50, TRUE, p_waiting_only => TRUE)::JSONB = pg_temp.n279_expect('a3', 'w4', 'tie', 'w3')::JSONB
  AND pg_temp.n279_admin(50, FALSE, p_waiting_only => TRUE) = pg_temp.n279_admin(50, TRUE, p_waiting_only => TRUE),
  'only awaiting chats: both orders agree');
SELECT pg_temp.n279_assert(
  pg_temp.n279_admin(50, TRUE, p_query => '27900')::JSONB = pg_temp.n279_admin(50, TRUE)::JSONB
  AND pg_temp.n279_admin(50, TRUE, p_query => '279001')::JSONB = pg_temp.n279_expect('a1')::JSONB
  AND pg_temp.n279_admin(50, TRUE, p_query => '279007')::JSONB = pg_temp.n279_expect('w3')::JSONB,
  'search by number filters before the order and LIMIT');

-- ---------------------------------------------------------------------------
-- 7. The cursor.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n279_assert(
  pg_temp.n279_admin(50, TRUE, NULL, pg_temp.n279_t(45), pg_temp.n279_c('w4')) = '22023'
  AND pg_temp.n279_admin(50, TRUE, TRUE) = '22023'
  AND pg_temp.n279_admin(50, FALSE, TRUE, pg_temp.n279_t(45), pg_temp.n279_c('w4')) = '22023'
  AND pg_temp.n279_admin(50, FALSE, FALSE) = '22023'
  AND pg_temp.n279_admin(50, TRUE, TRUE, pg_temp.n279_t(45)) = '22023',
  'a «Неотвеченные» cursor without its group, a group without a cursor, a group in the other order and half a cursor are refused');

-- ---------------------------------------------------------------------------
-- 8. The snapshot reader still resolves its 9 positional arguments.
-- ---------------------------------------------------------------------------
SELECT (SELECT claims FROM n279_actors WHERE n = 1) AS admin_claims, pg_temp.n279_c('w4') AS w4_id,
  pg_temp.n279_t(45) AS w4_waiting \gset
SELECT set_config('request.jwt.claims', :'admin_claims', TRUE) AS admin_set \gset
SET LOCAL ROLE authenticated;
SELECT count(*) AS snap_rows,
  bool_and(s.waiting_since = :'w4_waiting'::TIMESTAMPTZ AND s.last_message_direction = 'inbound') AS snap_ok
FROM platform.staff_communication_snapshot('27900000-0000-4000-8000-000000000001'::UUID, :'w4_id'::UUID) AS s \gset
RESET ROLE;
SELECT set_config('request.jwt.claims', '', TRUE) AS admin_reset \gset
SELECT pg_temp.n279_assert(:snap_rows = 1 AND :'snap_ok'::BOOLEAN,
  'staff_communication_snapshot: one row with 122''s waiting_since');

-- ---------------------------------------------------------------------------
-- 9. Refusals.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n279_assert(
  pg_temp.n279_read('authenticated', (SELECT claims FROM n279_actors WHERE n = 2), pg_temp.n279_id(1), 50, TRUE) = '42501'
  AND pg_temp.n279_read('authenticated', (SELECT claims FROM n279_actors WHERE n = 5), pg_temp.n279_id(1), 50, TRUE) = '42501'
  AND pg_temp.n279_read('authenticated', (SELECT claims FROM n279_actors WHERE n = 5), pg_temp.n279_id(2), 50, TRUE) = '[]'
  AND pg_temp.n279_read('anon', '{"role":"anon"}', pg_temp.n279_id(1), 50, TRUE) = '42501'
  AND pg_temp.n279_read('service_role', '{"role":"service_role"}', pg_temp.n279_id(1), 50, TRUE) = '42501',
  'a member without communication.read.full, another organization''s Admin, anon and the service role are refused; another organization reads nothing of this one');

SELECT 'N279_INBOX_UNANSWERED_FIRST_SUITE_PASSED' AS n279_suite_result;

ROLLBACK;
