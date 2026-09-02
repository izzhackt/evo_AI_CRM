#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const TRANSIENT_RETRY_WINDOW_MS = 30_000;
const TRANSIENT_RETRY_DELAY_MS = 1_000;

class ProvisioningFailure extends Error {
  constructor(code) {
    super(code);
    this.name = "ProvisioningFailure";
    this.code = code;
  }
}

function fail(code) {
  throw new ProvisioningFailure(code);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function assertNoErrorWithRetry(factory, code) {
  const deadline = Date.now() + TRANSIENT_RETRY_WINDOW_MS;

  while (true) {
    let result;
    try {
      result = await factory();
    } catch {
      result = { data: null, error: new Error(code) };
    }

    if (!result?.error) return result.data;
    if (Date.now() >= deadline) fail(code);
    await delay(TRANSIENT_RETRY_DELAY_MS);
  }
}

function firstConfigured(names, missingCode) {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.length > 0) return value;
  }
  fail(missingCode);
}

function readLocalUrl() {
  const raw = firstConfigured(
    ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL", "API_URL"],
    "LOCAL_URL_MISSING",
  );

  let url;
  try {
    url = new URL(raw);
  } catch {
    fail("LOCAL_URL_INVALID");
  }

  const loopbackHostnames = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if (
    !loopbackHostnames.has(url.hostname) ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    fail("LOCAL_URL_NOT_LOOPBACK");
  }

  return url.origin;
}

function readKey(names, missingCode, invalidCode) {
  const value = firstConfigured(names, missingCode);
  if (value.length < 16 || /\s/.test(value)) fail(invalidCode);
  return value;
}

function readIdentity(role) {
  const prefix = `EVO_STAFF_AUTH_${role}`;
  const email = firstConfigured([`${prefix}_EMAIL`], `${role}_EMAIL_MISSING`)
    .trim()
    .toLowerCase();
  const password = firstConfigured(
    [`${prefix}_PASSWORD`],
    `${role}_PASSWORD_MISSING`,
  );

  if (!EMAIL_PATTERN.test(email)) fail(`${role}_EMAIL_INVALID`);
  if (password.length < 8 || /[\r\n]/.test(password)) {
    fail(`${role}_PASSWORD_INVALID`);
  }

  return { email, password };
}

function clientOptions() {
  return {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  };
}

function newClient(url, key) {
  return createClient(url, key, clientOptions());
}

function assertUuid(value, code) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) fail(code);
  return value;
}

function assertNoError(result, code) {
  if (result.error) {
    const upstreamCode =
      typeof result.error.code === "string" &&
      /^[A-Za-z0-9_-]+$/.test(result.error.code)
        ? result.error.code.toUpperCase().replaceAll("-", "_")
        : null;
    fail(upstreamCode ? `${code}_${upstreamCode}` : code);
  }
  return result.data;
}

function oneRow(data, code) {
  if (!Array.isArray(data) || data.length !== 1) fail(code);
  const row = data[0];
  if (!row || typeof row !== "object" || Array.isArray(row)) fail(code);
  return row;
}

async function createConfirmedUser(adminClient, identity, displayName, code) {
  const data = await assertNoErrorWithRetry(
    () =>
      adminClient.auth.admin.createUser({
        email: identity.email,
        password: identity.password,
        email_confirm: true,
        user_metadata: { display_name: displayName },
      }),
    `${code}_CREATE_FAILED`,
  );
  const user = data?.user;
  assertUuid(user?.id, `${code}_USER_INVALID`);
  if (
    user.email?.toLowerCase() !== identity.email ||
    (!user.email_confirmed_at && !user.confirmed_at)
  ) {
    fail(`${code}_CONFIRMATION_FAILED`);
  }
  return user;
}

async function signIn(url, publishableKey, identity, code) {
  const client = newClient(url, publishableKey);
  const data = await assertNoErrorWithRetry(
    () => client.auth.signInWithPassword(identity),
    `${code}_SIGN_IN_FAILED`,
  );
  if (!data?.session?.access_token || !data?.user?.id) {
    fail(`${code}_SESSION_INVALID`);
  }
  return { client, user: data.user };
}

