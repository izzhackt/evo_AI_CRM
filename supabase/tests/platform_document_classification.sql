\set ON_ERROR_STOP on
-- Boundary suite for migration 333 «ИИ раскладывает файлы из amoCRM по чек-листу, куратор подтверждает» (решение владельца 06.11.2026).
-- Runs on the real chain right after 333 inside one transaction that is rolled back, with its own synthetic organizations, members
-- and cases. Files come through the REAL ingress RPCs (reserve_document_upload_after_ingress_scan / finalize_document_upload_with_scan),
-- consent through the real student_ai_consents rows and the real 320 rule. No provider, no Gemini / Google call, no bytes, no real person.
--
-- Proves:
--  1. posture: both tables closed to every API role (RLS forced), append-only guards; the four batch functions for service_role only,
--     the two staff functions for authenticated only; helpers closed; empty search_path everywhere;
--  2. the plan (dry run): counts only, by the 320 rule - a student without a portal account and a student who allowed take the AI path,
--     a student who declined and a student who has a portal account and did not decide take the manual path; the strict flag keeps
--     only explicit consent; files outside the amoCRM group, of a case that is not active and already-resolved files are not counted;
--  3. candidates: only eligible files of allowed students (with their private object name), never the manual-path ones; limit bounds;
--     the run id keeps a failed file out of the same run; nothing for anon / authenticated;
--  4. record: consent is re-checked at write time (ai_consent_missing 42501), a file outside the group is not a candidate (22023),
--     a repeat does not duplicate and never overwrites a result, a failed row is retried (attempts + 1) up to three times, the kind
--     is a closed list, the cost is added;
--  5. the staff read: suggestions of the case for a full reader; hidden (not deleted) when the student declines; refused to a
--     student, another organization's admin, anon and service_role;
--  6. the curator decision, separate from the suggestion: accepted_suggestion / corrected / chosen_without_suggestion (also for a
--     student on the manual path), replay by request id, conflict on another kind, refused to a student and a foreign admin; the
--     resolved file leaves the unsorted set; both tables refuse update and delete;
--  7. the budget: remaining = daily ceiling - job reservations today - suggestion cost today.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

\echo A333_DOCUMENT_CLASSIFICATION_SUITE_START

CREATE FUNCTION pg_temp.a333_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('33300000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
GRANT EXECUTE ON FUNCTION pg_temp.a333_id(INTEGER) TO authenticated, service_role, anon;
CREATE FUNCTION pg_temp.a333_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A333: %', message; END IF;
END
$$;
CREATE FUNCTION pg_temp.a333_call(p_role TEXT, p_claims TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB; saved TEXT := current_setting('request.jwt.claims', TRUE); v_state TEXT; v_message TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', COALESCE(p_claims, ''), TRUE);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN
    EXECUTE p_sql INTO result;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
    result := jsonb_build_object('error', v_state, 'message', v_message);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', COALESCE(saved, ''), TRUE);
  RETURN COALESCE(result, 'null'::JSONB);
END
$$;
CREATE TEMP TABLE a333_claims(actor INTEGER PRIMARY KEY, claims TEXT);
GRANT SELECT ON a333_claims TO authenticated;
CREATE FUNCTION pg_temp.a333_as(p_actor INTEGER, p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a333_call('authenticated', (SELECT claims FROM a333_claims WHERE actor = p_actor), p_sql)
$$;
CREATE FUNCTION pg_temp.a333_svc(p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a333_call('service_role', '{"role":"service_role"}', p_sql)
$$;
CREATE FUNCTION pg_temp.a333_anon(p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a333_call('anon', '{"role":"anon"}', p_sql)
$$;
CREATE FUNCTION pg_temp.a333_err(p_result JSONB) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$ SELECT p_result ->> 'error' $$;
CREATE FUNCTION pg_temp.a333_msg(p_result JSONB) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$ SELECT p_result ->> 'message' $$;

-- ---------------------------------------------------------------------------
-- Fixture. Actors: 1 org 1 Admin, 2 org 1 student with a portal (allowed), 3 org 1 student with a portal (undecided),
-- 4 org 1 student with a portal (declined), 5 org 2 Admin.
-- Cases (org 1, active unless noted): 701 no portal, 702 portal allowed, 703 portal undecided, 704 portal declined,
-- 705 no portal but NOT active. Each has one amoCRM-group file; case 701 also has a file in an ordinary group.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE a333_actors(n INTEGER PRIMARY KEY, org INTEGER, coarse platform.business_role, sysadmin BOOLEAN);
INSERT INTO a333_actors VALUES (1, 1, 'admin', TRUE), (2, 1, 'student', FALSE), (3, 1, 'student', FALSE), (4, 1, 'student', FALSE),
  (5, 2, 'admin', TRUE);
INSERT INTO platform.organizations(id, name, status) VALUES
  (pg_temp.a333_id(1), 'A333 Fictional organization', 'active'), (pg_temp.a333_id(2), 'A333 Other fictional organization', 'active');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.a333_id(100 + n), 'a333-' || n || '@example.invalid', '{}'::JSONB FROM a333_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.a333_id(200 + n), pg_temp.a333_id(100 + n), 'A333 Actor ' || n, 'active', 1 FROM a333_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, created_at)
  SELECT pg_temp.a333_id(300 + a.n), pg_temp.a333_id(a.org), pg_temp.a333_id(200 + a.n), 'active', a.coarse,
    (SELECT id FROM platform.role_bundle_versions WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1),
    TIMESTAMPTZ '2026-01-01 00:00:00+00' + a.n * INTERVAL '1 day'
  FROM a333_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE
  WHERE id IN (SELECT pg_temp.a333_id(300 + n) FROM a333_actors WHERE sysadmin);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.a333_id(401), pg_temp.a333_id(1), 'organization', pg_temp.a333_id(1), 1),
  (pg_temp.a333_id(402), pg_temp.a333_id(2), 'organization', pg_temp.a333_id(2), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.a333_id(1), pg_temp.a333_id(301), pg_temp.a333_id(401), 1, 1, TRUE, 'system', 'A333 synthetic scope', pg_temp.a333_id(601)),
  (pg_temp.a333_id(2), pg_temp.a333_id(305), pg_temp.a333_id(402), 1, 1, TRUE, 'system', 'A333 synthetic scope', pg_temp.a333_id(602));
CREATE FUNCTION pg_temp.a333_claims_for(p_n INTEGER) RETURNS TEXT LANGUAGE SQL VOLATILE AS $$
  SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.a333_id(100 + p_n),
    'claims', jsonb_build_object('sub', pg_temp.a333_id(100 + p_n), 'role', 'authenticated'))) -> 'claims')::TEXT
