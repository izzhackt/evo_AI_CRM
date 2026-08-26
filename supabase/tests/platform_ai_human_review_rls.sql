\set ON_ERROR_STOP on
\set ON_ERROR_ROLLBACK on

-- U9 acceptance is entirely synthetic and provider-free. It proves the
-- forward-compatible schema-v2 boundary, service-only completion, exact
-- human-review replay, tenant/scope isolation and zero consequential writes.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'U9 assertion failed: %', p_message;
  END IF;
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.assert_true(BOOLEAN, TEXT)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION pg_temp.u9_external_mutation_counts()
RETURNS JSONB
LANGUAGE SQL
STABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'communication_messages', (
      SELECT pg_catalog.count(*) FROM platform.communication_messages
    ),
    'manual_send_authorizations', (
      SELECT pg_catalog.count(*) FROM platform.manual_send_authorizations
    ),
    'durable_work_items', (
      SELECT pg_catalog.count(*) FROM platform_private.durable_work_items
    ),
    'conversation_handoffs', (
      SELECT pg_catalog.count(*) FROM platform.conversation_handoff_events
    ),
    'case_assignments', (
      SELECT pg_catalog.count(*)
      FROM platform.student_case_assignment_events
    ),
    'case_lifecycle', (
      SELECT pg_catalog.count(*)
      FROM platform.student_case_lifecycle_events
    ),
    'applications', (
      SELECT pg_catalog.count(*) FROM platform.university_application_events
    ),
    'visa', (
      SELECT pg_catalog.count(*) FROM platform.visa_case_events
    ),
    'tasks', (
      SELECT pg_catalog.count(*) FROM platform.case_task_events
    ),
    'documents', (
      SELECT pg_catalog.count(*) FROM platform.document_validation_events
    ),
    'payments', (
      SELECT pg_catalog.count(*) FROM platform.payment_events
    ),
    'finance_stops', (
      SELECT pg_catalog.count(*) FROM platform.stop_factor_events
    )
  )
$$;

-- Exact table/RLS/ACL/function inventory.
SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.array_agg(column_name::TEXT ORDER BY ordinal_position)
    FROM information_schema.columns
    WHERE table_schema = 'platform'
      AND table_name = 'gemini_proposal_reviews'
  ) = ARRAY[
    'id',
    'organization_id',
    'conversation_id',
    'source_message_id',
    'proposal_request_id',
    'proposal_result_id',
    'review_request_id',
    'decision',
    'reviewed_payload',
    'reviewed_payload_sha256',
    'reason',
    'reviewed_by_profile_id',
    'reviewed_by_membership_id',
    'reviewed_by_name',
    'reviewed_at'
  ]::TEXT[],
  'review table column contract drifted'
);

