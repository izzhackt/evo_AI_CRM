#!/usr/bin/env bash

set -Eeuo pipefail

export LC_ALL=C
umask 077

readonly DATABASE_CONTAINER="${1:?database container name is required}"
readonly DATABASE_NAME="${2:?database name is required}"
readonly TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/evo-p2g-queues.XXXXXX")"

cleanup() {
  local exit_code=$?

  trap - EXIT HUP INT TERM
  rm -rf -- "${TEMP_DIR}"
  exit "${exit_code}"
}

trap cleanup EXIT HUP INT TERM

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

assert_equal() {
  local expected=$1
  local actual=$2
  local message=$3

  [[ "${actual}" == "${expected}" ]] \
    || fail "${message}: expected ${expected}, found ${actual}"
}

admin_query() {
  local sql=$1

  docker exec "${DATABASE_CONTAINER}" \
    psql \
    -X \
    -qAt \
    -v ON_ERROR_STOP=1 \
    -U postgres \
    -d "${DATABASE_NAME}" \
    -c "${sql}"
}

service_query() {
  local sql=$1

  admin_query "
    SET request.jwt.claims = '{\"role\":\"service_role\"}';
    SET ROLE service_role;
    ${sql}
    RESET ROLE;
  "
}

claim_fields() {
  local visibility_timeout=$1
  local worker_ref=$2
  local request_id=$3

  service_query "
    WITH response AS (
      SELECT platform.claim_durable_work(
        ${visibility_timeout},
        '${worker_ref}',
        '${request_id}'
      ) AS body
    )
    SELECT concat_ws(
      '|',
      body ->> 'claimed',
      body ->> 'work_item_id',
      body ->> 'attempt_id',
      body ->> 'queue_message_id',
      body ->> 'queue_read_count'
    )
    FROM response;
  "
}

finish_work() {
  local work_item_id=$1
  local attempt_id=$2
  local outcome=$3
  local error_code=$4
  local evidence_ref=$5
  local retry_delay=$6
  local request_id=$7
  local error_sql="NULL"
  local retry_sql="NULL"

  [[ -z "${error_code}" ]] \
    || error_sql="'${error_code}'"
  [[ -z "${retry_delay}" ]] \
    || retry_sql="${retry_delay}"

  service_query "
    SELECT platform.finish_durable_work(
      '${work_item_id}',
      '${attempt_id}',
      '${outcome}'::platform.durable_work_finish_outcome,
      ${error_sql},
      '${evidence_ref}',
      ${retry_sql},
      '${request_id}'
    );
  " >/dev/null
}

enqueue_webhook() {
  local event_id=$1
  local business_key_digit=$2
  local max_attempts=$3
  local request_id=$4

  service_query "
    SELECT platform.enqueue_verified_webhook_work(
      '45990000-0000-4000-8000-000000000001',
      '${event_id}',
      repeat('${business_key_digit}', 64),
      ${max_attempts},
      '${request_id}'
    );
  "
}

command -v docker >/dev/null 2>&1 \
  || fail "Docker is required for the real PGMQ runtime gate"
docker inspect "${DATABASE_CONTAINER}" >/dev/null 2>&1 \
  || fail "Database container ${DATABASE_CONTAINER} is unavailable"

runtime_ready="$(
  admin_query "
    SELECT (
      to_regprocedure(
        'platform.enqueue_verified_webhook_work(uuid,uuid,text,integer,uuid)'
      ) IS NOT NULL
      AND to_regprocedure(
        'platform.enqueue_manual_whatsapp_send(uuid,uuid,text,integer,uuid)'
      ) IS NOT NULL
      AND to_regprocedure(
        'platform.claim_durable_work(integer,text,uuid)'
      ) IS NOT NULL
      AND to_regprocedure(
        'platform.finish_durable_work(uuid,uuid,platform.durable_work_finish_outcome,text,text,integer,uuid)'
      ) IS NOT NULL
      AND to_regclass('pgmq.q_platform_work_v1') IS NOT NULL
      AND to_regclass('pgmq.a_platform_work_v1') IS NOT NULL
      AND to_regclass('pgmq.q_platform_dead_letter_v1') IS NOT NULL
    )::TEXT;
  "
)"
assert_equal "true" "${runtime_ready}" "P2G migration/PGMQ runtime surface is incomplete"

browser_boundary="$(
  admin_query "
    SELECT (
      NOT has_schema_privilege('anon', 'pgmq', 'USAGE')
      AND NOT has_schema_privilege('authenticated', 'pgmq', 'USAGE')
      AND NOT has_schema_privilege('service_role', 'pgmq', 'USAGE')
      AND NOT has_schema_privilege('anon', 'platform_private', 'USAGE')
      AND NOT has_schema_privilege('authenticated', 'platform_private', 'USAGE')
      AND COALESCE(
        NOT has_schema_privilege(
          'service_role',
          to_regnamespace('pgmq_public'),
          'USAGE'
        ),
        TRUE
      )
      AND COALESCE(
        NOT has_table_privilege(
          'service_role',
          to_regclass('pgmq_public.queue_probe'),
          'SELECT'
        ),
        TRUE
      )
      AND COALESCE(
        NOT has_function_privilege(
          'service_role',
          to_regprocedure('pgmq_public.queue_probe()'),
          'EXECUTE'
        ),
        TRUE
      )
      AND NOT has_function_privilege(
        'anon',
        'platform.claim_durable_work(integer,text,uuid)',
        'EXECUTE'
      )
      AND NOT has_function_privilege(
        'authenticated',
        'platform.claim_durable_work(integer,text,uuid)',
        'EXECUTE'
      )
      AND has_function_privilege(
        'service_role',
        'platform.claim_durable_work(integer,text,uuid)',
        'EXECUTE'
      )
    )::TEXT;
  "
)"
assert_equal "true" "${browser_boundary}" "Browser/direct-PGMQ grants are not fail-closed"

if admin_query "
  SET ROLE authenticated;
  SELECT * FROM pgmq.read('platform_work_v1', 1, 1, '{}'::JSONB);
" >"${TEMP_DIR}/unexpected-browser-output.log" 2>&1; then
  fail "authenticated invoked pgmq.read directly"
fi

if [[ "$(
  admin_query "
    SELECT (to_regprocedure('pgmq_public.queue_probe()') IS NOT NULL)::TEXT;
  "
)" == "true" ]]; then
  if admin_query "
    SET request.jwt.claims = '{\"role\":\"service_role\"}';
    SET ROLE service_role;
    SELECT pgmq_public.queue_probe();
  " >"${TEMP_DIR}/unexpected-legacy-queue-output.log" 2>&1; then
    fail "service_role retained direct access to the legacy pgmq_public surface"
  fi
fi

active_before="$(
  admin_query "SELECT count(*) FROM pgmq.q_platform_work_v1;"
)"
assert_equal "0" "${active_before}" "P2G runtime gate requires an empty active work queue"