async function readAuthority(client, expected, code) {
  const data = assertNoError(
    await client.schema("platform").rpc("current_actor_authority"),
    `${code}_RPC_FAILED`,
  );
  const row = oneRow(data, `${code}_ROW_INVALID`);
  if (
    row.auth_user_id !== expected.authUserId ||
    row.organization_id !== expected.organizationId ||
    row.platform_role !== expected.role ||
    typeof row.display_name !== "string" ||
    row.display_name.trim().length === 0 ||
    !Number.isSafeInteger(Number(row.platform_access_version)) ||
    Number(row.platform_access_version) < 1
  ) {
    fail(`${code}_MISMATCH`);
  }
  assertUuid(row.profile_id, `${code}_PROFILE_INVALID`);
  assertUuid(row.membership_id, `${code}_MEMBERSHIP_INVALID`);
  return row;
}

async function assertNoAuthority(client, code) {
  const { data, error } = await client
    .schema("platform")
    .rpc("current_actor_authority");
  if (error) {
    if (error.code !== "42501") fail(`${code}_UNEXPECTED_ERROR`);
    return;
  }
  if (!Array.isArray(data) || data.length !== 0) fail(`${code}_NOT_DENIED`);
}

async function assertStaffDirectoryDenied(client, organizationId, code) {
  const { data, error } = await client
    .schema("platform")
    .rpc("staff_directory", { p_organization_id: organizationId });
  if (!error || error.code !== "42501" || data !== null) {
    fail(`${code}_NOT_DENIED`);
  }
}

async function assertSensitivePermission(client, organizationId, permissionKey, code) {
  const result = assertNoError(
    await client.schema("platform").rpc("assert_sensitive_permission", {
      p_organization_id: organizationId,
      p_permission_key: permissionKey,
    }),
    `${code}_RPC_FAILED`,
  );
  if (
    !result ||
    result.organization_id !== organizationId ||
    result.permission_key !== permissionKey ||
    result.authorized !== true
  ) {
    fail(`${code}_MISMATCH`);
  }
}

async function assertSensitivePermissionDenied(
  client,
  organizationId,
  permissionKey,
  code,
) {
  const { data, error } = await client
    .schema("platform")
    .rpc("assert_sensitive_permission", {
      p_organization_id: organizationId,
      p_permission_key: permissionKey,
    });
  if (!error || error.code !== "42501" || data !== null) {
    fail(`${code}_NOT_DENIED`);
  }
}

