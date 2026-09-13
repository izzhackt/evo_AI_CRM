#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "@playwright/test";
import { prepareScopedStaffRoles, prepareScopedStaffInvitations, acceptScopedStaffInvitations, verifyScopedStaffRoleEditor, verifyScopedStaffMemberEditor, ScopedStaffProvisioningError } from "./lib/scoped-staff-provisioner.mjs";

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

// Only the first, one-shot system Admin is bootstrapped. Employees use real mail.
async function createBootstrapAdmin(adminClient, identity, displayName, code) {
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
    await client.schema("platform").rpc("staff_access_snapshot"),
    `${code}_RPC_FAILED`,
  );
  const row = data;
  if (
    !row || row.schemaVersion !== 1 ||
    row.authUserId !== expected.authUserId ||
    (expected.organizationId && row.organizationId !== expected.organizationId) ||
    row.systemRole !== expected.systemRole ||
    typeof row.displayName !== "string" || !row.displayName.trim() ||
    !Number.isSafeInteger(row.accessVersion) || row.accessVersion < 1 ||
    !Array.isArray(row.assignments) || !Array.isArray(row.permissions) ||
    (expected.permission && !row.permissions.includes(expected.permission))
  ) {
    fail(`${code}_MISMATCH`);
  }
  assertUuid(row.profileId, `${code}_PROFILE_INVALID`);
  assertUuid(row.membershipId, `${code}_MEMBERSHIP_INVALID`);
  assertUuid(row.organizationId, `${code}_ORGANIZATION_INVALID`);
  return row;
}

