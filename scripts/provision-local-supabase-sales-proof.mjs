#!/usr/bin/env node

import postgres from "postgres";

const LEAD_ID = "54600000-0000-4000-8000-000000000001";
const CLIENT_ID = "54600000-0000-4000-8000-000000000002";
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
    });

    console.log(`LOCAL_SUPABASE_SALES_PROOF ${LEAD_ID} ${CLIENT_ID}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  const code =
    error instanceof SalesProofProvisioningError
      ? error.code
      : "SALES_PROOF_PROVISIONING_FAILED";
  console.error(`LOCAL_SUPABASE_SALES_PROOF_ERROR:${code}`);
  process.exitCode = 1;
});