docker exec -i "${DATABASE_CONTAINER}" \
  psql \
  -X \
  -q \
  -v ON_ERROR_STOP=1 \
  -U postgres \
  -d "${DATABASE_NAME}" <<'SQL'
BEGIN;
SET CONSTRAINTS ALL DEFERRED;

SELECT EXISTS (
  SELECT 1
  FROM information_schema.columns
  WHERE table_schema = 'platform'
    AND table_name = 'manual_send_authorizations'
    AND column_name = 'source_message_id'
) AS has_p3c_source_message_column
\gset

SELECT (
  to_regprocedure(
    'platform.publish_ai_prompt_artifact_version(uuid,platform.ai_prompt_artifact_kind,text,text,text,text,uuid)'
  ) IS NOT NULL
  AND to_regclass('platform.ai_draft_request_prompt_selections') IS NOT NULL
) AS has_bw4_prompt_lifecycle
\gset

INSERT INTO platform.organizations (id, name)
VALUES (
  '45990000-0000-4000-8000-000000000001',
  'P2G disposable runtime organization'
);

INSERT INTO platform_private.provider_webhook_events (
  id,
  organization_id,
  provider,
  provider_account_ref,
  provider_request_id,
  waha_session_name,
  payload_id,
  event_type,
  provider_occurred_at,
  verification_status,
  raw_payload,
  verification_headers,
  verification_evidence_ref,
  payload_sha256,
  request_id
)
SELECT
  (
    '45991000-0000-4000-8000-'
      || lpad(sequence_number::TEXT, 12, '0')
  )::UUID,
  '45990000-0000-4000-8000-000000000001'::UUID,
  'waha'::platform.communication_provider,
  'synthetic:p2g:runtime:' || sequence_number,
  'synthetic-request-' || sequence_number,
  'crm_primary',
  'synthetic-payload-' || sequence_number,
  'message',
  statement_timestamp(),
  'verified'::platform.webhook_verification_status,
  jsonb_build_object(
    'event', 'message',
    'session', 'crm_primary',
    'payload', jsonb_build_object(
      'id', 'synthetic-payload-' || sequence_number,
      'timestamp', 1786075200 + sequence_number,
      'from', '1415555000' || sequence_number || '@c.us',
      'chatId', '1415555000' || sequence_number || '@c.us',
      'fromMe', FALSE,
      'source', 'app',
      'body', 'Synthetic P2G runtime message ' || sequence_number
    ),
    'synthetic', TRUE,
    'sequence', sequence_number
  ),
  '{}'::JSONB,
  'local:p2g:runtime',
  encode(
    sha256(
      convert_to(
        'synthetic-p2g-payload-' || sequence_number,
        'UTF8'
      )
    ),
    'hex'
  ),
  (
    '45992000-0000-4000-8000-'
      || lpad(sequence_number::TEXT, 12, '0')
  )::UUID
FROM generate_series(1, 8) AS sequence_number;

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  (
    '45993000-0000-4000-8000-000000000001',
    'p2g-runtime@example.invalid',
    '{"display_name":"P2G Runtime"}'::JSONB
  ),
  (
    '45993000-0000-4000-8000-000000000021',
    'p2g-runtime-admin@example.invalid',
    '{"display_name":"P2G Runtime Admin"}'::JSONB
  );

INSERT INTO platform.profiles (
  id,
  auth_user_id,
  display_name
)
VALUES (
  '45993000-0000-4000-8000-000000000002',
  '45993000-0000-4000-8000-000000000001',
  'P2G Runtime'
);

INSERT INTO platform.profiles (
  id,
  auth_user_id,
  display_name
)
VALUES (
  '45993000-0000-4000-8000-000000000022',
  '45993000-0000-4000-8000-000000000021',
  'P2G Runtime Admin'
);

INSERT INTO platform.organization_memberships (
  id,
  organization_id,
  profile_id,
  status,
  "current_role",
  current_bundle_id
)
SELECT
  '45993000-0000-4000-8000-000000000003',
  '45990000-0000-4000-8000-000000000001',
  '45993000-0000-4000-8000-000000000002',
  'active',
  'sales',
  bundle.id
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'sales'
  AND bundle.status = 'published'
ORDER BY bundle.version DESC
LIMIT 1;

INSERT INTO platform.organization_memberships (
  id,
  organization_id,
  profile_id,
  status,
  "current_role",
  current_bundle_id
)
SELECT
  '45993000-0000-4000-8000-000000000023',
  '45990000-0000-4000-8000-000000000001',
  '45993000-0000-4000-8000-000000000022',
  'active',
  'admin',
  bundle.id
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'admin'
  AND bundle.status = 'published'
ORDER BY bundle.version DESC
LIMIT 1;

INSERT INTO platform.membership_role_history (
  organization_id,
  membership_id,
  profile_id,
  role_version,
  previous_role,
  new_role,
  previous_bundle_id,
  new_bundle_id,
  actor_kind,
  actor_profile_id,
  reason,
  request_id
)
SELECT
  '45990000-0000-4000-8000-000000000001',
  '45993000-0000-4000-8000-000000000023',
  '45993000-0000-4000-8000-000000000022',
  1,
  NULL,
  'admin',
  NULL,
  bundle.id,
  'system',
  NULL,
  'P2G disposable runtime Admin fixture',
  '45993000-0000-4000-8000-000000000121'
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'admin'
  AND bundle.status = 'published'
ORDER BY bundle.version DESC
LIMIT 1;

INSERT INTO platform.record_scopes (
  id,
  organization_id,
  scope_kind,
  scope_key,
  scope_version
)
VALUES (
  '45993000-0000-4000-8000-000000000004',
  '45990000-0000-4000-8000-000000000001',
  'organization',
  '45990000-0000-4000-8000-000000000001',
  1
);

INSERT INTO platform.membership_scope_assignments (
  organization_id,
  membership_id,
  scope_id,
  scope_version,
  assignment_version,
  granted,
  actor_kind,
  actor_profile_id,
  reason,
  request_id
)
VALUES (
  '45990000-0000-4000-8000-000000000001',
  '45993000-0000-4000-8000-000000000023',
  '45993000-0000-4000-8000-000000000004',
  1,
  1,
  TRUE,
  'system',
  NULL,
  'P2G disposable runtime Admin fixture',
  '45993000-0000-4000-8000-000000000122'
);