async function assertNoAuthority(client, code) {
  const { data, error } = await client
    .schema("platform")
    .rpc("staff_access_snapshot");
  if (error) {
    if (error.code !== "42501") fail(`${code}_UNEXPECTED_ERROR`);
    return;
  }
  if (data !== null) fail(`${code}_NOT_DENIED`);
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

  const phase = process.env.EVO_LOCAL_STAFF_PHASE;
  if (!["bootstrap", "onboard", "onboarding-proof"].includes(phase)) fail("PHASE_REQUIRED");
  if (phase === "bootstrap") {
    const adminUser = await createBootstrapAdmin(adminServiceClient, identities.admin, "Local Admin", "ADMIN");
    const bootstrap = assertNoError(await adminServiceClient.schema("platform").rpc("bootstrap_organization_admin", {
      p_organization_name: "EVO Local Verification", p_admin_auth_user_id: adminUser.id,
      p_admin_display_name: "Local Admin", p_reason: "Bootstrap isolated local system Admin",
      p_request_id: randomUUID(),
    }), "ADMIN_BOOTSTRAP_FAILED");
    const organizationId = assertUuid(bootstrap?.organization_id, "ORGANIZATION_ID_INVALID");
    const session = await signIn(url, publishableKey, identities.admin, "ADMIN_BOOTSTRAP");
    await readAuthority(session.client, { authUserId: session.user.id, organizationId, systemRole: "admin" }, "ADMIN_BOOTSTRAP_AUTHORITY");
    process.stdout.write(`LOCAL_SUPABASE_ADMIN_BOOTSTRAPPED ${organizationId}\n`);
    return;
  }

  let adminSession = await signIn(
    url,
    publishableKey,
    identities.admin,
    "ADMIN",
  );
  const adminAuthority = await readAuthority(
    adminSession.client,
    { authUserId: adminSession.user.id, systemRole: "admin" },
    "ADMIN_AUTHORITY",
  );
  const organizationId = adminAuthority.organizationId;
  const appOrigin = firstConfigured(["EVO_STAFF_AUTH_APP_ORIGIN"], "APP_ORIGIN_REQUIRED");
  const mailpitOrigin = firstConfigured(["EVO_STAFF_AUTH_MAILPIT_ORIGIN"], "MAILPIT_ORIGIN_REQUIRED");
  const browser = await chromium.launch({ headless: true });
  let accepted;
  try {
    const rolePreparation = await prepareScopedStaffRoles({ adminClient: adminSession.client, apiUrl: url, organizationId });
    const prepared = await prepareScopedStaffInvitations({ browser, adminClient: adminSession.client,
      apiUrl: url, organizationId, appOrigin, identity: identities.admin, rolePreparation,
      identities: { sales: { email: identities.sales.email, displayName: "Local Sales Manager" },
        admissions: { email: identities.admissions.email, displayName: "Local Admissions Manager" } } });
    process.stdout.write("LOCAL_SCOPED_STAFF_INVITATION_UI_VERIFIED\n");
    accepted = await acceptScopedStaffInvitations({ browser, adminClient: adminSession.client,
      authAdminClient: adminServiceClient, apiUrl: url, publishableKey, mailpitOrigin,
      appOrigin, prepared, identities });
    if (phase === "onboarding-proof") process.stdout.write("LOCAL_SUPABASE_STAFF_ONBOARDING_VERIFIED\n");
    await verifyScopedStaffRoleEditor({ browser, adminClient: adminSession.client, apiUrl: url,
      appOrigin, organizationId, identity: identities.admin,
      evidenceDirectory: process.env.EVO_LOCAL_STAFF_ROLE_EDITOR_EVIDENCE_DIR });
    process.stdout.write("LOCAL_SCOPED_STAFF_ROLE_EDITOR_VERIFIED\n");
    await verifyScopedStaffMemberEditor({ browser, adminClient: adminSession.client, apiUrl: url,
      appOrigin, organizationId, identity: identities.admin, accepted });
    process.stdout.write("LOCAL_SCOPED_STAFF_MEMBER_EDITOR_VERIFIED\n");
  } finally { await browser.close(); }
  if (phase === "onboarding-proof") {
    return;
  }
  const salesMembershipId = assertUuid(accepted.members.find((member) => member.scenario === "sales")?.membershipId, "SALES_MEMBERSHIP_INVALID");

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

    if (targetMembershipId === adminAuthority.membershipId) {
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
    adminAuthority.membershipId,
    "contract.evidence.confirm",
    "ADMIN_CONTRACT_PERMISSION",
  );
  await grantPermission(
    adminAuthority.membershipId,
    "finance.first.payment.confirm",
    "ADMIN_PAYMENT_PERMISSION",
  );
  await grantPermission(
    adminAuthority.membershipId,
    "admissions.handoff.gate.override",
    "ADMIN_OVERRIDE_PERMISSION",
  );

  await readAuthority(
    adminSession.client,
    { authUserId: adminSession.user.id, organizationId, systemRole: "admin" },
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
  const salesAuthority = await readAuthority(
    salesSession.client,
    { authUserId: salesSession.user.id, organizationId, systemRole: "staff", permission: "lead.read" },
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
    { authUserId: admissionsSession.user.id, organizationId, systemRole: "staff", permission: "case.read.full" },
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
  const directoryMembers = Array.isArray(directory)
    ? directory.map((row) => row?.membership_id).sort()
    : [];
  if (JSON.stringify(directoryMembers) !== JSON.stringify([adminAuthority.membershipId,
    ...accepted.members.map((member) => member.membershipId)].sort())) {
    fail("ADMIN_STAFF_DIRECTORY_MISMATCH");
  }

  const suspended = assertNoError(
    await adminSession.client
      .schema("platform")
      .rpc("staff_workspace_change_member", {
        p_organization_id: organizationId,
        p_membership_id: salesMembershipId,
        p_expected_version: salesAuthority.accessVersion,
        p_operation: "status", p_value: "suspended",
        p_reason: "Verify immediate invalidation of a live local Sales token",
        p_request_id: randomUUID(),
      }),
    "SALES_SUSPEND_FAILED",
  );
  await assertNoAuthority(salesSession.client, "SALES_STALE_TOKEN_AFTER_SUSPEND");

  assertNoError(
    await adminSession.client
      .schema("platform")
      .rpc("staff_workspace_change_member", {
        p_organization_id: organizationId,
        p_membership_id: salesMembershipId,
        p_expected_version: suspended.access_version,
        p_operation: "status", p_value: "active",
        p_reason: "Reactivate local Sales after token invalidation proof",
        p_request_id: randomUUID(),
      }),
    "SALES_REACTIVATE_FAILED",
  );
  // S2 resolves current rights from the live identity, not a stale JWT role/version.
  await readAuthority(salesSession.client, {
    authUserId: salesSession.user.id, organizationId, systemRole: "staff", permission: "lead.read",
  }, "SALES_LIVE_AUTHORITY_AFTER_REACTIVATE");

  const refreshedSalesSession = await signIn(
    url,
    publishableKey,
    identities.sales,
    "SALES_REACTIVATED",
  );
  await readAuthority(
    refreshedSalesSession.client,
    { authUserId: refreshedSalesSession.user.id, organizationId, systemRole: "staff", permission: "lead.read" },
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
    (error instanceof ProvisioningFailure || error instanceof ScopedStaffProvisioningError)
      && /^[A-Z0-9_]+$/u.test(error.code) ? error.code : "UNEXPECTED_FAILURE";
  process.stderr.write(`LOCAL_SUPABASE_STAFF_ERROR:${code}\n`);
  process.exitCode = 1;
}