SELECT pg_temp.assert_true(
  (
    SELECT relation.relrowsecurity AND relation.relforcerowsecurity
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'platform'
      AND relation.relname = 'gemini_proposal_reviews'
      AND relation.relkind = 'r'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy AS policy
    WHERE policy.polrelid =
      'platform.gemini_proposal_reviews'::REGCLASS
  )
  AND NOT pg_catalog.has_table_privilege(
    'authenticated',
    'platform.gemini_proposal_reviews',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  AND NOT pg_catalog.has_table_privilege(
    'service_role',
    'platform.gemini_proposal_reviews',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'review table RLS or direct ACL drifted'
);

SELECT pg_temp.assert_true(
  pg_catalog.has_function_privilege(
    'service_role',
    'platform.begin_gemini_proposal(uuid,uuid,uuid,uuid,text,integer,text)',
    'EXECUTE'
  )
  AND pg_catalog.has_function_privilege(
    'service_role',
    'platform.finish_gemini_proposal(uuid,uuid,uuid,uuid,text,text,text,text,text,jsonb)',
    'EXECUTE'
  )
  AND NOT pg_catalog.has_function_privilege(
    'authenticated',
    'platform.begin_gemini_proposal(uuid,uuid,uuid,uuid,text,integer,text)',
    'EXECUTE'
  )
  AND NOT pg_catalog.has_function_privilege(
    'authenticated',
    'platform.finish_gemini_proposal(uuid,uuid,uuid,uuid,text,text,text,text,text,jsonb)',
    'EXECUTE'
  )
  AND pg_catalog.has_function_privilege(
    'authenticated',
    'platform.review_gemini_proposal(uuid,uuid,uuid,uuid,text,jsonb,text)',
    'EXECUTE'
  )
  AND pg_catalog.has_function_privilege(
    'authenticated',
    'platform.staff_gemini_proposal_reviews(uuid,uuid,integer)',
    'EXECUTE'
  )
  AND NOT pg_catalog.has_function_privilege(
    'anon',
    'platform.review_gemini_proposal(uuid,uuid,uuid,uuid,text,jsonb,text)',
    'EXECUTE'
  )
  AND NOT pg_catalog.has_function_privilege(
    'service_role',
    'platform.review_gemini_proposal(uuid,uuid,uuid,uuid,text,jsonb,text)',
    'EXECUTE'
  ),
  'U9 RPC least-privilege ACL drifted'
);

SELECT pg_temp.assert_true(
  (
    SELECT procedure.provolatile = 's'
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.oid =
      'platform.staff_gemini_proposal_reviews(uuid,uuid,integer)'::REGPROCEDURE
  )
  AND (
    SELECT procedure.provolatile = 'v'
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.oid =
      'platform.review_gemini_proposal(uuid,uuid,uuid,uuid,text,jsonb,text)'::REGPROCEDURE
  ),
  'U9 read RPC must be STABLE while its review mutation remains VOLATILE'
);

SELECT pg_temp.assert_true(
  (
    SELECT
      pg_catalog.pg_get_functiondef(procedure.oid)
        LIKE '%platform_private.require_domain_actor_read(%'
      AND pg_catalog.pg_get_functiondef(procedure.oid)
        LIKE '%private.platform_can_read_communication_full(%'
      AND pg_catalog.pg_get_functiondef(procedure.oid)
        NOT LIKE '%platform_private.require_communication_actor(%'
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.oid =
      'platform.staff_gemini_proposal_reviews(uuid,uuid,integer)'::REGPROCEDURE
  ),
  'U9 review history must keep its lock-free PostgREST GET authorization path'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'platform'
      AND procedure.proname IN (
        'begin_gemini_proposal',
        'finish_gemini_proposal',
        'review_gemini_proposal',
        'staff_gemini_proposal_reviews'
      )
      AND (
        NOT procedure.prosecdef
        OR procedure.proconfig IS DISTINCT FROM
          ARRAY['search_path=""']::TEXT[]
      )
  ),
  'U9 RPC SECURITY DEFINER/search_path hardening drifted'
);

SELECT pg_temp.assert_true(
  'ai.proposal.review' = ANY(
    platform_private.p7a_safe_audit_actions()
  )
  AND 'gemini_proposal_review' = ANY(
    platform_private.p7a_safe_audit_resource_types()
  ),
  'U9 review audit is absent from the bounded P7A projection'
);

-- Resolve persistent Platform fixtures created by the earlier authorization
-- migrations/tests. U9 adds only request/result/review rows, all rolled back.
SELECT
  membership.organization_id AS u9_org_b,
  membership.id AS u9_admin_b_membership,
  profile.id AS u9_admin_b_profile,
  profile.access_version AS u9_admin_b_access_version,
  membership.current_bundle_id AS u9_admin_b_bundle,
  bundle.version AS u9_admin_b_bundle_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
JOIN platform.role_bundle_versions AS bundle
  ON bundle.id = membership.current_bundle_id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000008'
\gset

SELECT
  membership.organization_id AS u9_org_a,
  membership.id AS u9_admin_a_membership,
  profile.access_version AS u9_admin_a_access_version,
  membership.current_bundle_id AS u9_admin_a_bundle,
  bundle.version AS u9_admin_a_bundle_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
JOIN platform.role_bundle_versions AS bundle
  ON bundle.id = membership.current_bundle_id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000001'
\gset

SELECT
  conversation.id AS u9_conversation_b,
  latest_message.id AS u9_source_b
FROM platform.communication_conversations AS conversation
JOIN LATERAL (
  SELECT message.id, message.direction
  FROM platform.communication_messages AS message
  WHERE message.organization_id = conversation.organization_id
    AND message.conversation_id = conversation.id
  ORDER BY message.created_at DESC, message.id DESC
  LIMIT 1
) AS latest_message ON latest_message.direction = 'inbound'
WHERE conversation.organization_id = :'u9_org_b'
  AND conversation.status = 'open'
ORDER BY conversation.created_at, conversation.id
LIMIT 1
\gset

SELECT
  membership.organization_id AS u9_inactive_org,
  membership.id AS u9_inactive_membership,
  profile.auth_user_id AS u9_inactive_user,
  profile.access_version AS u9_inactive_access_version,
  membership."current_role"::TEXT AS u9_inactive_role,
  membership.current_bundle_id AS u9_inactive_bundle,
  bundle.version AS u9_inactive_bundle_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
JOIN platform.role_bundle_versions AS bundle
  ON bundle.id = membership.current_bundle_id
WHERE membership.status = 'inactive'
  AND membership."current_role" IS NOT NULL
ORDER BY membership.id
LIMIT 1
\gset

SELECT
  membership.id AS u9_unauthorized_membership,
  profile.auth_user_id AS u9_unauthorized_user,
  profile.access_version AS u9_unauthorized_access_version,
  membership."current_role"::TEXT AS u9_unauthorized_role,
  membership.current_bundle_id AS u9_unauthorized_bundle,
  bundle.version AS u9_unauthorized_bundle_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
JOIN platform.role_bundle_versions AS bundle
  ON bundle.id = membership.current_bundle_id
WHERE membership.organization_id = :'u9_org_b'
  AND membership.status = 'active'
  AND membership."current_role" = 'student'
ORDER BY membership.id
LIMIT 1
\gset

SELECT pg_temp.assert_true(
  :'u9_source_b' <> ''
  AND :'u9_inactive_user' <> ''
  AND :'u9_unauthorized_user' <> '',
  'persistent U9 fixture resolution drifted'
);

SELECT pg_catalog.jsonb_build_object(
  'sub', '10000000-0000-4000-8000-000000000008',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'u9_admin_b_access_version'::BIGINT,
  'platform_organization_id', :'u9_org_b',
  'platform_membership_id', :'u9_admin_b_membership',
  'platform_bundle_id', :'u9_admin_b_bundle',
  'platform_bundle_version', :'u9_admin_b_bundle_version'::BIGINT
)::TEXT AS u9_admin_b_claims
\gset
SELECT pg_catalog.jsonb_build_object(
  'sub', '10000000-0000-4000-8000-000000000001',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'u9_admin_a_access_version'::BIGINT,
  'platform_organization_id', :'u9_org_a',
  'platform_membership_id', :'u9_admin_a_membership',
  'platform_bundle_id', :'u9_admin_a_bundle',
  'platform_bundle_version', :'u9_admin_a_bundle_version'::BIGINT
)::TEXT AS u9_admin_a_claims
\gset
SELECT pg_catalog.jsonb_build_object(
  'sub', :'u9_inactive_user',
  'role', 'authenticated',
  'platform_role', :'u9_inactive_role',
  'platform_access_version', :'u9_inactive_access_version'::BIGINT,
  'platform_organization_id', :'u9_inactive_org',
  'platform_membership_id', :'u9_inactive_membership',
  'platform_bundle_id', :'u9_inactive_bundle',
  'platform_bundle_version', :'u9_inactive_bundle_version'::BIGINT
)::TEXT AS u9_inactive_claims
\gset
SELECT pg_catalog.jsonb_build_object(
  'sub', :'u9_unauthorized_user',
  'role', 'authenticated',
  'platform_role', :'u9_unauthorized_role',
  'platform_access_version', :'u9_unauthorized_access_version'::BIGINT,
  'platform_organization_id', :'u9_org_b',
  'platform_membership_id', :'u9_unauthorized_membership',
  'platform_bundle_id', :'u9_unauthorized_bundle',
  'platform_bundle_version', :'u9_unauthorized_bundle_version'::BIGINT
)::TEXT AS u9_unauthorized_claims
\gset
SELECT pg_catalog.jsonb_build_object(
  'sub', '91000000-0000-4000-8000-00000000ffff',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', 1,
  'platform_organization_id', :'u9_org_b',
  'platform_membership_id', '91000000-0000-4000-8000-00000000ffff',
  'platform_bundle_id', :'u9_admin_b_bundle',
  'platform_bundle_version', :'u9_admin_b_bundle_version'::BIGINT
)::TEXT AS u9_no_membership_claims
\gset

SELECT pg_temp.u9_external_mutation_counts()::TEXT
  AS u9_external_counts_before
\gset

-- Historical v1 validation remains intact, while v2 exactness and all new
-- bounded fields are independently enforced.
SELECT pg_catalog.jsonb_build_object(
  'schema_version', 1,
  'language', 'ru',
  'intent', 'admissions_discovery',
  'confidence', 80,
  'risk', 'low',
  'handoff_required', false,
  'handoff_reasons', '[]'::JSONB,
  'citations', '[]'::JSONB,
  'memory_changes', '[]'::JSONB,
  'qualification', pg_catalog.jsonb_build_object(
    'status', 'collecting',
    'completeness', 20,
    'missing_fact_keys', '[]'::JSONB,
    'notes', NULL
  ),
  'reply_text', 'Исторический синтетический ответ.'
)::TEXT AS u9_v1_payload
\gset

SELECT pg_temp.assert_true(
  platform_private.gemini_proposal_response_v1_is_valid(
    :'u9_v1_payload'::JSONB
  )
  AND platform_private.gemini_proposal_response_is_valid(
    :'u9_v1_payload'::JSONB
  )
  AND NOT platform_private.gemini_proposal_response_v2_is_valid(
    :'u9_v1_payload'::JSONB
  ),
  'historical schema-v1 validation drifted'
);

-- Browser roles cannot start/finish generation or touch the review table.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', :'u9_admin_b_claims', true);
\set ON_ERROR_STOP off
SELECT * FROM platform.begin_gemini_proposal(
  :'u9_org_b',
  :'u9_conversation_b',
  :'u9_source_b',
  '91000000-0000-4000-8000-000000000001',
  'gemini-3.7-flash',
  2,
  'u9-gemini-human-review-v1'
);
\set u9_authenticated_begin_state :SQLSTATE
SELECT * FROM platform.gemini_proposal_reviews;
\set u9_authenticated_table_state :SQLSTATE
UPDATE platform.gemini_proposal_reviews
SET decision = decision
WHERE FALSE;
\set u9_authenticated_update_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"91000000-0000-4000-8000-000000000999","role":"service_role"}',
  true
);
\set ON_ERROR_STOP off
SELECT * FROM platform.gemini_proposal_reviews;
\set u9_service_table_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT pg_temp.assert_true(
  :'u9_authenticated_begin_state' = '42501'
  AND :'u9_authenticated_table_state' = '42501'
  AND :'u9_authenticated_update_state' = '42501'
  AND :'u9_service_table_state' = '42501',
  'service-only generation or direct review-table denial drifted'
);