INSERT INTO platform.audit_events (
  organization_id,
  actor_kind,
  actor_profile_id,
  actor_principal,
  action,
  resource_type,
  resource_id,
  before_state,
  after_state,
  reason,
  request_id
)
VALUES (
  '45990000-0000-4000-8000-000000000001',
  'system',
  NULL,
  'local-test-fixture',
  'organization.bootstrap',
  'organization',
  '45990000-0000-4000-8000-000000000001',
  NULL,
  jsonb_build_object(
    'organization_id',
      '45990000-0000-4000-8000-000000000001',
    'membership_id',
      '45993000-0000-4000-8000-000000000023'
  ),
  'P2G disposable runtime Admin fixture',
  '45993000-0000-4000-8000-000000000123'
);

-- Publish the same approved, versioned prompt contract required by the live
-- draft RPC. The disposable queue fixture uses an authenticated Admin and
-- captures only immutable artifact identifiers; raw content is never emitted.
\if :has_bw4_prompt_lifecycle
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', profile.auth_user_id,
    'role', 'authenticated',
    'platform_role', 'admin',
    'platform_access_version', profile.access_version,
    'platform_organization_id', membership.organization_id,
    'platform_membership_id', membership.id,
    'platform_bundle_id', bundle.id,
    'platform_bundle_version', bundle.version
  )::TEXT,
  TRUE
) AS p2g_admin_claims
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
JOIN platform.role_bundle_versions AS bundle
  ON bundle.id = membership.current_bundle_id
  AND bundle.role = membership."current_role"
WHERE profile.id = '45993000-0000-4000-8000-000000000022'
\gset

SET LOCAL ROLE authenticated;
SELECT (
  platform.publish_ai_prompt_artifact_version(
    '45990000-0000-4000-8000-000000000001',
    'prompt_policy',
    'P2G synthetic prompt policy v1',
    'Synthetic local queue prompt policy. No customer content.',
    'local:p2g:prompt-policy:v1',
    'Publish the P2G synthetic prompt-policy fixture',
    '45997000-0000-4000-8000-000000000001'
  ) ->> 'prompt_artifact_version_id'
) AS p2g_prompt_policy_id
\gset
SELECT (
  platform.publish_ai_prompt_artifact_version(
    '45990000-0000-4000-8000-000000000001',
    'business_context',
    'P2G synthetic business context v1',
    'Synthetic local queue business context. No customer content.',
    'local:p2g:business-context:v1',
    'Publish the P2G synthetic business-context fixture',
    '45997000-0000-4000-8000-000000000002'
  ) ->> 'prompt_artifact_version_id'
) AS p2g_business_context_id
\gset
RESET ROLE;
\endif

INSERT INTO platform.communication_conversations (
  id,
  organization_id,
  responsible_sales_membership_id,
  queue,
  subject,
  waha_session_name,
  kommo_account_id,
  amocrm_account_id,
  amocrm_lead_id,
  amocrm_contact_id,
  current_scope_id,
  current_scope_version,
  created_from_webhook_event_id
)
VALUES (
  '45993000-0000-4000-8000-000000000005',
  '45990000-0000-4000-8000-000000000001',
  '45993000-0000-4000-8000-000000000003',
  'sales',
  'Synthetic P2G runtime conversation',
  'crm_primary',
  990001,
  990001,
  990001,
  990001,
  '45993000-0000-4000-8000-000000000004',
  1,
  '45991000-0000-4000-8000-000000000008'
);

INSERT INTO platform.conversation_participants (
  id,
  organization_id,
  conversation_id,
  participant_kind,
  external_subject_ref,
  source_webhook_event_id
)
VALUES (
  '45993000-0000-4000-8000-000000000006',
  '45990000-0000-4000-8000-000000000001',
  '45993000-0000-4000-8000-000000000005',
  'customer',
  'synthetic:p2g:customer',
  '45991000-0000-4000-8000-000000000008'
);

INSERT INTO platform.communication_messages (
  id,
  organization_id,
  conversation_id,
  sender_participant_id,
  direction,
  body_text,
  language,
  student_visible,
  waha_session_name,
  waha_message_id,
  kommo_account_id,
  amocrm_account_id,
  amocrm_lead_id,
  amocrm_contact_id,
  source_webhook_event_id
)
VALUES (
  '45993000-0000-4000-8000-000000000007',
  '45990000-0000-4000-8000-000000000001',
  '45993000-0000-4000-8000-000000000005',
  '45993000-0000-4000-8000-000000000006',
  'inbound',
  'Synthetic queue contract message',
  'en',
  FALSE,
  'crm_primary',
  'synthetic-p2g-message',
  990001,
  990001,
  990001,
  990001,
  '45991000-0000-4000-8000-000000000008'
);

INSERT INTO platform.approved_knowledge_versions (
  id,
  organization_id,
  knowledge_key,
  title,
  version,
  status,
  content_text,
  content_sha256,
  provenance_ref,
  approved_by_membership_id
)
VALUES (
  '45993000-0000-4000-8000-000000000008',
  '45990000-0000-4000-8000-000000000001',
  'synthetic.p2g.runtime',
  'P2G synthetic runtime knowledge',
  1,
  'approved',
  'Synthetic non-customer queue validation only.',
  encode(
    sha256(
      convert_to(
        'Synthetic non-customer queue validation only.',
        'UTF8'
      )
    ),
    'hex'
  ),
  'local:p2g:runtime',
  '45993000-0000-4000-8000-000000000003'
);

INSERT INTO platform.ai_draft_requests (
  id,
  organization_id,
  conversation_id,
  source_message_id,
  requested_language,
  requested_by_profile_id,
  requested_by_membership_id,
  reason,
  request_id
)
VALUES (
  '45993000-0000-4000-8000-000000000009',
  '45990000-0000-4000-8000-000000000001',
  '45993000-0000-4000-8000-000000000005',
  '45993000-0000-4000-8000-000000000007',
  'en',
  '45993000-0000-4000-8000-000000000002',
  '45993000-0000-4000-8000-000000000003',
  'Synthetic P2G runtime fixture',
  '45993000-0000-4000-8000-000000000109'
);

\if :has_bw4_prompt_lifecycle
INSERT INTO platform.ai_draft_request_knowledge_selections (
  id,
  organization_id,
  conversation_id,
  ai_draft_request_id,
  selected_knowledge_version_id,
  selected_by_profile_id,
  selected_by_membership_id,
  reason,
  request_id
)
VALUES (
  '45998000-0000-4000-8000-000000000001',
  '45990000-0000-4000-8000-000000000001',
  '45993000-0000-4000-8000-000000000005',
  '45993000-0000-4000-8000-000000000009',
  '45993000-0000-4000-8000-000000000008',
  '45993000-0000-4000-8000-000000000002',
  '45993000-0000-4000-8000-000000000003',
  'Pin approved synthetic knowledge for the P2G runtime fixture',
  '45999000-0000-4000-8000-000000000001'
);