async function main() {
  const url = readLocalUrl();
  const publishableKey = readKey(
    [
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_PUBLISHABLE_KEY",
      "PUBLISHABLE_KEY",
    ],
    "PUBLISHABLE_KEY_MISSING",
    "PUBLISHABLE_KEY_INVALID",
  );
  const serverKey = readKey(
    [
      "EVO_PLATFORM_SUPABASE_SECRET_KEY",
      "SUPABASE_SECRET_KEY",
      "SECRET_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "SERVICE_ROLE_KEY",
    ],
    "SERVER_KEY_MISSING",
    "SERVER_KEY_INVALID",
  );
  if (publishableKey === serverKey) fail("KEY_BOUNDARY_INVALID");

  const identities = {
    admin: readIdentity("ADMIN"),
    sales: readIdentity("SALES"),
    admissions: readIdentity("ADMISSIONS"),
  };
  if (new Set(Object.values(identities).map(({ email }) => email)).size !== 3) {
    fail("STAFF_EMAILS_NOT_DISTINCT");
  }

  const adminServiceClient = newClient(url, serverKey);

  const adminUser = await createConfirmedUser(
    adminServiceClient,
    identities.admin,
    "Local Admin",
    "ADMIN",
  );
  const salesUser = await createConfirmedUser(
    adminServiceClient,
    identities.sales,
    "Local Sales Manager",
    "SALES",
  );
  const admissionsUser = await createConfirmedUser(
    adminServiceClient,
    identities.admissions,
    "Local Admissions Manager",
    "ADMISSIONS",
  );

  const bootstrap = assertNoError(
    await adminServiceClient
      .schema("platform")
      .rpc("bootstrap_organization_admin", {
        p_organization_name: "EVO Local Verification",
        p_admin_auth_user_id: adminUser.id,
        p_admin_display_name: "Local Admin",
        p_reason: "Provision isolated local staff verification authority",
        p_request_id: randomUUID(),
      }),
    "ADMIN_BOOTSTRAP_FAILED",
  );
  const organizationId = assertUuid(
    bootstrap?.organization_id,
    "ORGANIZATION_ID_INVALID",
  );

  let adminSession = await signIn(
    url,
    publishableKey,
    identities.admin,
    "ADMIN",
  );
  const adminAuthority = await readAuthority(
    adminSession.client,
    { authUserId: adminUser.id, organizationId, role: "admin" },
    "ADMIN_AUTHORITY",
  );

  async function provisionMember(user, displayName, role, code) {
    const provisioned = assertNoError(
      await adminSession.client
        .schema("platform")
        .rpc("provision_pilot_staff_member", {
          p_organization_id: organizationId,
          p_member_auth_user_id: user.id,
          p_member_display_name: displayName,
          p_role: role,
          p_reason: `Provision isolated local ${role} verification authority`,
          p_request_id: randomUUID(),
        }),
      `${code}_PROVISION_FAILED`,
    );
    return assertUuid(provisioned?.membership_id, `${code}_MEMBERSHIP_INVALID`);
  }

  const salesMembershipId = await provisionMember(
    salesUser,
    "Local Sales Manager",
    "sales",
    "SALES",
  );
  await provisionMember(
    admissionsUser,
    "Local Admissions Manager",
    "curator",
    "ADMISSIONS",
  );

  async function grantPermission(targetMembershipId, permissionKey, code) {
    const result = assertNoError(
      await adminSession.client
        .schema("platform")
        .rpc("change_membership_permission", {
          p_organization_id: organizationId,
          p_membership_id: targetMembershipId,
          p_permission_key: permissionKey,
          p_granted: true,
          p_reason: `Grant isolated local ${permissionKey} verification authority`,
          p_request_id: randomUUID(),
        }),
      `${code}_GRANT_FAILED`,
    );
    if (
      !result ||
      result.organization_id !== organizationId ||
      result.membership_id !== targetMembershipId ||
      result.permission_key !== permissionKey ||
      result.granted !== true
    ) {
      fail(`${code}_GRANT_MISMATCH`);
    }

    if (targetMembershipId === adminAuthority.membership_id) {
      adminSession = await signIn(
        url,
        publishableKey,
        identities.admin,
        `${code}_ADMIN_REFRESH`,
      );
    }
  }

  await grantPermission(
    salesMembershipId,
    "contract.evidence.confirm",
    "SALES_CONTRACT_PERMISSION",
  );
  await grantPermission(
    salesMembershipId,
    "finance.first.payment.confirm",
    "SALES_PAYMENT_PERMISSION",
  );
  await grantPermission(
    adminAuthority.membership_id,
    "contract.evidence.confirm",
    "ADMIN_CONTRACT_PERMISSION",
  );
  await grantPermission(
    adminAuthority.membership_id,
    "finance.first.payment.confirm",
    "ADMIN_PAYMENT_PERMISSION",
  );
  await grantPermission(
    adminAuthority.membership_id,
    "admissions.handoff.gate.override",
    "ADMIN_OVERRIDE_PERMISSION",
  );

  await readAuthority(
    adminSession.client,
    { authUserId: adminUser.id, organizationId, role: "admin" },
    "ADMIN_REFRESHED_AUTHORITY",
  );
  await assertSensitivePermission(
    adminSession.client,
    organizationId,
    "contract.evidence.confirm",
    "ADMIN_CONTRACT_PERMISSION",
  );
  await assertSensitivePermission(
    adminSession.client,
    organizationId,
    "finance.first.payment.confirm",
    "ADMIN_PAYMENT_PERMISSION",
  );
  await assertSensitivePermission(
    adminSession.client,
    organizationId,
    "admissions.handoff.gate.override",
    "ADMIN_OVERRIDE_PERMISSION",
  );

  const salesSession = await signIn(
    url,
    publishableKey,
    identities.sales,
    "SALES",
  );
  await readAuthority(
    salesSession.client,
    { authUserId: salesUser.id, organizationId, role: "sales" },
    "SALES_AUTHORITY",
  );

  const admissionsSession = await signIn(
    url,
    publishableKey,
    identities.admissions,
    "ADMISSIONS",
  );
  await readAuthority(
    admissionsSession.client,
    { authUserId: admissionsUser.id, organizationId, role: "curator" },
    "ADMISSIONS_AUTHORITY",
  );
  await assertSensitivePermissionDenied(
    admissionsSession.client,
    organizationId,
    "contract.evidence.confirm",
    "ADMISSIONS_CONTRACT_PERMISSION",
  );

  await assertNoAuthority(
    newClient(url, publishableKey),
    "UNAUTHENTICATED_AUTHORITY",
  );
  await assertStaffDirectoryDenied(
    salesSession.client,
    organizationId,
    "SALES_STAFF_DIRECTORY",
  );
  await assertStaffDirectoryDenied(
    admissionsSession.client,
    organizationId,
    "ADMISSIONS_STAFF_DIRECTORY",
  );

  const directory = assertNoError(
    await adminSession.client
      .schema("platform")
      .rpc("staff_directory", { p_organization_id: organizationId }),
    "ADMIN_STAFF_DIRECTORY_FAILED",
  );
  const directoryRoles = Array.isArray(directory)
    ? directory.map((row) => row?.platform_role).sort()
    : [];
  if (JSON.stringify(directoryRoles) !== JSON.stringify(["admin", "curator", "sales"])) {
    fail("ADMIN_STAFF_DIRECTORY_MISMATCH");
  }

  assertNoError(
    await adminSession.client
      .schema("platform")
      .rpc("change_pilot_staff_status", {
        p_organization_id: organizationId,
        p_membership_id: salesMembershipId,
        p_new_status: "inactive",
        p_reason: "Verify immediate invalidation of a live local Sales token",
        p_request_id: randomUUID(),
      }),
    "SALES_SUSPEND_FAILED",
  );
  await assertNoAuthority(salesSession.client, "SALES_STALE_TOKEN_AFTER_SUSPEND");

  assertNoError(
    await adminSession.client
      .schema("platform")
      .rpc("change_pilot_staff_status", {
        p_organization_id: organizationId,
        p_membership_id: salesMembershipId,
        p_new_status: "active",
        p_reason: "Reactivate local Sales after token invalidation proof",
        p_request_id: randomUUID(),
      }),
    "SALES_REACTIVATE_FAILED",
  );
  await assertNoAuthority(salesSession.client, "SALES_STALE_TOKEN_AFTER_REACTIVATE");

  const refreshedSalesSession = await signIn(
    url,
    publishableKey,
    identities.sales,
    "SALES_REACTIVATED",
  );
  await readAuthority(
    refreshedSalesSession.client,
    { authUserId: salesUser.id, organizationId, role: "sales" },
    "SALES_REACTIVATED_AUTHORITY",
  );
  await assertSensitivePermission(
    refreshedSalesSession.client,
    organizationId,
    "contract.evidence.confirm",
    "SALES_CONTRACT_PERMISSION",
  );
  await assertSensitivePermission(
    refreshedSalesSession.client,
    organizationId,
    "finance.first.payment.confirm",
    "SALES_PAYMENT_PERMISSION",
  );

  process.stdout.write("LOCAL_SUPABASE_STAFF_PROVISIONED\n");
}

try {
  await main();
} catch (error) {
  const code =
    error instanceof ProvisioningFailure ? error.code : "UNEXPECTED_FAILURE";
  process.stderr.write(`LOCAL_SUPABASE_STAFF_ERROR:${code}\n`);
  process.exitCode = 1;
}
