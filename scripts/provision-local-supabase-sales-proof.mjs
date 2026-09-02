#!/usr/bin/env node

import postgres from "postgres";

const LEAD_ID = "54600000-0000-4000-8000-000000000001";
const CLIENT_ID = "54600000-0000-4000-8000-000000000002";
const WORKFLOW_LEAD_ID = "54600000-0000-4000-8000-000000000003";
const API_WORKFLOW_LEAD_ID = "54600000-0000-4000-8000-000000000004";
const CONVERSATION_CLIENT_ID = "54600000-0000-4000-8000-000000000005";
const CONVERSATION_LEAD_ID = "54600000-0000-4000-8000-000000000006";
const CONVERSATION_ID = "54600000-0000-4000-8000-000000000007";
const CONVERSATION_SCOPE_ID = "54600000-0000-4000-8000-000000000008";
const CONVERSATION_EVENT_ID = "54600000-0000-4000-8000-000000000009";
const CONVERSATION_BINDING_ID = "54600000-0000-4000-8000-000000000010";
const CONVERSATION_SCOPE_ASSIGNMENT_ID =
  "54600000-0000-4000-8000-000000000011";
const CONVERSATION_EVENT_REQUEST_ID =
  "54600000-0000-4000-8000-000000000012";
const CONVERSATION_SCOPE_REQUEST_ID =
  "54600000-0000-4000-8000-000000000013";
const CONVERSATION_CLIENT_EXTERNAL_ID =
  "54600000-0000-4000-8000-000000000014";
const CONVERSATION_LEAD_EXTERNAL_ID =
  "54600000-0000-4000-8000-000000000015";
const CLIENT_ONLY_CONVERSATION_ID = "54600000-0000-4000-8000-000000000016";
const MISSING_EVIDENCE_CONVERSATION_ID =
  "54600000-0000-4000-8000-000000000017";
const NON_INTAKE_CONVERSATION_ID = "54600000-0000-4000-8000-000000000018";
const CLIENT_ONLY_SCOPE_ID = "54600000-0000-4000-8000-000000000019";
const MISSING_EVIDENCE_SCOPE_ID = "54600000-0000-4000-8000-000000000020";
const NON_INTAKE_SCOPE_ID = "54600000-0000-4000-8000-000000000021";
const CLIENT_ONLY_SCOPE_ASSIGNMENT_ID =
  "54600000-0000-4000-8000-000000000022";
const MISSING_EVIDENCE_SCOPE_ASSIGNMENT_ID =
  "54600000-0000-4000-8000-000000000023";
const NON_INTAKE_SCOPE_ASSIGNMENT_ID =
  "54600000-0000-4000-8000-000000000024";
const CLIENT_ONLY_SCOPE_REQUEST_ID =
  "54600000-0000-4000-8000-000000000025";
const MISSING_EVIDENCE_SCOPE_REQUEST_ID =
  "54600000-0000-4000-8000-000000000026";
const NON_INTAKE_SCOPE_REQUEST_ID =
  "54600000-0000-4000-8000-000000000027";
const HANDOFF_CLIENT_ID = "54600000-0000-4000-8000-000000000028";
const HANDOFF_LEAD_ID = "54600000-0000-4000-8000-000000000029";
const CONVERSATION_CHAT_ID = "15550005461@c.us";
const CONVERSATION_EXTERNAL_IDENTITY = `evo-inbox:${CONVERSATION_CHAT_ID}`;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

class SalesProofProvisioningError extends Error {
  constructor(code) {
    super(code);
    this.name = "SalesProofProvisioningError";
    this.code = code;
  }
}

function fail(code) {
  throw new SalesProofProvisioningError(code);
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.length === 0) fail(`${name}_MISSING`);
  return value;
}

function localDatabaseUrl() {
  const raw = requiredEnvironment("SUPABASE_DB_URL");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    fail("SUPABASE_DB_URL_INVALID");
  }

  if (
    parsed.protocol !== "postgresql:" ||
    !new Set(["127.0.0.1", "localhost", "[::1]"]).has(parsed.hostname) ||
    parsed.hash ||
    parsed.search
  ) {
    fail("SUPABASE_DB_URL_NOT_LOCAL");
  }
  return raw;
}

function salesEmail() {
  const email = requiredEnvironment("EVO_STAFF_AUTH_SALES_EMAIL").trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) fail("SALES_EMAIL_INVALID");
  return email;
}