INSERT INTO platform.ai_draft_request_prompt_selections (
  id,
  organization_id,
  conversation_id,
  ai_draft_request_id,
  prompt_policy_artifact_version_id,
  business_context_artifact_version_id,
  selected_by_profile_id,
  selected_by_membership_id,
  request_id
)
VALUES (
  '45998000-0000-4000-8000-000000000002',
  '45990000-0000-4000-8000-000000000001',
  '45993000-0000-4000-8000-000000000005',
  '45993000-0000-4000-8000-000000000009',
  :'p2g_prompt_policy_id',
  :'p2g_business_context_id',
  '45993000-0000-4000-8000-000000000002',
  '45993000-0000-4000-8000-000000000003',
  '45999000-0000-4000-8000-000000000002'
);
\endif

INSERT INTO platform.ai_drafts (
  id,
  organization_id,
  conversation_id,
  source_message_id,
  ai_draft_request_id,
  detection_status,
  selected_language,
  knowledge_version_id,
  provider_ref,
  model_ref,
  prompt_policy_version,
  source_context,
  source_context_sha256,
  generated_text,
  generated_text_sha256,
  state,
  reviewed_text,
  reviewed_text_sha256,
  reviewed_by_membership_id,
  reviewed_at,
  review_reason
)
VALUES (
  '45993000-0000-4000-8000-000000000010',
  '45990000-0000-4000-8000-000000000001',
  '45993000-0000-4000-8000-000000000005',
  '45993000-0000-4000-8000-000000000007',
  '45993000-0000-4000-8000-000000000009',
  'confident',
  'en',
  '45993000-0000-4000-8000-000000000008',
  'synthetic-local-provider',
  'synthetic-local-model',
  'lead_manager.default@1',
  '{"synthetic":true}'::JSONB,
  repeat('a', 64),
  'Synthetic draft text.',
  repeat('b', 64),
  'manual_send_authorized',
  'Synthetic reviewed text.',
  repeat('c', 64),
  '45993000-0000-4000-8000-000000000003',
  statement_timestamp(),
  'Synthetic runtime approval'
);

\if :has_p3c_source_message_column
INSERT INTO platform.manual_send_authorizations (
  id,
  organization_id,
  conversation_id,
  source_message_id,
  ai_draft_id,
  final_text,
  final_text_sha256,
  authorized_by_profile_id,
  authorized_by_membership_id,
  reason,
  request_id
)
VALUES (
  '45993000-0000-4000-8000-000000000011',
  '45990000-0000-4000-8000-000000000001',
  '45993000-0000-4000-8000-000000000005',
  '45993000-0000-4000-8000-000000000007',
  '45993000-0000-4000-8000-000000000010',
  'Synthetic reviewed text.',
  repeat('c', 64),
  '45993000-0000-4000-8000-000000000002',
  '45993000-0000-4000-8000-000000000003',
  'Synthetic manual authorization',
  '45993000-0000-4000-8000-000000000111'
);
\else
INSERT INTO platform.manual_send_authorizations (
  id,
  organization_id,
  conversation_id,
  ai_draft_id,
  final_text,
  final_text_sha256,
  authorized_by_profile_id,
  authorized_by_membership_id,
  reason,
  request_id
)
VALUES (
  '45993000-0000-4000-8000-000000000011',
  '45990000-0000-4000-8000-000000000001',
  '45993000-0000-4000-8000-000000000005',
  '45993000-0000-4000-8000-000000000010',
  'Synthetic reviewed text.',
  repeat('c', 64),
  '45993000-0000-4000-8000-000000000002',
  '45993000-0000-4000-8000-000000000003',
  'Synthetic manual authorization',
  '45993000-0000-4000-8000-000000000111'
);
\endif

INSERT INTO platform.communication_messages (
  id,
  organization_id,
  conversation_id,
  sender_participant_id,
  direction,
  body_text,
  language,
  student_visible,
  waha_session_name,
  waha_message_id,
  kommo_account_id,
  amocrm_account_id,
  amocrm_lead_id,
  amocrm_contact_id,
  source_webhook_event_id
)
VALUES (
  '45993000-0000-4000-8000-000000000031',
  '45990000-0000-4000-8000-000000000001',
  '45993000-0000-4000-8000-000000000005',
  '45993000-0000-4000-8000-000000000006',
  'inbound',
  'Synthetic crash ambiguity contract message',
  'en',
  FALSE,
  'crm_primary',
  'synthetic-p2g-crash-message',
  990001,
  990001,
  990001,
  990001,
  '45991000-0000-4000-8000-000000000008'
);

INSERT INTO platform.ai_draft_requests (
  id,
  organization_id,
  conversation_id,
  source_message_id,
  requested_language,
  requested_by_profile_id,
  requested_by_membership_id,
  reason,
  request_id
)
VALUES (
  '45993000-0000-4000-8000-000000000032',
  '45990000-0000-4000-8000-000000000001',
  '45993000-0000-4000-8000-000000000005',
  '45993000-0000-4000-8000-000000000031',
  'en',
  '45993000-0000-4000-8000-000000000002',
  '45993000-0000-4000-8000-000000000003',
  'Synthetic crash ambiguity fixture',
  '45993000-0000-4000-8000-000000000132'
);

\if :has_bw4_prompt_lifecycle
INSERT INTO platform.ai_draft_request_knowledge_selections (
  id,
  organization_id,
  conversation_id,
  ai_draft_request_id,
  selected_knowledge_version_id,
  selected_by_profile_id,
  selected_by_membership_id,
  reason,
  request_id
)
VALUES (
  '45998000-0000-4000-8000-000000000003',
  '45990000-0000-4000-8000-000000000001',
  '45993000-0000-4000-8000-000000000005',
  '45993000-0000-4000-8000-000000000032',
  '45993000-0000-4000-8000-000000000008',
  '45993000-0000-4000-8000-000000000002',
  '45993000-0000-4000-8000-000000000003',
  'Pin approved synthetic knowledge for the P2G crash fixture',
  '45999000-0000-4000-8000-000000000003'
);

INSERT INTO platform.ai_draft_request_prompt_selections (
  id,
  organization_id,
  conversation_id,
  ai_draft_request_id,
  prompt_policy_artifact_version_id,
  business_context_artifact_version_id,
  selected_by_profile_id,
  selected_by_membership_id,
  request_id
)
VALUES (
  '45998000-0000-4000-8000-000000000004',
  '45990000-0000-4000-8000-000000000001',
  '45993000-0000-4000-8000-000000000005',
  '45993000-0000-4000-8000-000000000032',
  :'p2g_prompt_policy_id',
  :'p2g_business_context_id',
  '45993000-0000-4000-8000-000000000002',
  '45993000-0000-4000-8000-000000000003',
  '45999000-0000-4000-8000-000000000004'
);
\endif