$$;
INSERT INTO a333_claims(actor, claims) SELECT a.n, pg_temp.a333_claims_for(a.n) FROM a333_actors a;
SELECT pg_temp.a333_assert((SELECT count(*) = 5 AND bool_and(claims IS NOT NULL) FROM a333_claims), 'every fixture actor got claims from the real hook');

SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases (id, organization_id, student_membership_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, program_direction, intake, operational_stage, state, handoff_at, closed_at,
  current_scope_id, current_scope_version, admissions_direction, pipeline_stage, next_action, created_at, updated_at)
SELECT pg_temp.a333_id(c.n), pg_temp.a333_id(1), CASE WHEN c.student IS NULL THEN NULL ELSE pg_temp.a333_id(300 + c.student) END,
  pg_temp.a333_id(301), CASE WHEN c.state = 'active' THEN pg_temp.a333_id(301) END, 'a333-case-' || c.n, 'A333 Fictional Student ' || c.n, 'China', 'bachelor', 'CN', '2027-09',
  'intake', c.state::platform.student_case_state, CASE WHEN c.state = 'active' THEN clock_timestamp() - INTERVAL '3 days' END, NULL,
  pg_temp.a333_id(401), 1, 'CN', 'documents', NULL, clock_timestamp() - INTERVAL '4 days', clock_timestamp() - INTERVAL '1 hour'
FROM (VALUES (701, NULL::INTEGER, 'active'), (702, 2, 'active'), (703, 3, 'active'), (704, 4, 'active'), (705, NULL, 'pending')) AS c(n, student, state);
SET LOCAL session_replication_role = origin;
-- 320: actor 2 allowed on the current policy version, actor 4 declined, actor 3 never asked.
INSERT INTO platform_private.student_ai_consents(organization_id, auth_user_id, status, policy_version, source)
VALUES (pg_temp.a333_id(1), pg_temp.a333_id(102), 'granted', platform_private.student_ai_consent_policy_version(), 'portal_web'),
  (pg_temp.a333_id(1), pg_temp.a333_id(104), 'declined', platform_private.student_ai_consent_policy_version(), 'portal_web');
SELECT pg_temp.a333_assert(platform_private.ai_agent_student_ai_allowed(pg_temp.a333_id(1), pg_temp.a333_id(701))
  AND platform_private.ai_agent_student_ai_allowed(pg_temp.a333_id(1), pg_temp.a333_id(702))
  AND NOT platform_private.ai_agent_student_ai_allowed(pg_temp.a333_id(1), pg_temp.a333_id(703))
  AND NOT platform_private.ai_agent_student_ai_allowed(pg_temp.a333_id(1), pg_temp.a333_id(704)),
  'the 320 rule: no portal and allowed are allowed; undecided and declined are not');

-- Slots: amoCRM group (custom, named like the import), plus one ordinary slot on case 701.
INSERT INTO platform.document_slots(id, organization_id, student_case_id, requirement_id, intent_kind, display_label, group_label, created_by_membership_id)
SELECT pg_temp.a333_id(s.slot), pg_temp.a333_id(1), pg_temp.a333_id(s.c), NULL, 'custom', s.label, s.grp, pg_temp.a333_id(301)
FROM (VALUES (811, 701, 'Файл amoCRM: 00000000-aaaa-4000-8000-000000000001.png', 'Из amoCRM (не разобрано)'),
  (812, 702, 'Файл amoCRM: 00000000-aaaa-4000-8000-000000000002.png', 'Из amoCRM (не разобрано)'),
  (813, 703, 'Файл amoCRM: 00000000-aaaa-4000-8000-000000000003.png', 'Из amoCRM (не разобрано)'),
  (814, 704, 'Файл amoCRM: 00000000-aaaa-4000-8000-000000000004.png', 'Из amoCRM (не разобрано)'),
  (815, 705, 'Файл amoCRM: 00000000-aaaa-4000-8000-000000000005.png', 'Из amoCRM (не разобрано)'),
  (816, 701, 'Синтетический обычный документ', 'Дополнительные документы')) AS s(slot, c, label, grp);