function assertAuthority(row) {
  if (
    !row ||
    !UUID_PATTERN.test(row.organization_id) ||
    !UUID_PATTERN.test(row.membership_id) ||
    row.current_role !== "sales" ||
    row.membership_status !== "active" ||
    row.profile_status !== "active"
  ) {
    fail("SALES_AUTHORITY_INVALID");
  }
  return row;
}

async function main() {
  const sql = postgres(localDatabaseUrl(), {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 5,
  });

  try {
    const [authorityRow] = await sql`
      SELECT
        membership.organization_id,
        membership.id AS membership_id,
        membership."current_role"::TEXT AS current_role,
        membership.status::TEXT AS membership_status,
        profile.status::TEXT AS profile_status
      FROM auth.users AS auth_user
      JOIN platform.profiles AS profile
        ON profile.auth_user_id = auth_user.id
      JOIN platform.organization_memberships AS membership
        ON membership.profile_id = profile.id
      WHERE lower(auth_user.email) = ${salesEmail()}
      ORDER BY membership.created_at DESC, membership.id DESC
      LIMIT 1
    `;
    const authority = assertAuthority(authorityRow);

    await sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO platform.clients (
          id,
          organization_id,
          display_name,
          normalized_name,
          email,
          normalized_email,
          phone,
          normalized_phone,
          lifecycle_state,
          created_at,
          updated_at
        )
        VALUES (
          ${CLIENT_ID},
          ${authority.organization_id},
          'EVO P2B Isolated Sales Proof',
          platform_private.normalize_person_name('EVO P2B Isolated Sales Proof'),
          'p2b-sales-proof@example.invalid',
          platform_private.normalize_person_email('p2b-sales-proof@example.invalid'),
          '+15550005460',
          platform_private.normalize_person_phone('+15550005460'),
          'active',
          '2026-09-02T08:00:00Z',
          '2026-09-02T08:00:00Z'
        )
      `;

      await transaction`
        INSERT INTO platform.leads (
          id,
          organization_id,
          client_id,
          current_owner_membership_id,
          stage_key,
          source_key,
          lifecycle_state,
          next_action_text,
          next_action_due_date,
          workflow_version,
          created_at,
          updated_at
        )
        VALUES (
          ${LEAD_ID},
          ${authority.organization_id},
          ${CLIENT_ID},
          ${authority.membership_id},
          'contacting',
          'isolated_browser',
          'open',
          'Verify authenticated Supabase Sales read path',
          '2099-09-02',
          7,
          '2026-09-02T08:00:00Z',
          '2026-09-02T08:05:00Z'
        )
      `;

      await transaction`
        INSERT INTO platform.clients (
          id,
          organization_id,
          display_name,
          normalized_name,
          email,
          normalized_email,
          phone,
          normalized_phone,
          lifecycle_state,
          created_at,
          updated_at
        )
        VALUES (
          ${HANDOFF_CLIENT_ID},
          ${authority.organization_id},
          'EVO P3 Contract Handoff Proof',
          platform_private.normalize_person_name('EVO P3 Contract Handoff Proof'),
          'p3-contract-handoff@example.invalid',
          platform_private.normalize_person_email('p3-contract-handoff@example.invalid'),
          '+15550005462',
          platform_private.normalize_person_phone('+15550005462'),
          'active',
          '2026-09-02T08:20:00Z',
          '2026-09-02T08:20:00Z'
        )
      `;

      await transaction`
        INSERT INTO platform.leads (
          id,
          organization_id,
          client_id,
          current_owner_membership_id,
          stage_key,
          source_key,
          lifecycle_state,
          next_action_text,
          next_action_due_date,
          workflow_version,
          created_at,
          updated_at
        )
        VALUES (
          ${HANDOFF_LEAD_ID},
          ${authority.organization_id},
          ${HANDOFF_CLIENT_ID},
          ${authority.membership_id},
          'qualified',
          'isolated_handoff_browser',
          'open',
          'Complete reviewed contract, payment and Admissions handoff',
          '2099-09-03',
          1,
          '2026-09-02T08:20:00Z',
          '2026-09-02T08:20:00Z'
        )
      `;

      await transaction`
        INSERT INTO platform.leads (
          id,
          organization_id,
          client_id,
          current_owner_membership_id,
          stage_key,
          source_key,
          lifecycle_state,
          next_action_text,
          next_action_due_date,
          workflow_version,
          created_at,
          updated_at
        )
        VALUES (
          ${API_WORKFLOW_LEAD_ID},
          ${authority.organization_id},
          ${CLIENT_ID},
          ${authority.membership_id},
          'new',
          'isolated_direct_api_workflow',
          'open',
          'Initial direct API workflow action',
          '2099-09-04',
          21,
          '2026-09-02T08:02:00Z',
          '2026-09-02T08:07:00Z'
        )
      `;

      await transaction`
        INSERT INTO platform.leads (
          id,
          organization_id,
          client_id,
          current_owner_membership_id,
          stage_key,
          source_key,
          lifecycle_state,
          next_action_text,
          next_action_due_date,
          workflow_version,
          created_at,
          updated_at
        )
        VALUES (
          ${WORKFLOW_LEAD_ID},
          ${authority.organization_id},
          ${CLIENT_ID},
          ${authority.membership_id},
          'new',
          'isolated_browser_workflow',
          'open',
          'Initial isolated workflow action',
          '2099-09-03',
          11,
          '2026-09-02T08:01:00Z',
          '2026-09-02T08:06:00Z'
        )
      `;

      await transaction`
        INSERT INTO platform.clients (
          id,
          organization_id,
          display_name,
          normalized_name,
          phone,
          normalized_phone,
          lifecycle_state,
          created_at,
          updated_at
        )
        VALUES (
          ${CONVERSATION_CLIENT_ID},
          ${authority.organization_id},
          'EVO P2B Exact Conversation Proof',
          platform_private.normalize_person_name(
            'EVO P2B Exact Conversation Proof'
          ),
          '+15550005461',
          platform_private.normalize_person_phone('+15550005461'),
          'active',
          '2026-09-02T08:10:00Z',
          '2026-09-02T08:10:00Z'
        )
      `;

      await transaction`
        INSERT INTO platform.leads (
          id,
          organization_id,
          client_id,
          current_owner_membership_id,
          stage_key,
          source_key,
          lifecycle_state,
          next_action_text,
          next_action_due_date,
          workflow_version,
          created_at,
          updated_at
        )
        VALUES (
          ${CONVERSATION_LEAD_ID},
          ${authority.organization_id},
          ${CONVERSATION_CLIENT_ID},
          ${authority.membership_id},
          'new',
          'whatsapp',
          'open',
          NULL,
          NULL,
          1,
          '2026-09-02T08:10:00Z',
          '2026-09-02T08:10:00Z'
        )
      `;

      await transaction`
        INSERT INTO platform.external_identifiers (
          id,
          organization_id,
          source_system,
          external_object_type,
          external_identifier,
          client_id,
          observed_at,
          source_ref
        )
        VALUES (
          ${CONVERSATION_CLIENT_EXTERNAL_ID},
          ${authority.organization_id},
          'waha',
          'direct_chat',
          ${CONVERSATION_EXTERNAL_IDENTITY},
          ${CONVERSATION_CLIENT_ID},
          '2026-09-02T08:10:00Z',
          ${`synthetic:local-sales-proof:${CONVERSATION_EVENT_ID}`}
        )
      `;

      await transaction`
        INSERT INTO platform.external_identifiers (
          id,
          organization_id,
          source_system,
          external_object_type,
          external_identifier,
          lead_id,
          observed_at,
          source_ref
        )
        VALUES (
          ${CONVERSATION_LEAD_EXTERNAL_ID},
          ${authority.organization_id},
          'waha',
          'sales_intake',
          ${CONVERSATION_EXTERNAL_IDENTITY},
          ${CONVERSATION_LEAD_ID},
          '2026-09-02T08:10:00Z',
          ${`synthetic:local-sales-proof:${CONVERSATION_EVENT_ID}`}
        )
      `;

      await transaction`
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
          request_id,
          received_at
        )
        VALUES (
          ${CONVERSATION_EVENT_ID},
          ${authority.organization_id},
          'waha',
          'waha:evo-inbox',
          'synthetic-local-sales-conversation-proof',
          'evo-inbox',
          'synthetic-local-sales-conversation-proof',
          'message',
          '2026-09-02T08:10:00Z',
          'verified',
          jsonb_build_object(
            'event', 'message',
            'session', 'evo-inbox',
            'payload', jsonb_build_object(
              'id', 'synthetic-local-sales-conversation-proof',
              'from', ${CONVERSATION_CHAT_ID}::TEXT,
              'chatId', ${CONVERSATION_CHAT_ID}::TEXT,
              'fromMe', FALSE,
              'source', 'app',
              'body', 'Synthetic local conversation link proof'
            )
          ),
          '{"hmac_verified":true}'::JSONB,
          'synthetic:local-sales-conversation-proof',
          repeat('46', 32),
          ${CONVERSATION_EVENT_REQUEST_ID},
          '2026-09-02T08:10:01Z'
        )
      `;

      await transaction`
        INSERT INTO platform.record_scopes (
          id,
          organization_id,
          scope_kind,
          scope_key,
          scope_version,
          is_active
        )
        VALUES (
          ${CONVERSATION_SCOPE_ID},
          ${authority.organization_id},
          'conversation',
          ${CONVERSATION_ID},
          1,
          TRUE
        )
      `;

      await transaction`
        INSERT INTO platform.communication_conversations (
          id,
          organization_id,
          student_case_id,
          responsible_sales_membership_id,
          sales_authority_source,
          current_curator_membership_id,
          queue,
          status,
          subject,
          waha_session_name,
          kommo_account_id,
          kommo_conversation_id,
          amocrm_account_id,
          amocrm_lead_id,
          amocrm_contact_id,
          current_scope_id,
          current_scope_version,
          created_from_webhook_event_id,
          canonical_client_id,
          canonical_lead_id,
          created_at,
          updated_at
        )
        VALUES (
          ${CONVERSATION_ID},
          ${authority.organization_id},
          NULL,
          ${authority.membership_id},
          'platform_intake',
          NULL,
          'sales',
          'open',
          'WhatsApp exact Sales-intake proof',
          'evo-inbox',
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          ${CONVERSATION_SCOPE_ID},
          1,
          ${CONVERSATION_EVENT_ID},
          ${CONVERSATION_CLIENT_ID},
          ${CONVERSATION_LEAD_ID},
          '2026-09-02T08:10:01Z',
          '2026-09-02T08:10:01Z'
        )
      `;

      await transaction`
        INSERT INTO platform.membership_scope_assignments (
          id,
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
          ${CONVERSATION_SCOPE_ASSIGNMENT_ID},
          ${authority.organization_id},
          ${authority.membership_id},
          ${CONVERSATION_SCOPE_ID},
          1,
          1,
          TRUE,
          'system',
          NULL,
          'Synthetic local exact conversation browser proof',
          ${CONVERSATION_SCOPE_REQUEST_ID}
        )
      `;

      await transaction`
        INSERT INTO platform.record_scopes (
          id,
          organization_id,
          scope_kind,
          scope_key,
          scope_version,
          is_active
        )
        VALUES
          (
            ${CLIENT_ONLY_SCOPE_ID},
            ${authority.organization_id},
            'conversation',
            ${CLIENT_ONLY_CONVERSATION_ID},
            1,
            TRUE
          ),
          (
            ${MISSING_EVIDENCE_SCOPE_ID},
            ${authority.organization_id},
            'conversation',
            ${MISSING_EVIDENCE_CONVERSATION_ID},
            1,
            TRUE
          ),
          (
            ${NON_INTAKE_SCOPE_ID},
            ${authority.organization_id},
            'conversation',
            ${NON_INTAKE_CONVERSATION_ID},
            1,
            TRUE
          )
      `;

      await transaction`
        INSERT INTO platform.communication_conversations (
          id,
          organization_id,
          student_case_id,
          responsible_sales_membership_id,
          sales_authority_source,
          current_curator_membership_id,
          queue,
          status,
          subject,
          waha_session_name,
          kommo_account_id,
          kommo_conversation_id,
          amocrm_account_id,
          amocrm_lead_id,
          amocrm_contact_id,
          current_scope_id,
          current_scope_version,
          created_from_webhook_event_id,
          canonical_client_id,
          canonical_lead_id,
          created_at,
          updated_at
        )
        VALUES
          (
            ${CLIENT_ONLY_CONVERSATION_ID},
            ${authority.organization_id},
            NULL,
            ${authority.membership_id},
            'platform_intake',
            NULL,
            'sales',
            'open',
            'Negative proof: same client without exact lead',
            'evo-inbox',
            NULL,
            NULL,
            NULL,
            NULL,
            NULL,
            ${CLIENT_ONLY_SCOPE_ID},
            1,
            ${CONVERSATION_EVENT_ID},
            ${CONVERSATION_CLIENT_ID},
            NULL,
            '2026-09-02T08:11:00Z',
            '2026-09-02T08:11:00Z'
          ),
          (
            ${MISSING_EVIDENCE_CONVERSATION_ID},
            ${authority.organization_id},
            NULL,
            ${authority.membership_id},
            'platform_intake',
            NULL,
            'sales',
            'open',
            'Negative proof: exact IDs without verified binding',
            'evo-inbox',
            NULL,
            NULL,
            NULL,
            NULL,
            NULL,
            ${MISSING_EVIDENCE_SCOPE_ID},
            1,
            ${CONVERSATION_EVENT_ID},
            ${CONVERSATION_CLIENT_ID},
            ${CONVERSATION_LEAD_ID},
            '2026-09-02T08:12:00Z',
            '2026-09-02T08:12:00Z'
          ),
          (
            ${NON_INTAKE_CONVERSATION_ID},
            ${authority.organization_id},
            NULL,
            ${authority.membership_id},
            'provider_linked',
            NULL,
            'sales',
            'open',
            'Negative proof: provider-linked non-intake',
            'evo-inbox',
            546018,
            'negative-provider-linked',
            546018,
            546019,
            546020,
            ${NON_INTAKE_SCOPE_ID},
            1,
            ${CONVERSATION_EVENT_ID},
            ${CONVERSATION_CLIENT_ID},
            ${CONVERSATION_LEAD_ID},
            '2026-09-02T08:13:00Z',
            '2026-09-02T08:13:00Z'
          )
      `;

      await transaction`
        INSERT INTO platform.membership_scope_assignments (
          id,
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
        VALUES
          (
            ${CLIENT_ONLY_SCOPE_ASSIGNMENT_ID},
            ${authority.organization_id},
            ${authority.membership_id},
            ${CLIENT_ONLY_SCOPE_ID},
            1,
            1,
            TRUE,
            'system',
            NULL,
            'Synthetic client-only negative conversation proof',
            ${CLIENT_ONLY_SCOPE_REQUEST_ID}
          ),
          (
            ${MISSING_EVIDENCE_SCOPE_ASSIGNMENT_ID},
            ${authority.organization_id},
            ${authority.membership_id},
            ${MISSING_EVIDENCE_SCOPE_ID},
            1,
            1,
            TRUE,
            'system',
            NULL,
            'Synthetic missing-evidence negative conversation proof',
            ${MISSING_EVIDENCE_SCOPE_REQUEST_ID}
          ),
          (
            ${NON_INTAKE_SCOPE_ASSIGNMENT_ID},
            ${authority.organization_id},
            ${authority.membership_id},
            ${NON_INTAKE_SCOPE_ID},
            1,
            1,
            TRUE,
            'system',
            NULL,
            'Synthetic non-intake negative conversation proof',
            ${NON_INTAKE_SCOPE_REQUEST_ID}
          )
      `;

      await transaction`
        INSERT INTO platform_private.waha_direct_chat_bindings (
          id,
          organization_id,
          waha_session_name,
          normalized_chat_id,
          conversation_id,
          source_webhook_event_id
        )
        VALUES (
          ${CONVERSATION_BINDING_ID},
          ${authority.organization_id},
          'evo-inbox',
          ${CONVERSATION_CHAT_ID},
          ${CONVERSATION_ID},
          ${CONVERSATION_EVENT_ID}
        )
      `;
    });

    console.log(
      `LOCAL_SUPABASE_SALES_PROOF ${LEAD_ID} ${CLIENT_ID} ${WORKFLOW_LEAD_ID} ${API_WORKFLOW_LEAD_ID} ${CONVERSATION_LEAD_ID} ${CONVERSATION_ID} ${HANDOFF_LEAD_ID} ${HANDOFF_CLIENT_ID}`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  const databaseCode =
    error && typeof error === "object" && "code" in error &&
      typeof error.code === "string" && /^[A-Z0-9]{5}$/.test(error.code)
      ? error.code
      : null;
  const constraintName =
    error && typeof error === "object" && "constraint_name" in error &&
      typeof error.constraint_name === "string" &&
      /^[a-z0-9_]+$/.test(error.constraint_name)
      ? error.constraint_name.toUpperCase()
      : null;
  const code = error instanceof SalesProofProvisioningError
    ? error.code
    : databaseCode
      ? `SALES_PROOF_DATABASE_${databaseCode}${
        constraintName ? `_${constraintName}` : ""
      }`
      : "SALES_PROOF_PROVISIONING_FAILED";
  console.error(`LOCAL_SUPABASE_SALES_PROOF_ERROR:${code}`);
  process.exitCode = 1;
});