INSERT INTO platform.ai_drafts (
  id,
  organization_id,
  conversation_id,
  source_message_id,
  ai_draft_request_id,
  detection_status,
  selected_language,
  knowledge_version_id,
  provider_ref,
  model_ref,
  prompt_policy_version,
  source_context,
  source_context_sha256,
  generated_text,
  generated_text_sha256,
  state,
  reviewed_text,
  reviewed_text_sha256,
  reviewed_by_membership_id,
  reviewed_at,
  review_reason
)
VALUES (
  '45993000-0000-4000-8000-000000000033',
  '45990000-0000-4000-8000-000000000001',
  '45993000-0000-4000-8000-000000000005',
  '45993000-0000-4000-8000-000000000031',
  '45993000-0000-4000-8000-000000000032',
  'confident',
  'en',
  '45993000-0000-4000-8000-000000000008',
  'synthetic-local-provider',
  'synthetic-local-model',
  'lead_manager.default@1',
  '{"synthetic":true,"crash_ambiguity":true}'::JSONB,
  repeat('d', 64),
  'Synthetic crash ambiguity draft.',
  repeat('e', 64),
  'manual_send_authorized',
  'Synthetic crash ambiguity reviewed text.',
  repeat('f', 64),
  '45993000-0000-4000-8000-000000000003',
  statement_timestamp(),
  'Synthetic crash ambiguity approval'
);

\if :has_p3c_source_message_column
INSERT INTO platform.manual_send_authorizations (
  id,
  organization_id,
  conversation_id,
  source_message_id,
  ai_draft_id,
  final_text,
  final_text_sha256,
  authorized_by_profile_id,
  authorized_by_membership_id,
  reason,
  request_id
)
VALUES (
  '45993000-0000-4000-8000-000000000034',
  '45990000-0000-4000-8000-000000000001',
  '45993000-0000-4000-8000-000000000005',
  '45993000-0000-4000-8000-000000000031',
  '45993000-0000-4000-8000-000000000033',
  'Synthetic crash ambiguity reviewed text.',
  repeat('f', 64),
  '45993000-0000-4000-8000-000000000002',
  '45993000-0000-4000-8000-000000000003',
  'Synthetic crash ambiguity authorization',
  '45993000-0000-4000-8000-000000000134'
);
\else
INSERT INTO platform.manual_send_authorizations (
  id,
  organization_id,
  conversation_id,
  ai_draft_id,
  final_text,
  final_text_sha256,
  authorized_by_profile_id,
  authorized_by_membership_id,
  reason,
  request_id
)
VALUES (
  '45993000-0000-4000-8000-000000000034',
  '45990000-0000-4000-8000-000000000001',
  '45993000-0000-4000-8000-000000000005',
  '45993000-0000-4000-8000-000000000033',
  'Synthetic crash ambiguity reviewed text.',
  repeat('f', 64),
  '45993000-0000-4000-8000-000000000002',
  '45993000-0000-4000-8000-000000000003',
  'Synthetic crash ambiguity authorization',
  '45993000-0000-4000-8000-000000000134'
);
\endif

COMMIT;
SQL

has_bw4_prompt_lifecycle="$(
  admin_query "
    SELECT (
      to_regclass('platform.ai_draft_request_prompt_selections') IS NOT NULL
      AND to_regprocedure(
        'platform.publish_ai_prompt_artifact_version(uuid,platform.ai_prompt_artifact_kind,text,text,text,text,uuid)'
      ) IS NOT NULL
    )::TEXT;
  "
)"

if [[ "${has_bw4_prompt_lifecycle}" == "true" ]]; then
pinned_draft_count="$(
  admin_query "
    SELECT count(*)
    FROM platform.ai_drafts AS draft
    JOIN platform.ai_draft_request_prompt_selections AS selection
      ON selection.organization_id = draft.organization_id
     AND selection.ai_draft_request_id = draft.ai_draft_request_id
     AND selection.prompt_policy_artifact_version_id =
       draft.prompt_policy_artifact_version_id
     AND selection.business_context_artifact_version_id =
       draft.business_context_artifact_version_id
    JOIN platform_private.ai_prompt_artifact_versions AS prompt_policy
      ON prompt_policy.organization_id = selection.organization_id
     AND prompt_policy.id = selection.prompt_policy_artifact_version_id
     AND prompt_policy.artifact_kind = 'prompt_policy'
     AND prompt_policy.status = 'approved'
    JOIN platform_private.ai_prompt_artifact_versions AS business_context
      ON business_context.organization_id = selection.organization_id
     AND business_context.id = selection.business_context_artifact_version_id
     AND business_context.artifact_kind = 'business_context'
     AND business_context.status = 'approved'
    WHERE draft.id IN (
      '45993000-0000-4000-8000-000000000010',
      '45993000-0000-4000-8000-000000000033'
    );
  "
)"
assert_equal "2" "${pinned_draft_count}" \
  "P2G synthetic AI drafts did not retain exact approved prompt pins"

if admin_query "
  UPDATE platform.ai_drafts AS draft
  SET prompt_policy_artifact_version_id =
    selection.business_context_artifact_version_id
  FROM platform.ai_draft_request_prompt_selections AS selection
  WHERE draft.id = '45993000-0000-4000-8000-000000000010'
    AND selection.organization_id = draft.organization_id
    AND selection.ai_draft_request_id = draft.ai_draft_request_id;
" >"${TEMP_DIR}/unexpected-prompt-pin-update.log" 2>&1; then
  fail "P2G synthetic AI draft prompt pins were mutable"
fi
fi

# Two independent sessions race over two messages. PGMQ's SKIP LOCKED claim
# must give each worker a different item rather than duplicate side effects.
enqueue_webhook \
  "45991000-0000-4000-8000-000000000001" \
  "1" \
  "3" \
  "45994000-0000-4000-8000-000000000001" >/dev/null
enqueue_webhook \
  "45991000-0000-4000-8000-000000000002" \
  "2" \
  "3" \
  "45994000-0000-4000-8000-000000000002" >/dev/null

claim_fields \
  30 \
  "p2g-runtime-concurrent-a" \
  "45995000-0000-4000-8000-000000000001" \
  >"${TEMP_DIR}/claim-a.txt" &
claim_a_pid=$!
claim_fields \
  30 \
  "p2g-runtime-concurrent-b" \
  "45995000-0000-4000-8000-000000000002" \
  >"${TEMP_DIR}/claim-b.txt" &
claim_b_pid=$!
wait "${claim_a_pid}"
wait "${claim_b_pid}"

IFS='|' read -r claim_a_ok claim_a_work claim_a_attempt claim_a_message claim_a_read \
  <"${TEMP_DIR}/claim-a.txt"
IFS='|' read -r claim_b_ok claim_b_work claim_b_attempt claim_b_message claim_b_read \
  <"${TEMP_DIR}/claim-b.txt"