-- Only the U9 model/schema/prompt bundle may create a new request.
\set ON_ERROR_STOP off
SELECT * FROM platform.begin_gemini_proposal(
  :'u9_org_b',
  :'u9_conversation_b',
  :'u9_source_b',
  '91000000-0000-4000-8000-000000000002',
  'gemini-3.5-flash',
  1,
  'p5f2-consultative-sales-v2'
);
\set u9_historical_begin_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT pg_temp.assert_true(
  :'u9_historical_begin_state' = '22023',
  'new begin accepted the historical model/schema bundle'
);

SELECT * FROM platform.begin_gemini_proposal(
  :'u9_org_b',
  :'u9_conversation_b',
  :'u9_source_b',
  '91000000-0000-4000-8000-000000000010',
  'gemini-3.7-flash',
  2,
  'u9-gemini-human-review-v1'
)
\gset u9_accept_begin_

SELECT pg_temp.assert_true(
  NOT :'u9_accept_begin_replayed'::BOOLEAN
  AND NOT :'u9_accept_begin_completed'::BOOLEAN
  AND (
    SELECT pg_catalog.array_agg(key ORDER BY key)
    FROM pg_catalog.jsonb_object_keys(
      :'u9_accept_begin_context'::JSONB
    ) AS key
  ) = ARRAY[
    'allowed_citations',
    'approved_knowledge',
    'conversation',
    'source_message'
  ]::TEXT[]
  AND pg_catalog.jsonb_array_length(
    :'u9_accept_begin_context'::JSONB -> 'approved_knowledge'
  ) BETWEEN 1 AND 6
  AND pg_catalog.jsonb_array_length(
    :'u9_accept_begin_context'::JSONB -> 'allowed_citations'
  ) BETWEEN 1 AND 6
  AND NOT (:'u9_accept_begin_context'::JSONB ?| ARRAY[
    'recent_messages',
    'memory',
    'retrieval',
    'amocrm',
    'attachments',
    'secrets'
  ]),
  'U9 generation context is not exact, minimal and source-bounded'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(
      :'u9_accept_begin_context'::JSONB -> 'approved_knowledge'
    ) AS knowledge(value)
    WHERE NOT knowledge.value ?& ARRAY[
      'source_ref', 'title', 'content_text'
    ]
      OR knowledge.value - ARRAY[
        'source_ref', 'title', 'content_text'
      ] <> '{}'::JSONB
      OR NOT (
        :'u9_accept_begin_context'::JSONB -> 'allowed_citations'
      ) @> pg_catalog.jsonb_build_array(knowledge.value -> 'source_ref')
  ),
  'approved knowledge and allowed citation references diverged'
);