INSERT INTO storage.buckets(id, name, public) VALUES ('platform-documents', 'platform-documents', FALSE) ON CONFLICT DO NOTHING;
-- The REAL ingress: reserve (with a clean scan) -> object -> finalize. Synthetic hash per slot, no bytes.
CREATE FUNCTION pg_temp.a333_upload(p_slot INTEGER, p_case INTEGER, p_hash CHAR) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE up JSONB;
BEGIN
  up := pg_temp.a333_svc(format('SELECT platform.reserve_document_upload_after_ingress_scan(%L, %L, %L, %L, %L, 128, %L, %L, %L, %L, %L, %L, statement_timestamp(), %L)',
    pg_temp.a333_id(1), pg_temp.a333_id(101), pg_temp.a333_id(p_slot), 'synthetic.png', 'image/png', repeat(p_hash, 64),
    'clean', 'ClamAV', '1.5.3', '27889', 'clamd-zinstream-v1', gen_random_uuid()));
  IF up ? 'error' THEN RAISE EXCEPTION 'A333: reserve failed: %', up; END IF;
  INSERT INTO storage.objects(bucket_id, name, metadata, created_at)
    VALUES (up ->> 'bucket_id', up ->> 'object_name', '{"size":128,"mimetype":"image/png"}', statement_timestamp());
  up := up || pg_temp.a333_svc(format('SELECT platform.finalize_document_upload_with_scan(%L, %L, %L, %L, %L, %L, %L, statement_timestamp(), %L)',
    pg_temp.a333_id(1), up ->> 'upload_reservation_id', 'ClamAV', '1.5.3', '27889', 'clamd-zinstream-v1', repeat(p_hash, 64), gen_random_uuid()));
  IF up ? 'error' THEN RAISE EXCEPTION 'A333: finalize failed: %', up; END IF;
  RETURN (up ->> 'document_version_id')::UUID;
END
$$;
SELECT pg_temp.a333_upload(811, 701, 'a') AS a333_v1 \gset
SELECT pg_temp.a333_upload(812, 702, 'b') AS a333_v2 \gset
SELECT pg_temp.a333_upload(813, 703, 'c') AS a333_v3 \gset
SELECT pg_temp.a333_upload(814, 704, 'd') AS a333_v4 \gset
SELECT pg_temp.a333_upload(815, 705, 'e') AS a333_v5 \gset
SELECT pg_temp.a333_upload(816, 701, 'f') AS a333_v6 \gset
SELECT pg_temp.a333_assert((SELECT count(*) = 6 AND bool_and(status = 'submitted' AND current_version_id IS NOT NULL)
  FROM platform.document_slots WHERE id IN (SELECT pg_temp.a333_id(n) FROM generate_series(811, 816) n)),
  'fixture: six slots are submitted through the real ingress');

INSERT INTO platform_private.document_recognition_configs(organization_id, config, registry_version, prompt_policy_version, enabled)
VALUES (pg_temp.a333_id(1),
  '{"enabled":true,"projectId":"synthetic-project","model":"gemini-3.1-flash","configVersion":"synthetic-v1",
    "pricingPolicyVersion":"synthetic-price-v1","paidProjectId":"synthetic-project","paidEligibilityReference":"synthetic-no-billing-proof",
    "perJobBudgetMicros":10000,"dailyOrgBudgetMicros":100000,"inputTokenCeiling":10000,"outputTokenCeiling":6000,
    "inputMicrosPerMillionTokens":100000,"outputMicrosPerMillionTokens":200000}',
  'evo-profile-61-v1', 'synthetic-prompt-v1', TRUE);

-- ---------------------------------------------------------------------------
-- 1. Posture.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a333_assert(
  (SELECT count(*) = 2 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity) FROM pg_class c
    WHERE c.oid IN ('platform_private.document_classification_suggestions'::REGCLASS, 'platform_private.document_classification_resolutions'::REGCLASS))
  AND NOT has_table_privilege('authenticated', 'platform_private.document_classification_suggestions', 'SELECT')
  AND NOT has_table_privilege('service_role', 'platform_private.document_classification_suggestions', 'SELECT')
  AND NOT has_table_privilege('service_role', 'platform_private.document_classification_suggestions', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'platform_private.document_classification_resolutions', 'SELECT')
  AND NOT has_table_privilege('service_role', 'platform_private.document_classification_resolutions', 'INSERT')
  AND NOT has_table_privilege('anon', 'platform_private.document_classification_resolutions', 'SELECT'),
  'posture: both tables closed to every API role with row security forced');