assert_equal "true" "${claim_a_ok}" "Concurrent worker A did not claim"
assert_equal "true" "${claim_b_ok}" "Concurrent worker B did not claim"
[[ "${claim_a_work}" != "${claim_b_work}" ]] \
  || fail "Concurrent workers claimed the same work item"
[[ "${claim_a_message}" != "${claim_b_message}" ]] \
  || fail "Concurrent workers claimed the same PGMQ message"

finish_work \
  "${claim_a_work}" \
  "${claim_a_attempt}" \
  "succeeded" \
  "" \
  "local:p2g:concurrent-a" \
  "" \
  "45996000-0000-4000-8000-000000000001"
finish_work \
  "${claim_b_work}" \
  "${claim_b_attempt}" \
  "succeeded" \
  "" \
  "local:p2g:concurrent-b" \
  "" \
  "45996000-0000-4000-8000-000000000002"

# A read is transactional: rolling back the worker session must make the exact
# queue message immediately claimable again without incrementing read_ct.
enqueue_webhook \
  "45991000-0000-4000-8000-000000000003" \
  "3" \
  "3" \
  "45994000-0000-4000-8000-000000000003" >/dev/null

rollback_claim="$(
  docker exec -i "${DATABASE_CONTAINER}" \
    psql \
    -X \
    -qAt \
    -v ON_ERROR_STOP=1 \
    -U postgres \
    -d "${DATABASE_NAME}" <<'SQL'
SET request.jwt.claims = '{"role":"service_role"}';
SET ROLE service_role;
BEGIN;
WITH response AS (
  SELECT platform.claim_durable_work(
    30,
    'p2g-runtime-rollback',
    '45995000-0000-4000-8000-000000000003'
  ) AS body
)
SELECT concat_ws(
  '|',
  body ->> 'claimed',
  body ->> 'work_item_id',
  body ->> 'attempt_id',
  body ->> 'queue_message_id',
  body ->> 'queue_read_count'
)
FROM response;
ROLLBACK;
SQL
)"
IFS='|' read -r rollback_ok rollback_work rollback_attempt rollback_message rollback_read \
  <<<"${rollback_claim}"
assert_equal "true" "${rollback_ok}" "Transactional rollback claim failed"

reclaimed_after_rollback="$(
  claim_fields \
    30 \
    "p2g-runtime-after-rollback" \
    "45995000-0000-4000-8000-000000000004"
)"
IFS='|' read -r rollback_reclaim_ok rollback_reclaim_work rollback_reclaim_attempt rollback_reclaim_message rollback_reclaim_read \
  <<<"${reclaimed_after_rollback}"
assert_equal "true" "${rollback_reclaim_ok}" "Rolled-back message did not reappear"
assert_equal "${rollback_work}" "${rollback_reclaim_work}" "Rollback changed work item"
assert_equal "${rollback_message}" "${rollback_reclaim_message}" "Rollback changed queue message"
assert_equal "${rollback_read}" "${rollback_reclaim_read}" "Rollback persisted a read count"
finish_work \
  "${rollback_reclaim_work}" \
  "${rollback_reclaim_attempt}" \
  "succeeded" \
  "" \
  "local:p2g:rollback" \
  "" \
  "45996000-0000-4000-8000-000000000003"

# An unacknowledged committed read becomes visible after VT and increments the
# same PGMQ message's read count rather than creating another queue record.
enqueue_webhook \
  "45991000-0000-4000-8000-000000000004" \
  "4" \
  "3" \
  "45994000-0000-4000-8000-000000000004" >/dev/null
visibility_first="$(
  claim_fields \
    1 \
    "p2g-runtime-vt-first" \
    "45995000-0000-4000-8000-000000000005"
)"
IFS='|' read -r visibility_first_ok visibility_work visibility_attempt visibility_message visibility_read \
  <<<"${visibility_first}"
assert_equal "true" "${visibility_first_ok}" "Initial VT claim failed"
sleep 2
visibility_second="$(
  claim_fields \
    30 \
    "p2g-runtime-vt-second" \
    "45995000-0000-4000-8000-000000000006"
)"
IFS='|' read -r visibility_second_ok visibility_rework visibility_reattempt visibility_remessage visibility_reread \
  <<<"${visibility_second}"
assert_equal "true" "${visibility_second_ok}" "Expired VT message did not reappear"
assert_equal "${visibility_work}" "${visibility_rework}" "VT expiry changed work item"
assert_equal "${visibility_message}" "${visibility_remessage}" "VT expiry changed queue message"
assert_equal "$((visibility_read + 1))" "${visibility_reread}" "VT expiry did not increment read_ct"
finish_work \
  "${visibility_rework}" \
  "${visibility_reattempt}" \
  "succeeded" \
  "" \
  "local:p2g:visibility" \
  "" \
  "45996000-0000-4000-8000-000000000004"

# Explicit retry uses pgmq.set_vt on the same message. It must not enqueue a
# duplicate pointer and a later success must archive that exact message.
enqueue_webhook \
  "45991000-0000-4000-8000-000000000005" \
  "5" \
  "3" \
  "45994000-0000-4000-8000-000000000005" >/dev/null
retry_first="$(
  claim_fields \
    30 \
    "p2g-runtime-retry-first" \
    "45995000-0000-4000-8000-000000000007"
)"
IFS='|' read -r retry_first_ok retry_work retry_attempt retry_message retry_read \
  <<<"${retry_first}"
assert_equal "true" "${retry_first_ok}" "Initial retry lane claim failed"
finish_work \
  "${retry_work}" \
  "${retry_attempt}" \
  "retryable_error" \
  "synthetic.retryable" \
  "local:p2g:retry" \
  "1" \
  "45996000-0000-4000-8000-000000000005"
sleep 2
retry_second="$(
  claim_fields \
    30 \
    "p2g-runtime-retry-second" \
    "45995000-0000-4000-8000-000000000008"
)"
IFS='|' read -r retry_second_ok retry_rework retry_reattempt retry_remessage retry_reread \
  <<<"${retry_second}"
assert_equal "true" "${retry_second_ok}" "set_vt retry did not reappear"
assert_equal "${retry_work}" "${retry_rework}" "Retry changed work item"
assert_equal "${retry_message}" "${retry_remessage}" "Retry created a new queue message"
assert_equal "$((retry_read + 1))" "${retry_reread}" "Retry did not increment read_ct"
finish_work \
  "${retry_rework}" \
  "${retry_reattempt}" \
  "succeeded" \
  "" \
  "local:p2g:retry-success" \
  "" \
  "45996000-0000-4000-8000-000000000006"

retry_archive_count="$(
  admin_query "
    SELECT count(*)
    FROM pgmq.a_platform_work_v1
    WHERE msg_id = ${retry_message}
      AND message ->> 'work_item_id' = '${retry_work}';
  "
)"
assert_equal "1" "${retry_archive_count}" "Successful retry message was not archived"