SELECT pg_catalog.jsonb_build_object(
  'schema_version', 2,
  'language', 'ru',
  'intent', 'admissions_discovery',
  'confidence', 88,
  'risk', 'low',
  'handoff_required', false,
  'handoff_reasons', '[]'::JSONB,
  'citations', pg_catalog.jsonb_build_array(
    :'u9_accept_begin_context'::JSONB -> 'allowed_citations' -> 0
  ),
  'memory_changes', '[]'::JSONB,
  'qualification', pg_catalog.jsonb_build_object(
    'status', 'ready_for_staff_review',
    'completeness', 80,
    'missing_fact_keys', '[]'::JSONB,
    'notes', 'Синтетическая проверка.'
  ),
  'reply_text', 'Здравствуйте! Уточните, пожалуйста, ваши планы.',
  'summary', 'Клиенту нужна консультация по поступлению.',
  'next_action', 'Сотруднику нужно проверить предложение.',
  'draft_internal_note', 'Синтетическая внутренняя заметка.',
  'missing_document_suggestion', NULL,
  'deadline_warning', NULL,
  'limitations', pg_catalog.jsonb_build_array(
    'Ответ основан только на выбранных источниках.'
  ),
  'uncertainty', 'low'
)::TEXT AS u9_valid_payload
\gset

RESET ROLE;
SELECT pg_temp.assert_true(
  platform_private.gemini_proposal_response_v2_is_valid(
    :'u9_valid_payload'::JSONB
  )
  AND platform_private.gemini_proposal_response_is_valid(
    :'u9_valid_payload'::JSONB
  )
  AND NOT platform_private.gemini_proposal_response_v2_is_valid(
    :'u9_valid_payload'::JSONB || '{"extra":true}'::JSONB
  )
  AND NOT platform_private.gemini_proposal_response_v2_is_valid(
    pg_catalog.jsonb_set(
      :'u9_valid_payload'::JSONB,
      '{limitations}',
      '["duplicate","duplicate"]'::JSONB
    )
  )
  AND NOT platform_private.gemini_proposal_response_v2_is_valid(
    pg_catalog.jsonb_set(
      :'u9_valid_payload'::JSONB,
      '{summary}',
      pg_catalog.to_jsonb(pg_catalog.repeat('x', 2001))
    )
  )
  AND NOT platform_private.gemini_proposal_response_v2_is_valid(
    pg_catalog.jsonb_set(
      :'u9_valid_payload'::JSONB,
      '{uncertainty}',
      '7'::JSONB
    )
  ),
  'schema-v2 exact keys, uniqueness, bounds or types drifted'
);
SELECT platform_private.ai_memory_json_sha256(
  :'u9_valid_payload'::JSONB
) AS u9_valid_payload_hash
\gset