SELECT pg_temp.a333_assert(
  (SELECT count(*) = 4 FROM pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE
    AND p.proname IN ('document_classification_plan_v1', 'document_classification_context_v1', 'document_classification_candidates_v1', 'document_classification_record_v1')
    AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[]
    AND has_function_privilege('service_role', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE'))
  AND (SELECT count(*) = 2 FROM pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE
    AND p.proname IN ('staff_document_suggestions_v1', 'staff_resolve_document_suggestion_v1')
    AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[]
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE'))
  AND (SELECT count(*) = 4 FROM pg_proc p WHERE p.pronamespace = 'platform_private'::REGNAMESPACE
    AND p.proname IN ('doc_class_unsorted', 'doc_class_consent_band', 'doc_class_done', 'document_classification_suggestion_guard')
    AND p.proconfig = ARRAY['search_path=""']::TEXT[]
    AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')),
  'posture: four service functions, two staff functions, four closed helpers; definers with an empty search_path');
-- The consent rule is called, not copied: the three places use the one 320 function.
SELECT pg_temp.a333_assert(
  strpos((SELECT prosrc FROM pg_proc WHERE oid = 'platform_private.doc_class_unsorted(uuid,uuid)'::REGPROCEDURE), 'ai_agent_student_ai_allowed(') > 0
  AND strpos((SELECT prosrc FROM pg_proc WHERE oid = 'platform.staff_document_suggestions_v1(uuid,uuid)'::REGPROCEDURE), 'ai_agent_student_ai_allowed(') > 0,
  'the AI gate is the 320 function in the candidate set and in the staff read');

-- ---------------------------------------------------------------------------
-- 2. The plan (dry run): counts only.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a333_svc(format('SELECT platform.document_classification_plan_v1(%L, FALSE)', pg_temp.a333_id(1))) AS a333_plan \gset
SELECT pg_temp.a333_assert(
  (:'a333_plan'::JSONB) ->> 'unsorted_files' = '4' AND (:'a333_plan'::JSONB) ->> 'unsorted_students' = '4'
  AND (:'a333_plan'::JSONB) ->> 'ai_path_files' = '2' AND (:'a333_plan'::JSONB) ->> 'ai_path_students' = '2'
  AND (:'a333_plan'::JSONB) ->> 'ai_path_students_granted' = '1' AND (:'a333_plan'::JSONB) ->> 'ai_path_students_no_portal' = '1'
  AND (:'a333_plan'::JSONB) ->> 'manual_path_files' = '2' AND (:'a333_plan'::JSONB) ->> 'manual_path_students' = '2'
  AND (:'a333_plan'::JSONB) ->> 'manual_students_declined' = '1' AND (:'a333_plan'::JSONB) ->> 'manual_students_undecided' = '1'
  AND (:'a333_plan'::JSONB) ->> 'to_classify_files' = '2' AND (:'a333_plan'::JSONB) ->> 'already_classified_files' = '0'
  AND NOT (:'a333_plan'::TEXT ~* '[0-9a-f]{8}-[0-9a-f]{4}-'),
  'plan: 4 unsorted files of 4 students (the ordinary-group file, the pending case are not counted); 2 AI path (1 allowed + 1 without portal), 2 manual (1 declined + 1 undecided); no identifier in the answer: ' || :'a333_plan');
SELECT pg_temp.a333_svc(format('SELECT platform.document_classification_plan_v1(%L, TRUE)', pg_temp.a333_id(1))) AS a333_plan_strict \gset
SELECT pg_temp.a333_assert((:'a333_plan_strict'::JSONB) ->> 'ai_path_students' = '1' AND (:'a333_plan_strict'::JSONB) ->> 'ai_path_students_granted' = '1'
  AND (:'a333_plan_strict'::JSONB) ->> 'manual_path_students' = '3' AND (:'a333_plan_strict'::JSONB) ->> 'to_classify_files' = '1',
  'plan, strict flag: only the student who explicitly allowed takes the AI path: ' || :'a333_plan_strict');
SELECT pg_temp.a333_assert(
  pg_temp.a333_err(pg_temp.a333_as(1, format('SELECT platform.document_classification_plan_v1(%L, FALSE)', pg_temp.a333_id(1)))) = '42501'
  AND pg_temp.a333_err(pg_temp.a333_anon(format('SELECT platform.document_classification_plan_v1(%L, FALSE)', pg_temp.a333_id(1)))) = '42501'
  AND pg_temp.a333_err(pg_temp.a333_svc('SELECT platform.document_classification_plan_v1(NULL, FALSE)')) = '22023',
  'plan: refused to staff and anon, bad request 22023');

-- ---------------------------------------------------------------------------
-- 3. Candidates.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a333_svc(format('SELECT platform.document_classification_candidates_v1(%L, 50, FALSE, %L)', pg_temp.a333_id(1), 'run-1')) AS a333_cand \gset
SELECT pg_temp.a333_assert(jsonb_array_length(:'a333_cand'::JSONB) = 2
  AND (SELECT bool_and(e ->> 'bucket_id' = 'platform-documents' AND (e ->> 'object_name') ~ '^[0-9a-f]{2}/[0-9a-f]{62}$' AND e ->> 'mime' = 'image/png')
    FROM jsonb_array_elements(:'a333_cand'::JSONB) e)
  AND (SELECT array_agg(e ->> 'document_version_id' ORDER BY e ->> 'document_version_id') =
      (SELECT array_agg(v::TEXT ORDER BY v::TEXT) FROM (VALUES (:'a333_v1'::UUID), (:'a333_v2'::UUID)) t(v))
    FROM jsonb_array_elements(:'a333_cand'::JSONB) e),
  'candidates: exactly the two AI-path files (no portal, allowed) with their private object; never the declined / undecided / ordinary / pending ones: ' || :'a333_cand');
SELECT pg_temp.a333_assert(
  jsonb_array_length(pg_temp.a333_svc(format('SELECT platform.document_classification_candidates_v1(%L, 1, FALSE, %L)', pg_temp.a333_id(1), 'run-1'))) = 1
  AND jsonb_array_length(pg_temp.a333_svc(format('SELECT platform.document_classification_candidates_v1(%L, 50, TRUE, %L)', pg_temp.a333_id(1), 'run-1'))) = 1
  AND pg_temp.a333_err(pg_temp.a333_svc(format('SELECT platform.document_classification_candidates_v1(%L, 51, FALSE, %L)', pg_temp.a333_id(1), 'run-1'))) = '22023'
  AND pg_temp.a333_err(pg_temp.a333_svc(format('SELECT platform.document_classification_candidates_v1(%L, 0, FALSE, %L)', pg_temp.a333_id(1), 'run-1'))) = '22023'
  AND pg_temp.a333_err(pg_temp.a333_svc(format('SELECT platform.document_classification_candidates_v1(%L, 5, FALSE, %L)', pg_temp.a333_id(1), 'bad run id'))) = '22023'
  AND pg_temp.a333_err(pg_temp.a333_as(1, format('SELECT platform.document_classification_candidates_v1(%L, 5, FALSE, %L)', pg_temp.a333_id(1), 'run-1'))) = '42501'
  AND pg_temp.a333_err(pg_temp.a333_anon(format('SELECT platform.document_classification_candidates_v1(%L, 5, FALSE, %L)', pg_temp.a333_id(1), 'run-1'))) = '42501',
  'candidates: limit bounds, the strict flag, a bad run id, and refusal to staff / anon');
-- A scan that is not clean makes the file not eligible: it is not offered to the provider.
UPDATE platform.document_versions SET malware_status = 'infected' WHERE id = :'a333_v2'::UUID;
SELECT pg_temp.a333_assert(jsonb_array_length(pg_temp.a333_svc(format('SELECT platform.document_classification_candidates_v1(%L, 50, FALSE, %L)', pg_temp.a333_id(1), 'run-1'))) = 1
  AND (pg_temp.a333_svc(format('SELECT platform.document_classification_plan_v1(%L, FALSE)', pg_temp.a333_id(1)))) ->> 'not_readable_files' = '1',
  'candidates: a file without a clean scan proof is not offered (and the plan counts it as not readable)');
UPDATE platform.document_versions SET malware_status = 'clean' WHERE id = :'a333_v2'::UUID;

-- ---------------------------------------------------------------------------
-- 4. Context and record.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a333_svc(format('SELECT platform.document_classification_context_v1(%L)', pg_temp.a333_id(1))) AS a333_ctx \gset
SELECT pg_temp.a333_assert((:'a333_ctx'::JSONB) #>> '{config,model}' = 'gemini-3.1-flash' AND (:'a333_ctx'::JSONB) ->> 'budget_left_micros' = '100000'
  AND NOT (:'a333_ctx'::TEXT ~* 'key|secret|token_value'),
  'context: the same enabled provider config as the 162 queue, the whole daily budget left, no key: ' || :'a333_ctx');
SELECT pg_temp.a333_assert(pg_temp.a333_msg(pg_temp.a333_svc(format('SELECT platform.document_classification_context_v1(%L)', pg_temp.a333_id(2)))) = 'provider_not_configured',
  'context: an organization without an enabled config is provider_not_configured');

CREATE FUNCTION pg_temp.a333_record(p_version UUID, p_status TEXT, p_kind TEXT, p_conf NUMERIC, p_cost BIGINT, p_failure TEXT, p_run TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a333_svc(format('SELECT platform.document_classification_record_v1(%L, %L, %L, %L, %L, %L, %L, %L, 900, 12, %L, %L, %L)',
    pg_temp.a333_id(1), p_version, p_status, p_kind, p_conf, 'gemini-3.1-flash', 'synthetic-project', 'synthetic-v1', p_cost, p_failure, p_run))
$$;
-- Consent is re-checked at write time: undecided and declined are refused with no row; a file outside the group is not a candidate.
SELECT pg_temp.a333_assert(
  pg_temp.a333_err(pg_temp.a333_record(:'a333_v3'::UUID, 'suggested', 'passport', 0.95, 100, NULL, 'run-1')) = '42501'
  AND pg_temp.a333_msg(pg_temp.a333_record(:'a333_v3'::UUID, 'suggested', 'passport', 0.95, 100, NULL, 'run-1')) = 'ai_consent_missing'
  AND pg_temp.a333_msg(pg_temp.a333_record(:'a333_v4'::UUID, 'suggested', 'passport', 0.95, 100, NULL, 'run-1')) = 'ai_consent_missing'
  AND pg_temp.a333_msg(pg_temp.a333_record(:'a333_v6'::UUID, 'suggested', 'passport', 0.95, 100, NULL, 'run-1')) = 'not_candidate'
  AND pg_temp.a333_msg(pg_temp.a333_record(:'a333_v5'::UUID, 'suggested', 'passport', 0.95, 100, NULL, 'run-1')) = 'not_candidate'
  AND (SELECT count(*) = 0 FROM platform_private.document_classification_suggestions)
  AND pg_temp.a333_err(pg_temp.a333_record(:'a333_v1'::UUID, 'suggested', 'driving_licence', 0.95, 100, NULL, 'run-1')) = '23514'
  AND pg_temp.a333_err(pg_temp.a333_as(1, format('SELECT platform.document_classification_record_v1(%L, %L, ''suggested'', ''passport'', 0.9, NULL, NULL, NULL, 1, 1, 1, NULL, ''run-1'')',
    pg_temp.a333_id(1), :'a333_v1'::UUID))) = '42501',
  'record: a declined / undecided student''s file is refused (ai_consent_missing) and leaves no row; ordinary-group and pending-case files are not candidates; unknown kind refused; staff cannot call it');
SELECT pg_temp.a333_record(:'a333_v1'::UUID, 'suggested', 'passport', 0.95, 100, NULL, 'run-1') AS a333_r1 \gset
SELECT pg_temp.a333_record(:'a333_v1'::UUID, 'suggested', 'attestat', 0.99, 100, NULL, 'run-2') AS a333_r1b \gset
SELECT pg_temp.a333_assert((:'a333_r1'::JSONB) ->> 'reason' = 'new' AND (:'a333_r1b'::JSONB) ->> 'reason' = 'exists'
  AND (SELECT count(*) = 1 AND min(kind_key) = 'passport' AND min(confidence) = 0.95 AND min(cost_micros) = 100 AND min(run_id) = 'run-1'
    FROM platform_private.document_classification_suggestions WHERE document_version_id = :'a333_v1'::UUID),
  'record: a repeat is idempotent - one row, the first result stays (never overwritten): ' || :'a333_r1' || :'a333_r1b');
-- Failed rows are retried (attempts + 1) and a successful retry replaces the failure; three failures end the file.
SELECT pg_temp.a333_record(:'a333_v2'::UUID, 'failed', NULL, NULL, 0, 'provider_unavailable', 'run-1') AS a333_f1 \gset
SELECT pg_temp.a333_assert((:'a333_f1'::JSONB) ->> 'reason' = 'new'
  AND jsonb_array_length(pg_temp.a333_svc(format('SELECT platform.document_classification_candidates_v1(%L, 50, FALSE, %L)', pg_temp.a333_id(1), 'run-1'))) = 0
  AND jsonb_array_length(pg_temp.a333_svc(format('SELECT platform.document_classification_candidates_v1(%L, 50, FALSE, %L)', pg_temp.a333_id(1), 'run-2'))) = 1,
  'a failed file is not offered again in the same run, but is offered by the next one');
SELECT pg_temp.a333_record(:'a333_v2'::UUID, 'failed', NULL, NULL, 0, 'provider_unavailable', 'run-2') AS a333_f2 \gset
SELECT pg_temp.a333_record(:'a333_v2'::UUID, 'suggested', 'transcript', 0.5, 40, NULL, 'run-3') AS a333_f3 \gset
SELECT pg_temp.a333_assert((:'a333_f2'::JSONB) ->> 'reason' = 'retried' AND (:'a333_f3'::JSONB) ->> 'reason' = 'retried'
  AND (SELECT status = 'suggested' AND attempts = 3 AND cost_micros = 40 AND kind_key = 'transcript'
    FROM platform_private.document_classification_suggestions WHERE document_version_id = :'a333_v2'::UUID),
  'record: a failed row is retried with attempts 1 -> 3 and a later success replaces the failure');
SELECT pg_temp.a333_assert((pg_temp.a333_record(:'a333_v2'::UUID, 'suggested', 'passport', 0.99, 1, NULL, 'run-4')) ->> 'reason' = 'exists'
  AND (SELECT kind_key = 'transcript' FROM platform_private.document_classification_suggestions WHERE document_version_id = :'a333_v2'::UUID),
  'record: after a result the row is final');
-- The suggestion table refuses to change a result and refuses delete.
DO $a333_immutable$
DECLARE v_state TEXT;
BEGIN
  BEGIN
    UPDATE platform_private.document_classification_suggestions SET kind_key = 'photo' WHERE document_version_id = (SELECT document_version_id FROM platform_private.document_classification_suggestions LIMIT 1);
    RAISE EXCEPTION 'A333: update of a result was allowed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM platform_private.document_classification_suggestions;
    RAISE EXCEPTION 'A333: delete was allowed';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF SQLERRM LIKE 'A333:%' THEN RAISE; END IF;
  END;
END
$a333_immutable$;
SELECT pg_temp.a333_assert(
  (SELECT cost_micros = 140 FROM (SELECT sum(cost_micros) AS cost_micros FROM platform_private.document_classification_suggestions) s)
  AND (pg_temp.a333_svc(format('SELECT platform.document_classification_context_v1(%L)', pg_temp.a333_id(1)))) ->> 'budget_left_micros' = '99860',
  'budget: remaining = daily ceiling - suggestion cost today (100 + 40)');
SELECT pg_temp.a333_assert(jsonb_array_length(pg_temp.a333_svc(format('SELECT platform.document_classification_candidates_v1(%L, 50, FALSE, %L)', pg_temp.a333_id(1), 'run-9'))) = 0
  AND (pg_temp.a333_svc(format('SELECT platform.document_classification_plan_v1(%L, FALSE)', pg_temp.a333_id(1)))) ->> 'already_classified_files' = '2'
  AND (pg_temp.a333_svc(format('SELECT platform.document_classification_plan_v1(%L, FALSE)', pg_temp.a333_id(1)))) ->> 'to_classify_files' = '0',
  'a re-run finds nothing left to classify on the AI path');
-- Case 703: a suggestion written while the student had allowed (owner insert; the batch itself would now refuse, see above).
INSERT INTO platform_private.document_classification_suggestions (id, organization_id, student_case_id, document_slot_id, document_version_id, policy_version, status, kind_key, confidence, run_id)
VALUES (gen_random_uuid(), pg_temp.a333_id(1), pg_temp.a333_id(703), pg_temp.a333_id(813), :'a333_v3'::UUID, 'doc-kind-v1', 'suggested', 'passport', 0.97, 'run-owner');

-- ---------------------------------------------------------------------------
-- 5. The staff read.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a333_as(1, format('SELECT platform.staff_document_suggestions_v1(%L, %L)', pg_temp.a333_id(1), pg_temp.a333_id(701))) AS a333_s701 \gset
SELECT pg_temp.a333_assert((:'a333_s701'::JSONB) ->> 'ai_allowed' = 'true' AND jsonb_array_length((:'a333_s701'::JSONB) -> 'items') = 1
  AND (:'a333_s701'::JSONB) #>> '{items,0,kind_key}' = 'passport' AND (:'a333_s701'::JSONB) #>> '{items,0,status}' = 'suggested'
  AND (:'a333_s701'::JSONB) #>> '{items,0,document_version_id}' = :'a333_v1',
  'staff read: the Admin sees the suggestion of the allowed case: ' || :'a333_s701');
-- Case 703 has a stored suggestion (written while the student had allowed) but the student has not allowed now: hidden, not deleted.
SELECT pg_temp.a333_as(1, format('SELECT platform.staff_document_suggestions_v1(%L, %L)', pg_temp.a333_id(1), pg_temp.a333_id(703))) AS a333_s703 \gset
SELECT pg_temp.a333_assert((:'a333_s703'::JSONB) ->> 'ai_allowed' = 'false' AND jsonb_array_length((:'a333_s703'::JSONB) -> 'items') = 0
  AND (SELECT count(*) = 1 FROM platform_private.document_classification_suggestions WHERE document_version_id = :'a333_v3'::UUID),
  'staff read: no suggestions without the student''s consent (the stored row stays, hidden): ' || :'a333_s703');
SELECT pg_temp.a333_assert(
  pg_temp.a333_err(pg_temp.a333_as(2, format('SELECT platform.staff_document_suggestions_v1(%L, %L)', pg_temp.a333_id(1), pg_temp.a333_id(702)))) = '42501'
  AND pg_temp.a333_err(pg_temp.a333_as(5, format('SELECT platform.staff_document_suggestions_v1(%L, %L)', pg_temp.a333_id(1), pg_temp.a333_id(701)))) = '42501'
  AND pg_temp.a333_err(pg_temp.a333_anon(format('SELECT platform.staff_document_suggestions_v1(%L, %L)', pg_temp.a333_id(1), pg_temp.a333_id(701)))) = '42501'
  AND pg_temp.a333_err(pg_temp.a333_svc(format('SELECT platform.staff_document_suggestions_v1(%L, %L)', pg_temp.a333_id(1), pg_temp.a333_id(701)))) = '42501'
  AND pg_temp.a333_err(pg_temp.a333_as(1, format('SELECT platform.staff_document_suggestions_v1(%L, %L)', pg_temp.a333_id(1), gen_random_uuid()))) = '42501',
  'staff read: refused to a student, another organization''s Admin, anon, service_role; an unknown case is refused too');

-- ---------------------------------------------------------------------------
-- 6. The curator decision, separate from the suggestion.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.a333_resolve(p_actor INTEGER, p_case INTEGER, p_version UUID, p_kind TEXT, p_request INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a333_as(p_actor, format('SELECT platform.staff_resolve_document_suggestion_v1(%L, %L, %L, %L, %L)',
    pg_temp.a333_id(1), pg_temp.a333_id(p_case), p_version, p_kind, pg_temp.a333_id(p_request)))
$$;
SELECT pg_temp.a333_resolve(1, 701, :'a333_v1'::UUID, 'passport', 9001) AS a333_x1 \gset
SELECT pg_temp.a333_resolve(1, 701, :'a333_v1'::UUID, 'passport', 9001) AS a333_x1r \gset
SELECT pg_temp.a333_resolve(1, 701, :'a333_v1'::UUID, 'passport', 9002) AS a333_x1s \gset
SELECT pg_temp.a333_assert((:'a333_x1'::JSONB) ->> 'resolution' = 'accepted_suggestion' AND (:'a333_x1'::JSONB) ->> 'replayed' = 'false'
  AND (:'a333_x1r'::JSONB) ->> 'replayed' = 'true' AND (:'a333_x1s'::JSONB) ->> 'replayed' = 'true'
  AND (SELECT count(*) = 1 FROM platform_private.document_classification_resolutions WHERE document_version_id = :'a333_v1'::UUID)
  AND (SELECT r.suggestion_id = g.id FROM platform_private.document_classification_resolutions r
      JOIN platform_private.document_classification_suggestions g ON g.document_version_id = r.document_version_id WHERE r.document_version_id = :'a333_v1'::UUID)
  AND (SELECT kind_key = 'passport' FROM platform_private.document_classification_suggestions WHERE document_version_id = :'a333_v1'::UUID),
  'decision: accepting the suggestion is recorded once, replays by request id and by version, and the suggestion row is untouched: ' || :'a333_x1');
SELECT pg_temp.a333_assert(pg_temp.a333_err(pg_temp.a333_resolve(1, 701, :'a333_v1'::UUID, 'attestat', 9003)) = '23505'
  AND pg_temp.a333_msg(pg_temp.a333_resolve(1, 701, :'a333_v1'::UUID, 'attestat', 9001)) = 'request_conflict',
  'decision: another kind for a resolved file, or a reused request id with another kind, is a conflict');
-- Corrected: the curator picked another item than the suggestion (case 702: suggestion transcript, curator says attestat).
SELECT pg_temp.a333_resolve(1, 702, :'a333_v2'::UUID, 'attestat', 9004) AS a333_x2 \gset
SELECT pg_temp.a333_assert((:'a333_x2'::JSONB) ->> 'resolution' = 'corrected'
  AND (SELECT kind_key = 'transcript' FROM platform_private.document_classification_suggestions WHERE document_version_id = :'a333_v2'::UUID)
  AND (SELECT chosen_kind_key = 'attestat' FROM platform_private.document_classification_resolutions WHERE document_version_id = :'a333_v2'::UUID),
  'decision: a correction is recorded next to, not over, the suggestion: ' || :'a333_x2');
-- The manual path: a student who declined has no suggestion, the curator still sorts the file.
SELECT pg_temp.a333_resolve(1, 704, :'a333_v4'::UUID, 'medical', 9005) AS a333_x4 \gset
SELECT pg_temp.a333_assert((:'a333_x4'::JSONB) ->> 'resolution' = 'chosen_without_suggestion'
  AND (SELECT suggestion_id IS NULL FROM platform_private.document_classification_resolutions WHERE document_version_id = :'a333_v4'::UUID),
  'decision: the manual path works for a student who declined (no AI involved): ' || :'a333_x4');
SELECT pg_temp.a333_assert(
  pg_temp.a333_err(pg_temp.a333_resolve(2, 702, :'a333_v2'::UUID, 'attestat', 9006)) = '42501'
  AND pg_temp.a333_err(pg_temp.a333_resolve(5, 703, :'a333_v3'::UUID, 'passport', 9007)) = '42501'
  AND pg_temp.a333_err(pg_temp.a333_anon(format('SELECT platform.staff_resolve_document_suggestion_v1(%L, %L, %L, ''passport'', %L)', pg_temp.a333_id(1), pg_temp.a333_id(703), :'a333_v3'::UUID, pg_temp.a333_id(9008)))) = '42501'
  AND pg_temp.a333_err(pg_temp.a333_resolve(1, 703, :'a333_v3'::UUID, 'other', 9009)) = '22023'
  AND pg_temp.a333_err(pg_temp.a333_resolve(1, 703, :'a333_v3'::UUID, 'passport', NULL)) = '22023'
  AND pg_temp.a333_msg(pg_temp.a333_resolve(1, 703, :'a333_v1'::UUID, 'passport', 9010)) = 'document_not_found'
  AND (SELECT count(*) = 3 FROM platform_private.document_classification_resolutions),
  'decision: refused to a student, a foreign Admin, anon; "other" is not a checklist item; a version of another case is not found');
-- Resolved files leave the unsorted set: the plan shrinks and the candidates never return them.
SELECT pg_temp.a333_svc(format('SELECT platform.document_classification_plan_v1(%L, FALSE)', pg_temp.a333_id(1))) AS a333_plan2 \gset
SELECT pg_temp.a333_assert((:'a333_plan2'::JSONB) ->> 'unsorted_files' = '1' AND (:'a333_plan2'::JSONB) ->> 'to_classify_files' = '0',
  'resolved files are no longer unsorted: ' || :'a333_plan2');
DO $a333_resolutions$
BEGIN
  BEGIN
    UPDATE platform_private.document_classification_resolutions SET chosen_kind_key = 'photo';
    RAISE EXCEPTION 'A333: update of a decision was allowed';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'A333:%' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM platform_private.document_classification_resolutions;
    RAISE EXCEPTION 'A333: delete of a decision was allowed';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'A333:%' THEN RAISE; END IF;
  END;
END
$a333_resolutions$;
-- Migration 333 is additive: a second apply refuses (checked by the runner), and nothing of 320 / 162 changed.
SELECT pg_temp.a333_assert(to_regprocedure('platform_private.ai_agent_student_ai_allowed(uuid,uuid)') IS NOT NULL
  AND (SELECT count(*) = 0 FROM platform_private.document_recognition_jobs), 'the 162 queue and the 320 rule are untouched');

\echo A333_DOCUMENT_CLASSIFICATION_SUITE_PASSED
ROLLBACK;