# With a budget of one, a retryable error is exhausted immediately. The active
# pointer is archived, one pointer enters the real DLQ and durable evidence is
# recorded exactly once.
dead_letter_baseline="$(
  admin_query "SELECT count(*) FROM pgmq.q_platform_dead_letter_v1;"
)"
enqueue_webhook \
  "45991000-0000-4000-8000-000000000006" \
  "6" \
  "1" \
  "45994000-0000-4000-8000-000000000006" >/dev/null
dead_letter_claim="$(
  claim_fields \
    30 \
    "p2g-runtime-dead-letter" \
    "45995000-0000-4000-8000-000000000009"
)"
IFS='|' read -r dead_letter_ok dead_letter_work dead_letter_attempt dead_letter_message dead_letter_read \
  <<<"${dead_letter_claim}"
assert_equal "true" "${dead_letter_ok}" "Dead-letter lane claim failed"
finish_work \
  "${dead_letter_work}" \
  "${dead_letter_attempt}" \
  "retryable_error" \
  "synthetic.exhausted" \
  "local:p2g:dead-letter" \
  "1" \
  "45996000-0000-4000-8000-000000000007"

dead_letter_evidence="$(
  admin_query "
    SELECT concat_ws(
      '|',
      item.state::TEXT,
      count(letter.id)::TEXT,
      count(queue.msg_id)::TEXT
    )
    FROM platform_private.durable_work_items AS item
    LEFT JOIN platform_private.durable_work_dead_letters AS letter
      ON letter.work_item_id = item.id
    LEFT JOIN pgmq.q_platform_dead_letter_v1 AS queue
      ON queue.message ->> 'work_item_id' = item.id::TEXT
    WHERE item.id = '${dead_letter_work}'
    GROUP BY item.state;
  "
)"
IFS='|' read -r dead_letter_state dead_letter_rows dead_letter_queue_rows \
  <<<"${dead_letter_evidence}"
assert_equal "dead_lettered" "${dead_letter_state}" "Exhausted work state drifted"
assert_equal "1" "${dead_letter_rows}" "Dead-letter ledger is missing or duplicated"
assert_equal "1" "${dead_letter_queue_rows}" "Real PGMQ DLQ pointer is missing or duplicated"
dead_letter_after="$(
  admin_query "SELECT count(*) FROM pgmq.q_platform_dead_letter_v1;"
)"
assert_equal "$((dead_letter_baseline + 1))" "${dead_letter_after}" "DLQ count drifted"

# Exact request replay and a new request with the same business key both return
# the original item; only one active pointer is allowed.
dedupe_first="$(
  enqueue_webhook \
    "45991000-0000-4000-8000-000000000007" \
    "7" \
    "3" \
    "45994000-0000-4000-8000-000000000007"
)"
dedupe_replay="$(
  enqueue_webhook \
    "45991000-0000-4000-8000-000000000007" \
    "7" \
    "3" \
    "45994000-0000-4000-8000-000000000007"
)"
dedupe_business="$(
  enqueue_webhook \
    "45991000-0000-4000-8000-000000000007" \
    "7" \
    "3" \
    "45994000-0000-4000-8000-000000000008"
)"
dedupe_first_work="$(
  admin_query "SELECT '${dedupe_first}'::JSONB ->> 'work_item_id';"
)"
dedupe_replay_work="$(
  admin_query "SELECT '${dedupe_replay}'::JSONB ->> 'work_item_id';"
)"
dedupe_business_work="$(
  admin_query "SELECT '${dedupe_business}'::JSONB ->> 'work_item_id';"
)"
assert_equal "${dedupe_first_work}" "${dedupe_replay_work}" "Exact request replay created new work"
assert_equal "${dedupe_first_work}" "${dedupe_business_work}" "Business-key replay created new work"
dedupe_queue_rows="$(
  admin_query "
    SELECT count(*)
    FROM pgmq.q_platform_work_v1
    WHERE message ->> 'work_item_id' = '${dedupe_first_work}';
  "
)"
assert_equal "1" "${dedupe_queue_rows}" "Dedupe created duplicate active queue pointers"
dedupe_claim="$(
  claim_fields \
    30 \
    "p2g-runtime-dedupe" \
    "45995000-0000-4000-8000-000000000010"
)"
IFS='|' read -r dedupe_ok dedupe_work dedupe_attempt dedupe_message dedupe_read \
  <<<"${dedupe_claim}"
assert_equal "true" "${dedupe_ok}" "Deduplicated work was not claimable"
assert_equal "${dedupe_first_work}" "${dedupe_work}" "Dedupe claim returned another item"
finish_work \
  "${dedupe_work}" \
  "${dedupe_attempt}" \
  "succeeded" \
  "" \
  "local:p2g:dedupe" \
  "" \
  "45996000-0000-4000-8000-000000000008"

# Unknown provider delivery is valid only for a manually authorized send. It
# archives the active pointer, opens a durable review and never enters DLQ.
manual_enqueue="$(
  service_query "
    SELECT platform.enqueue_manual_whatsapp_send(
      '45990000-0000-4000-8000-000000000001',
      '45993000-0000-4000-8000-000000000011',
      repeat('8', 64),
      1,
      '45994000-0000-4000-8000-000000000009'
    );
  "
)"
manual_work="$(
  admin_query "SELECT '${manual_enqueue}'::JSONB ->> 'work_item_id';"
)"
manual_claim="$(
  claim_fields \
    30 \
    "p2g-runtime-unknown" \
    "45995000-0000-4000-8000-000000000011"
)"
IFS='|' read -r manual_ok manual_claim_work manual_attempt manual_message manual_read \
  <<<"${manual_claim}"
assert_equal "true" "${manual_ok}" "Manual-send work was not claimable"
assert_equal "${manual_work}" "${manual_claim_work}" "Manual-send claim returned another work item"
manual_dlq_before="$(
  admin_query "
    SELECT count(*)
    FROM pgmq.q_platform_dead_letter_v1
    WHERE message ->> 'work_item_id' = '${manual_work}';
  "
)"
assert_equal "0" "${manual_dlq_before}" "Manual send entered DLQ before finish"
finish_work \
  "${manual_work}" \
  "${manual_attempt}" \
  "unknown_result" \
  "provider.result.unknown" \
  "local:p2g:unknown" \
  "" \
  "45996000-0000-4000-8000-000000000009"