SET LOCAL ROLE service_role;
SELECT * FROM platform.finish_gemini_proposal(
  :'u9_org_b',
  :'u9_conversation_b',
  :'u9_source_b',
  :'u9_accept_begin_proposal_request_id',
  'proposal_ready',
  NULL,
  'Synthetic U9 bounded prompt.',
  'synthetic-u9-accept-provider-ref',
  'completed',
  :'u9_valid_payload'::JSONB
)
\gset u9_accept_finish_

SELECT pg_temp.assert_true(
  NOT :'u9_accept_finish_replayed'::BOOLEAN
  AND :'u9_accept_finish_outcome' = 'proposal_ready'
  AND :'u9_accept_finish_human_review_required'::BOOLEAN
  AND NOT :'u9_accept_finish_autonomous_authority'::BOOLEAN
  AND :'u9_accept_finish_provider_proof_state' = 'blocked',
  'successful U9 completion invented autonomy/provider proof'
);

-- Exact completion replay succeeds; authenticated completion remains denied.
SELECT * FROM platform.finish_gemini_proposal(
  :'u9_org_b',
  :'u9_conversation_b',
  :'u9_source_b',
  :'u9_accept_begin_proposal_request_id',
  'proposal_ready',
  NULL,
  'Synthetic U9 bounded prompt.',
  'synthetic-u9-accept-provider-ref',
  'completed',
  :'u9_valid_payload'::JSONB
)
\gset u9_accept_finish_replay_
SELECT pg_temp.assert_true(
  :'u9_accept_finish_replay_replayed'::BOOLEAN,
  'exact service completion did not replay'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', :'u9_admin_b_claims', true);
SELECT pg_catalog.to_jsonb(proposal.*)::TEXT AS u9_staff_proposal_json
FROM platform.staff_gemini_proposal(
  :'u9_org_b',
  :'u9_conversation_b'
) AS proposal
\gset
SELECT pg_temp.assert_true(
  :'u9_staff_proposal_json'::JSONB ->> 'schema_version' = '2'
  AND :'u9_staff_proposal_json'::JSONB ->> 'summary' =
    :'u9_valid_payload'::JSONB ->> 'summary'
  AND :'u9_staff_proposal_json'::JSONB ->> 'next_action' =
    :'u9_valid_payload'::JSONB ->> 'next_action'
  AND :'u9_staff_proposal_json'::JSONB ->> 'draft_internal_note' =
    :'u9_valid_payload'::JSONB ->> 'draft_internal_note'
  AND :'u9_staff_proposal_json'::JSONB -> 'missing_document_suggestion' =
    :'u9_valid_payload'::JSONB -> 'missing_document_suggestion'
  AND :'u9_staff_proposal_json'::JSONB -> 'deadline_warning' =
    :'u9_valid_payload'::JSONB -> 'deadline_warning'
  AND :'u9_staff_proposal_json'::JSONB -> 'limitations' =
    :'u9_valid_payload'::JSONB -> 'limitations'
  AND :'u9_staff_proposal_json'::JSONB ->> 'uncertainty' =
    :'u9_valid_payload'::JSONB ->> 'uncertainty'
  AND NOT :'u9_staff_proposal_json' ~
    'prompt|provider_interaction|response_json|sha256|secret|token',
  'staff proposal projection lost U9 fields or leaked private evidence'
);
\set ON_ERROR_STOP off
SELECT * FROM platform.finish_gemini_proposal(
  :'u9_org_b',
  :'u9_conversation_b',
  :'u9_source_b',
  :'u9_accept_begin_proposal_request_id',
  'proposal_ready',
  NULL,
  'Synthetic U9 bounded prompt.',
  'synthetic-u9-accept-provider-ref',
  'completed',
  :'u9_valid_payload'::JSONB
);
\set u9_authenticated_finish_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;
SELECT pg_temp.assert_true(
  :'u9_authenticated_finish_state' = '42501',
  'authenticated actor completed a provider result'
);

-- Prepare a second proposal. A structurally valid invented citation is still
-- rejected by the exact allowed-citation set before a correct finish succeeds.
SET LOCAL ROLE service_role;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"91000000-0000-4000-8000-000000000999","role":"service_role"}',
  true
);
SELECT * FROM platform.begin_gemini_proposal(
  :'u9_org_b', :'u9_conversation_b', :'u9_source_b',
  '91000000-0000-4000-8000-000000000020',
  'gemini-3.7-flash', 2, 'u9-gemini-human-review-v1'
)
\gset u9_edit_begin_
SELECT pg_catalog.jsonb_set(
  :'u9_valid_payload'::JSONB,
  '{citations}',
  '[{"knowledge_key":"invented.source","knowledge_version":1,"evidence_ordinal":1}]'::JSONB
)::TEXT AS u9_unknown_citation_payload
\gset
\set ON_ERROR_STOP off
SELECT * FROM platform.finish_gemini_proposal(
  :'u9_org_b', :'u9_conversation_b', :'u9_source_b',
  :'u9_edit_begin_proposal_request_id',
  'proposal_ready', NULL, 'Synthetic U9 edit prompt.',
  'synthetic-u9-edit-provider-ref', 'completed',
  :'u9_unknown_citation_payload'::JSONB
);
\set u9_unknown_citation_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT pg_temp.assert_true(
  :'u9_unknown_citation_state' = '22023',
  'invented citation escaped exact source grounding'
);
SELECT * FROM platform.finish_gemini_proposal(
  :'u9_org_b', :'u9_conversation_b', :'u9_source_b',
  :'u9_edit_begin_proposal_request_id',
  'proposal_ready', NULL, 'Synthetic U9 edit prompt.',
  'synthetic-u9-edit-provider-ref', 'completed',
  :'u9_valid_payload'::JSONB
);

