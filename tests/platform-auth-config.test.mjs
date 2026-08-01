import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getSupabasePublicConfig,
  SupabaseConfigurationError,
} from "../src/lib/supabase/config.ts";
import { isSupabaseAuthCookieName } from "../src/lib/supabase/auth-cookies.ts";
import {
  isConnectedPlatformPage,
  platformHomeRoute,
  platformStaffRedirect,
  platformStudentPortalRedirect,
} from "../src/lib/platform-route-contract.ts";
import { isUiContractFixtureMode } from "../src/lib/runtime-mode.ts";

const scenarioRunnerSource = readFileSync(
  new URL("../scripts/evaluate-scenarios.mjs", import.meta.url),
  "utf8",
);

const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  EVO_UI_CONTRACT_FIXTURES: process.env.EVO_UI_CONTRACT_FIXTURES,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test.afterEach(restoreEnv);

function jwtForRole(role) {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString(
    "base64url",
  );
  const payload = Buffer.from(JSON.stringify({ role })).toString("base64url");
  return `${header}.${payload}.signature`;
}

test("public Supabase config accepts only an HTTPS or loopback origin", () => {
  process.env.NODE_ENV = "production";
  process.env.NEXT_PUBLIC_SUPABASE_URL =
    "https://example-project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
    "sb_publishable_safe-placeholder";
  assert.deepEqual(getSupabasePublicConfig(), {
    url: "https://example-project.supabase.co",
    publishableKey: "sb_publishable_safe-placeholder",
  });

  process.env.NODE_ENV = "test";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:45421";
  assert.equal(
    getSupabasePublicConfig().url,
    "http://127.0.0.1:45421",
  );

  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.internal:8000";
  assert.throws(
    () => getSupabasePublicConfig(),
    (error) =>
      error instanceof SupabaseConfigurationError &&
      error.code === "insecure_url",
  );
});

test("browser config rejects secret and service-role credentials", () => {
  process.env.NODE_ENV = "test";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:45421";

  for (const unsafeKey of [
    "sb_secret_never_in_browser",
    jwtForRole("service_role"),
  ]) {
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = unsafeKey;
    assert.throws(
      () => getSupabasePublicConfig(),
      (error) =>
        error instanceof SupabaseConfigurationError &&
        error.code === "unsafe_publishable_key",
    );
  }

  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = jwtForRole("anon");
  assert.equal(
    getSupabasePublicConfig().publishableKey,
    jwtForRole("anon"),
  );
});

test("legacy UI-contract fixtures are impossible in production", () => {
  process.env.EVO_UI_CONTRACT_FIXTURES = "1";
  process.env.NODE_ENV = "production";
  assert.throws(
    () => isUiContractFixtureMode(),
    /cannot be enabled in production/,
  );

  process.env.NODE_ENV = "test";
  assert.equal(isUiContractFixtureMode(), true);
  process.env.EVO_UI_CONTRACT_FIXTURES = "0";
  assert.equal(isUiContractFixtureMode(), false);
});

test("legacy scenario fixtures use only the non-production Next server", () => {
  assert.match(
    scenarioRunnerSource,
    /"node_modules\/next\/dist\/bin\/next",\s*"dev"/,
  );
  assert.doesNotMatch(
    scenarioRunnerSource,
    /"node_modules\/next\/dist\/bin\/next",\s*"start"/,
  );
  assert.match(
    scenarioRunnerSource,
    /EVO_UI_CONTRACT_FIXTURES:\s*"1"/,
  );
});

test("proxy admits only the exact connected conversation route shape", () => {
  const id = "a120b6db-2e3e-4a84-8873-073f4d2d33c3";
  for (const path of ["/", "/login", "/platform-pending", "/whatsapp"]) {
    assert.equal(isConnectedPlatformPage(path), true, path);
  }
  assert.equal(isConnectedPlatformPage(`/whatsapp/${id}`), true);

  for (const path of [
    "/whatsapp/not-a-uuid",
    `/whatsapp/${id}/messages`,
    `/legacy/whatsapp/${id}`,
    "/dashboard",
    "/api/waha/qr",
  ]) {
    assert.equal(isConnectedPlatformPage(path), false, path);
  }
});

test("proxy admits every accepted portal page and rejects portal descendants", () => {
  const portalPages = [
    "/portal",
    "/portal/applications",
    "/portal/documents",
    "/portal/messages",
    "/portal/notifications",
    "/portal/payments",
    "/portal/profile",
    "/portal/team",
    "/portal/visa",
  ];
  for (const path of portalPages) {
    assert.equal(isConnectedPlatformPage(path), true, path);
  }

  for (const path of [
    "/portal/",
    "/portal/profile/edit",
    "/portal/applications/not-a-uuid",
    "/portal/api",
    "/api/portal/profile",
    "/legacy/portal",
  ]) {
    assert.equal(isConnectedPlatformPage(path), false, path);
  }
});

test("student home and guard redirects keep roles on their connected surface", () => {
  assert.equal(platformHomeRoute("student"), "/portal");
  assert.equal(platformStaffRedirect("student"), "/portal");
  assert.equal(platformStaffRedirect("admin"), null);
  assert.equal(platformStudentPortalRedirect("student"), null);
  assert.equal(platformStudentPortalRedirect("admin"), "/sales");
  assert.equal(platformStudentPortalRedirect("sales"), "/sales");
  assert.equal(platformStudentPortalRedirect("curator"), "/clients");
  assert.equal(
    platformStudentPortalRedirect("finance"),
    "/platform-pending",
  );
});

test("logout fallback matches only Supabase auth-token cookies", () => {
  for (const name of [
    "sb-projectref-auth-token",
    "sb-projectref-auth-token.0",
    "sb-127-auth-token.12",
  ]) {
    assert.equal(isSupabaseAuthCookieName(name), true, name);
  }

  for (const name of [
    "edu_session",
    "sb-projectref-auth-token-code-verifier",
    "sb-projectref-auth-token.extra",
    "sb--auth-token",
  ]) {
    assert.equal(isSupabaseAuthCookieName(name), false, name);
  }
});