sleep 2
unknown_evidence="$(
  admin_query "
    SELECT concat_ws(
      '|',
      item.state::TEXT,
      count(review.id)::TEXT,
      count(active.msg_id)::TEXT,
      count(dead.msg_id)::TEXT,
      count(archive.msg_id)::TEXT
    )
    FROM platform_private.durable_work_items AS item
    LEFT JOIN platform.work_review_cases AS review
      ON review.work_item_id = item.id
      AND review.review_kind = 'unknown_delivery'
    LEFT JOIN pgmq.q_platform_work_v1 AS active
      ON active.message ->> 'work_item_id' = item.id::TEXT
    LEFT JOIN pgmq.q_platform_dead_letter_v1 AS dead
      ON dead.message ->> 'work_item_id' = item.id::TEXT
    LEFT JOIN pgmq.a_platform_work_v1 AS archive
      ON archive.msg_id = item.queue_message_id
    WHERE item.id = '${manual_work}'
    GROUP BY item.state;
  "
)"
IFS='|' read -r unknown_state unknown_reviews unknown_active unknown_dead unknown_archive \
  <<<"${unknown_evidence}"
assert_equal "unknown_manual_review" "${unknown_state}" "Unknown result is not terminal/manual review"
assert_equal "1" "${unknown_reviews}" "Unknown result did not open exactly one review"
assert_equal "0" "${unknown_active}" "Unknown result reappeared in active queue"
assert_equal "0" "${unknown_dead}" "Unknown result was automatically dead-lettered"
assert_equal "1" "${unknown_archive}" "Unknown result did not archive the active pointer"

# A worker can crash after WAHA accepted a send but before finish was recorded.
# That ambiguity must never reclaim/re-send the authorization. The next claim
# converts the expired single-attempt lease into unknown/manual review.
if service_query "
  SELECT platform.enqueue_manual_whatsapp_send(
    '45990000-0000-4000-8000-000000000001',
    '45993000-0000-4000-8000-000000000034',
    repeat('9', 64),
    2,
    '45994000-0000-4000-8000-000000000010'
  );
" >"${TEMP_DIR}/unexpected-manual-retry-budget.log" 2>&1; then
  fail "Manual WhatsApp work accepted a retry budget greater than one"
fi

manual_crash_enqueue="$(
  service_query "
    SELECT platform.enqueue_manual_whatsapp_send(
      '45990000-0000-4000-8000-000000000001',
      '45993000-0000-4000-8000-000000000034',
      repeat('9', 64),
      1,
      '45994000-0000-4000-8000-000000000011'
    );
  "
)"
manual_crash_work="$(
  admin_query "SELECT '${manual_crash_enqueue}'::JSONB ->> 'work_item_id';"
)"
manual_crash_claim="$(
  claim_fields \
    1 \
    "p2g-runtime-crash-before-finish" \
    "45995000-0000-4000-8000-000000000012"
)"
IFS='|' read -r manual_crash_ok manual_crash_claim_work manual_crash_attempt manual_crash_message manual_crash_read \
  <<<"${manual_crash_claim}"
assert_equal "true" "${manual_crash_ok}" "Crash-ambiguity manual work was not claimed"
assert_equal "${manual_crash_work}" "${manual_crash_claim_work}" "Crash lane claimed another work item"
sleep 2
manual_crash_followup="$(
  service_query "
    WITH response AS (
      SELECT platform.claim_durable_work(
        1,
        'p2g-runtime-crash-recovery',
        '45995000-0000-4000-8000-000000000013'
      ) AS body
    )
    SELECT concat_ws(
      '|',
      body ->> 'claimed',
      body ->> 'lease_expired_without_result'
    )
    FROM response;
  "
)"
IFS='|' read -r manual_crash_followup_ok manual_crash_ambiguity_flag \
  <<<"${manual_crash_followup}"
assert_equal "false" "${manual_crash_followup_ok}" "Expired manual-send lease was reclaimed"
assert_equal "true" "${manual_crash_ambiguity_flag}" "Expired manual lease was not identified as an unknown send result"

manual_crash_evidence="$(
  admin_query "
    SELECT concat_ws(
      '|',
      item.state::TEXT,
      count(DISTINCT review.id)::TEXT,
      count(DISTINCT reconciliation.id)::TEXT,
      count(DISTINCT attempt.id) FILTER (
        WHERE attempt.outcome = 'unknown_result'
          AND attempt.error_code = 'worker_lease_expired_before_result'
          AND attempt.evidence_ref = 'worker_lease_expired_before_result'
          AND attempt.finish_request_id =
            '45995000-0000-4000-8000-000000000013'
      )::TEXT,
      count(DISTINCT active.msg_id)::TEXT,
      count(DISTINCT dead.msg_id)::TEXT,
      count(DISTINCT archive.msg_id)::TEXT
    )
    FROM platform_private.durable_work_items AS item
    LEFT JOIN platform_private.durable_work_attempts AS attempt
      ON attempt.work_item_id = item.id
    LEFT JOIN platform.work_review_cases AS review
      ON review.work_item_id = item.id
      AND review.review_kind = 'unknown_delivery'
    LEFT JOIN platform_private.provider_reconciliation_events AS reconciliation
      ON reconciliation.organization_id = item.organization_id
      AND reconciliation.manual_send_authorization_id =
        item.manual_send_authorization_id
      AND reconciliation.observation_kind = 'unknown_result'
    LEFT JOIN pgmq.q_platform_work_v1 AS active
      ON active.message ->> 'work_item_id' = item.id::TEXT
    LEFT JOIN pgmq.q_platform_dead_letter_v1 AS dead
      ON dead.message ->> 'work_item_id' = item.id::TEXT
    LEFT JOIN pgmq.a_platform_work_v1 AS archive
      ON archive.msg_id = item.queue_message_id
    WHERE item.id = '${manual_crash_work}'
    GROUP BY item.state;
  "
)"
IFS='|' read -r crash_state crash_reviews crash_reconciliations crash_unknown_attempts crash_active crash_dead crash_archive \
  <<<"${manual_crash_evidence}"
assert_equal "unknown_manual_review" "${crash_state}" "Expired manual lease is not terminal/manual review"
assert_equal "1" "${crash_reviews}" "Expired manual lease did not open one review"
assert_equal "1" "${crash_reconciliations}" "Expired manual lease lacks reconciliation evidence"
assert_equal "1" "${crash_unknown_attempts}" "Expired manual lease lacks exact unknown-result attempt evidence"
assert_equal "0" "${crash_active}" "Expired manual lease remained active"
assert_equal "0" "${crash_dead}" "Expired manual lease entered DLQ"
assert_equal "1" "${crash_archive}" "Expired manual lease was not archived"

final_active="$(
  admin_query "SELECT count(*) FROM pgmq.q_platform_work_v1;"
)"
assert_equal "0" "${final_active}" "P2G runtime gate left active work behind"

printf '%s\n' \
  'Verified real PGMQ claims, rollback, VT, retry, DLQ, dedupe and unknown/crash terminal handling.'