SELECT * FROM platform.begin_gemini_proposal(
  :'u9_org_b', :'u9_conversation_b', :'u9_source_b',
  '91000000-0000-4000-8000-000000000030',
  'gemini-3.7-flash', 2, 'u9-gemini-human-review-v1'
)
\gset u9_reject_begin_
SELECT * FROM platform.finish_gemini_proposal(
  :'u9_org_b', :'u9_conversation_b', :'u9_source_b',
  :'u9_reject_begin_proposal_request_id',
  'proposal_ready', NULL, 'Synthetic U9 reject prompt.',
  'synthetic-u9-reject-provider-ref', 'completed',
  :'u9_valid_payload'::JSONB
);

SELECT * FROM platform.begin_gemini_proposal(
  :'u9_org_b', :'u9_conversation_b', :'u9_source_b',
  '91000000-0000-4000-8000-000000000040',
  'gemini-3.7-flash', 2, 'u9-gemini-human-review-v1'
)
\gset u9_blocked_begin_
SELECT * FROM platform.finish_gemini_proposal(
  :'u9_org_b', :'u9_conversation_b', :'u9_source_b',
  :'u9_blocked_begin_proposal_request_id',
  'human_review', 'privacy_not_approved',
  'Synthetic U9 blocked prompt.', NULL, 'not_called', NULL
)
\gset u9_blocked_finish_
SELECT pg_temp.assert_true(
  :'u9_blocked_finish_outcome' = 'human_review'
  AND :'u9_blocked_finish_failure_code' = 'privacy_not_approved',
  'truthful U9 blocked outcome drifted'
);
RESET ROLE;

-- Accept stores the immutable generated payload and exact hash. Exact request
-- replay returns the same row; changed replay and a second final review fail.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', :'u9_admin_b_claims', true);
SELECT pg_catalog.to_jsonb(review.*)::TEXT AS u9_accept_review_json
FROM platform.review_gemini_proposal(
  :'u9_org_b', :'u9_conversation_b',
  :'u9_accept_begin_proposal_request_id',
  '91000000-0000-4000-8000-000000000110',
  'accepted', NULL, NULL
) AS review
\gset
SELECT pg_catalog.to_jsonb(review.*)::TEXT AS u9_accept_replay_json
FROM platform.review_gemini_proposal(
  :'u9_org_b', :'u9_conversation_b',
  :'u9_accept_begin_proposal_request_id',
  '91000000-0000-4000-8000-000000000110',
  'accepted', :'u9_valid_payload'::JSONB, NULL
) AS review
\gset
SELECT pg_temp.assert_true(
  NOT (:'u9_accept_review_json'::JSONB ->> 'replayed')::BOOLEAN
  AND (:'u9_accept_replay_json'::JSONB ->> 'replayed')::BOOLEAN
  AND :'u9_accept_review_json'::JSONB -> 'reviewed_payload' =
    :'u9_valid_payload'::JSONB
  AND :'u9_accept_review_json'::JSONB ->> 'reviewed_payload_sha256' =
    :'u9_valid_payload_hash'
  AND :'u9_accept_review_json'::JSONB ->> 'review_id' =
    :'u9_accept_replay_json'::JSONB ->> 'review_id',
  'Accept or exact review replay drifted'
);

\set ON_ERROR_STOP off
SELECT * FROM platform.review_gemini_proposal(
  :'u9_org_b', :'u9_conversation_b',
  :'u9_accept_begin_proposal_request_id',
  '91000000-0000-4000-8000-000000000110',
  'accepted', NULL, 'different replay reason'
);
\set u9_review_replay_mismatch_state :SQLSTATE
SELECT * FROM platform.review_gemini_proposal(
  :'u9_org_b', :'u9_conversation_b',
  :'u9_accept_begin_proposal_request_id',
  '91000000-0000-4000-8000-000000000111',
  'rejected', NULL, 'Second final review is forbidden'
);
\set u9_second_final_review_state :SQLSTATE
\set ON_ERROR_STOP on

