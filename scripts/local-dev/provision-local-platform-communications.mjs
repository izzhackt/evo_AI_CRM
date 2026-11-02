#!/usr/bin/env node

import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const API_KEY_PATTERN = /^[^\r\n]{16,4096}$/u;

class ProvisioningError extends Error {
  constructor(code) {
    super(code);
    this.name = "ProvisioningError";
    this.code = code;
  }
}

function required(name, pattern, code) {
  const value = process.env[name];
  if (!value || value !== value.trim() || !pattern.test(value)) {
    throw new ProvisioningError(code);
  }
  return value;
}

function one(value, code) {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new ProvisioningError(code);
  }
  return value[0];
}

async function main() {
  const url = required(
    "NEXT_PUBLIC_SUPABASE_URL",
    /^http:\/\/(?:127\.0\.0\.1|localhost):[1-9][0-9]{0,4}$/u,
    "SUPABASE_URL_INVALID",
  );
  const publishableKey = required(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    /^.{16,8192}$/u,
    "PUBLISHABLE_KEY_INVALID",
  );
  const serviceKey = required(
    "EVO_PLATFORM_SUPABASE_SECRET_KEY",
    /^.{16,8192}$/u,
    "SERVICE_KEY_INVALID",
  );
  const adminEmail = required(
    "EVO_STAFF_AUTH_ADMIN_EMAIL",
    /^[^\s@]+@[^\s@]+$/u,
    "ADMIN_EMAIL_INVALID",
  );
  const adminPassword = required(
    "EVO_STAFF_AUTH_ADMIN_PASSWORD",
    /^.{16,4096}$/u,
    "ADMIN_PASSWORD_INVALID",
  );
  const salesEmail = required(
    "EVO_STAFF_AUTH_SALES_EMAIL",
    /^[^\s@]+@[^\s@]+$/u,
    "SALES_EMAIL_INVALID",
  );
  const salesPassword = required(
    "EVO_STAFF_AUTH_SALES_PASSWORD",
    /^.{16,4096}$/u,
    "SALES_PASSWORD_INVALID",
  );
  const wahaApiKey = required(
    "EVO_TEST_WAHA_API_KEY",
    API_KEY_PATTERN,
    "WAHA_API_KEY_INVALID",
  );

  const authClient = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await authClient.auth.signInWithPassword({
    email: adminEmail,
    password: adminPassword,
  });
  if (signIn.error || !signIn.data.user || !signIn.data.session) {
    throw new ProvisioningError("ADMIN_SIGN_IN_FAILED");
  }

  const authorityResponse = await authClient
    .schema("platform")
    .rpc("staff_access_snapshot");
  if (authorityResponse.error) {
    throw new ProvisioningError("ADMIN_AUTHORITY_FAILED");
  }
  const authority = authorityResponse.data;
  if (
    !authority ||
    authority.schemaVersion !== 1 || !UUID_PATTERN.test(authority.organizationId) ||
    authority.authUserId !== signIn.data.user.id || authority.systemRole !== "admin"
  ) {
    throw new ProvisioningError("ADMIN_AUTHORITY_INVALID");
  }

  const serviceClient = createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const provisionResponse = await serviceClient
    .schema("platform")
    .rpc("provision_manual_send_waha_runtime", {
      p_organization_id: authority.organizationId,
      p_waha_api_key: wahaApiKey,
      p_request_id: randomUUID(),
    });
  if (provisionResponse.error) {
    throw new ProvisioningError("WAHA_RUNTIME_PROVISION_FAILED");
  }
  const configuration = one(
    provisionResponse.data,
    "WAHA_RUNTIME_CONFIGURATION_INVALID",
  );
  if (
    !configuration ||
    configuration.organization_id !== authority.organizationId ||
    configuration.ready !== true ||
    configuration.reason_code !== "ready" ||
    configuration.waha_session_name !== "crm_primary" ||
    configuration.base_url !== "http://evo-crm-waha:3000" ||
    !/^[0-9a-f]{64}$/u.test(configuration.api_key_sha256)
  ) {
    throw new ProvisioningError("WAHA_RUNTIME_CONFIGURATION_INVALID");
  }

  const salesSignIn = await authClient.auth.signInWithPassword({
    email: salesEmail,
    password: salesPassword,
  });
  if (salesSignIn.error || !salesSignIn.data.user || !salesSignIn.data.session) {
    throw new ProvisioningError("SALES_SIGN_IN_FAILED");
  }
  const salesAuthorityResponse = await authClient
    .schema("platform")
    .rpc("staff_access_snapshot");
  if (salesAuthorityResponse.error) {
    throw new ProvisioningError("SALES_AUTHORITY_FAILED");
  }
  const salesAuthority = salesAuthorityResponse.data;
  if (
    !salesAuthority ||
    salesAuthority.schemaVersion !== 1 || salesAuthority.organizationId !== authority.organizationId ||
    salesAuthority.authUserId !== salesSignIn.data.user.id || !UUID_PATTERN.test(salesAuthority.membershipId) ||
    salesAuthority.systemRole !== "staff" || !Array.isArray(salesAuthority.permissions) ||
    !salesAuthority.permissions.includes("lead.read") || !salesAuthority.permissions.includes("communication.manual.send") ||
    !salesAuthority.assignments?.length
  ) {
    throw new ProvisioningError("SALES_AUTHORITY_INVALID");
  }

  process.stdout.write(
    `LOCAL_PLATFORM_COMMUNICATIONS_PROVISIONED ${authority.organizationId} ${salesAuthority.membershipId}\n`,
  );
}

try {
  await main();
} catch (error) {
  const code = error instanceof ProvisioningError ? error.code : "UNEXPECTED";
  process.stderr.write(`LOCAL_PLATFORM_COMMUNICATIONS_ERROR:${code}\n`);
  process.exitCode = 1;
}