-- Edit may change semantic content but never the immutable citations.
SELECT pg_catalog.jsonb_set(
  pg_catalog.jsonb_set(
    :'u9_valid_payload'::JSONB,
    '{summary}',
    pg_catalog.to_jsonb('Сотрудник уточнил резюме.'::TEXT)
  ),
  '{reply_text}',
  pg_catalog.to_jsonb('Отредактированный сотрудником ответ.'::TEXT)
)::TEXT AS u9_edited_payload
\gset
\set ON_ERROR_STOP off
SELECT * FROM platform.review_gemini_proposal(
  :'u9_org_b', :'u9_conversation_b',
  :'u9_edit_begin_proposal_request_id',
  '91000000-0000-4000-8000-000000000120',
  'edited', :'u9_unknown_citation_payload'::JSONB, NULL
);
\set u9_edit_citation_state :SQLSTATE
SELECT * FROM platform.review_gemini_proposal(
  :'u9_org_b', :'u9_conversation_b',
  :'u9_edit_begin_proposal_request_id',
  '91000000-0000-4000-8000-000000000121',
  'edited',
  pg_catalog.jsonb_set(:'u9_edited_payload'::JSONB, '{risk}', '"high"'),
  NULL
);
\set u9_edit_model_evidence_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT pg_catalog.to_jsonb(review.*)::TEXT AS u9_edit_review_json
FROM platform.review_gemini_proposal(
  :'u9_org_b', :'u9_conversation_b',
  :'u9_edit_begin_proposal_request_id',
  '91000000-0000-4000-8000-000000000121',
  'edited', :'u9_edited_payload'::JSONB, NULL
) AS review
\gset
SELECT pg_temp.assert_true(
  :'u9_edit_citation_state' = '22023'
  AND :'u9_edit_model_evidence_state' = '22023'
  AND :'u9_edit_review_json'::JSONB ->> 'decision' = 'edited'
  AND :'u9_edit_review_json'::JSONB -> 'reviewed_payload' =
    :'u9_edited_payload'::JSONB
  AND :'u9_edit_review_json'::JSONB -> 'reviewed_payload' -> 'citations' =
    :'u9_valid_payload'::JSONB -> 'citations',
  'Edit validation or immutable model-evidence preservation drifted'
);

-- Reject carries no reviewed payload/hash and requires a normalized reason.
\set ON_ERROR_STOP off
SELECT * FROM platform.review_gemini_proposal(
  :'u9_org_b', :'u9_conversation_b',
  :'u9_reject_begin_proposal_request_id',
  '91000000-0000-4000-8000-000000000130',
  'rejected', NULL, NULL
);
\set u9_reject_without_reason_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT pg_catalog.to_jsonb(review.*)::TEXT AS u9_reject_review_json
FROM platform.review_gemini_proposal(
  :'u9_org_b', :'u9_conversation_b',
  :'u9_reject_begin_proposal_request_id',
  '91000000-0000-4000-8000-000000000131',
  'rejected', NULL, 'Недостаточно подтвержденных данных'
) AS review
\gset
SELECT pg_temp.assert_true(
  :'u9_reject_without_reason_state' = '22023'
  AND :'u9_reject_review_json'::JSONB ->> 'decision' = 'rejected'
  AND :'u9_reject_review_json'::JSONB -> 'reviewed_payload' = 'null'::JSONB
  AND :'u9_reject_review_json'::JSONB -> 'reviewed_payload_sha256' =
    'null'::JSONB
  AND :'u9_reject_review_json'::JSONB ->> 'reason' =
    'Недостаточно подтвержденных данных',
  'Reject payload or mandatory reason contract drifted'
);

\set ON_ERROR_STOP off
SELECT * FROM platform.review_gemini_proposal(
  :'u9_org_b', :'u9_conversation_b',
  :'u9_blocked_begin_proposal_request_id',
  '91000000-0000-4000-8000-000000000140',
  'rejected', NULL, 'Blocked outcome cannot be reviewed'
);
\set u9_blocked_review_state :SQLSTATE
SELECT * FROM platform.staff_gemini_proposal_reviews(
  :'u9_org_b', :'u9_conversation_b', 0
);
\set u9_zero_limit_state :SQLSTATE
SELECT * FROM platform.staff_gemini_proposal_reviews(
  :'u9_org_b', :'u9_conversation_b', 51
);
\set u9_large_limit_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT pg_temp.assert_true(
  :'u9_review_replay_mismatch_state' = '22023'
  AND :'u9_second_final_review_state' = '55000'
  AND :'u9_blocked_review_state' = '55000'
  AND :'u9_zero_limit_state' = '22023'
  AND :'u9_large_limit_state' = '22023',
  'review finality, blocked-state or bounded-read rejection drifted'
);

SELECT pg_catalog.count(*)::TEXT AS u9_staff_review_count
FROM platform.staff_gemini_proposal_reviews(
  :'u9_org_b', :'u9_conversation_b', 20
)
\gset
SELECT pg_catalog.count(*)::TEXT AS u9_staff_review_limit_count
FROM platform.staff_gemini_proposal_reviews(
  :'u9_org_b', :'u9_conversation_b', 2
)
\gset
SELECT pg_temp.assert_true(
  :'u9_staff_review_count' = '3'
  AND :'u9_staff_review_limit_count' = '2'
  AND NOT EXISTS (
    SELECT 1
    FROM platform.staff_gemini_proposal_reviews(
      :'u9_org_b', :'u9_conversation_b', 20
    ) AS review
    WHERE NOT pg_catalog.to_jsonb(review) ?& ARRAY[
      'review_id',
      'proposal_request_id',
      'decision',
      'reviewed_payload',
      'reviewed_payload_sha256',
      'reason',
      'reviewed_by_membership_id',
      'reviewed_by_name',
      'reviewed_at'
    ]
      OR pg_catalog.to_jsonb(review) - ARRAY[
        'review_id',
        'proposal_request_id',
        'decision',
        'reviewed_payload',
        'reviewed_payload_sha256',
        'reason',
        'reviewed_by_membership_id',
        'reviewed_by_name',
        'reviewed_at'
      ] <> '{}'::JSONB
  ),
  'bounded staff review history shape or limit drifted'
);
RESET ROLE;

-- Cross-organization, inactive and unauthorized authenticated actors fail
-- before any review history can be enumerated.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', :'u9_admin_a_claims', true);
\set ON_ERROR_STOP off
SELECT * FROM platform.staff_gemini_proposal_reviews(
  :'u9_org_b', :'u9_conversation_b', 20
);
\set u9_cross_org_read_state :SQLSTATE
SELECT * FROM platform.review_gemini_proposal(
  :'u9_org_b', :'u9_conversation_b',
  :'u9_accept_begin_proposal_request_id',
  '91000000-0000-4000-8000-000000000150',
  'accepted', NULL, NULL
);
\set u9_cross_org_review_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', :'u9_inactive_claims', true);
\set ON_ERROR_STOP off
SELECT * FROM platform.staff_gemini_proposal_reviews(
  :'u9_inactive_org',
  '91000000-0000-4000-8000-00000000eeee',
  20
);
\set u9_inactive_read_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', :'u9_unauthorized_claims', true);
\set ON_ERROR_STOP off
SELECT * FROM platform.staff_gemini_proposal_reviews(
  :'u9_org_b', :'u9_conversation_b', 20
);
\set u9_unauthorized_read_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', :'u9_no_membership_claims', true);
\set ON_ERROR_STOP off
SELECT * FROM platform.staff_gemini_proposal_reviews(
  :'u9_org_b', :'u9_conversation_b', 20
);
\set u9_no_membership_read_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'u9_cross_org_read_state' = '42501'
  AND :'u9_cross_org_review_state' = '42501'
  AND :'u9_inactive_read_state' = '42501'
  AND :'u9_unauthorized_read_state' = '42501'
  AND :'u9_no_membership_read_state' = '42501',
  'cross-org, inactive or unauthorized review isolation drifted'
);

-- Each committed review has one safe audit event. Provider payloads never
-- enter audit after_state, and generated provider results remain immutable.
SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*)
    FROM platform.audit_events AS event
    WHERE event.request_id IN (
      '91000000-0000-4000-8000-000000000110',
      '91000000-0000-4000-8000-000000000121',
      '91000000-0000-4000-8000-000000000131'
    )
      AND event.action = 'ai.proposal.review'
      AND event.resource_type = 'gemini_proposal_review'
      AND event.actor_kind = 'user'
      AND event.after_state ?& ARRAY[
        'review_id',
        'proposal_request_id',
        'proposal_result_id',
        'conversation_id',
        'decision',
        'reviewed_payload_sha256',
        'reviewed_by_membership_id'
      ]
      AND NOT event.after_state ?| ARRAY[
        'reviewed_payload',
        'private_prompt_text',
        'private_provider_interaction_ref',
        'customer_text'
      ]
  ) = 3
  AND (
    SELECT result.private_response_json = :'u9_valid_payload'::JSONB
      AND result.response_sha256 =
        :'u9_valid_payload_hash'
    FROM platform_private.gemini_proposal_results AS result
    WHERE result.organization_id = :'u9_org_b'
      AND result.proposal_request_id =
        :'u9_accept_begin_proposal_request_id'
  ),
  'append-only review audit or immutable provider result drifted'
);

SELECT pg_temp.assert_true(
  pg_temp.u9_external_mutation_counts() =
    :'u9_external_counts_before'::JSONB,
  'U9 generation/review created an external or operational mutation'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.regexp_count(
      pg_catalog.lower(pg_catalog.pg_get_functiondef(procedure.oid)),
      'insert into'
    ) = 2
      AND pg_catalog.lower(pg_catalog.pg_get_functiondef(procedure.oid))
        !~ '(manual_send_authorizations|communication_messages|durable_work_items|conversation_handoff_events|student_case_assignment_events|student_case_lifecycle_events|university_application_events|visa_case_events|case_task_events|document_validation_events|payment_events|stop_factor_events)'
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'platform'
      AND procedure.proname = 'review_gemini_proposal'
  ),
  'review RPC mutation source contract expanded beyond review plus audit'
);

-- Even the owner cannot rewrite or truncate committed review evidence.
\set ON_ERROR_STOP off
UPDATE platform.gemini_proposal_reviews
SET decision = decision
WHERE id = (:'u9_accept_review_json'::JSONB ->> 'review_id')::UUID;
\set u9_owner_update_state :SQLSTATE
DELETE FROM platform.gemini_proposal_reviews
WHERE id = (:'u9_accept_review_json'::JSONB ->> 'review_id')::UUID;
\set u9_owner_delete_state :SQLSTATE
TRUNCATE TABLE platform.gemini_proposal_reviews;
\set u9_owner_truncate_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT pg_temp.assert_true(
  :'u9_owner_update_state' = '55000'
  AND :'u9_owner_delete_state' = '55000'
  AND :'u9_owner_truncate_state' = '55000',
  'append-only review owner guard drifted'
);

ROLLBACK;
\set ON_ERROR_ROLLBACK off

SELECT 'platform U9 Gemini human-review RLS passed' AS result;
