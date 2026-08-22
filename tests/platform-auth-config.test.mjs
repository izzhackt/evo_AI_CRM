import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getSupabasePublicConfig,
  SupabaseConfigurationError,
} from "../src/lib/supabase/config.ts";
import {
  isProjectSupabaseAuthCookieName,
  isSupabaseAuthCookieName,
} from "../src/lib/supabase/auth-cookies.ts";
import {
  isConnectedPlatformApi,
  isConnectedPlatformPage,
  isConnectedPlatformPrivateApi,
  isDirectPlatformStaffAssistantApi,
  platformHomeRoute,
  platformStaffRedirect,
  platformStudentPortalRedirect,
} from "../src/lib/platform-route-contract.ts";
import { isUiContractFixtureMode } from "../src/lib/runtime-mode.ts";

const scenarioRunnerSource = readFileSync(
  new URL("../scripts/evaluate-scenarios.mjs", import.meta.url),
  "utf8",
);
const loginActionSource = readFileSync(
  new URL("../src/lib/actions.ts", import.meta.url),
  "utf8",
);
const platformAuthSource = readFileSync(
  new URL("../src/lib/platform-auth.ts", import.meta.url),
  "utf8",
);
const platformSessionRouteSource = readFileSync(
  new URL("../src/app/auth/platform-session/route.ts", import.meta.url),
  "utf8",
);
const rootLayoutSource = readFileSync(
  new URL("../src/app/layout.tsx", import.meta.url),
  "utf8",
);
const globalStylesSource = readFileSync(
  new URL("../src/app/globals.css", import.meta.url),
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

test("root fonts are self-hosted and cannot block startup on Google Fonts", () => {
  assert.match(
    rootLayoutSource,
    /import "@fontsource-variable\/golos-text\/wght\.css";/,
  );
  assert.match(
    rootLayoutSource,
    /import "@fontsource-variable\/jetbrains-mono\/wght\.css";/,
  );
  assert.doesNotMatch(rootLayoutSource, /next\/font\/google/);
  assert.match(
    globalStylesSource,
    /--font-golos:\s*"Golos Text Variable";/,
  );
  assert.match(
    globalStylesSource,
    /--font-jbmono:\s*"JetBrains Mono Variable";/,
  );
});

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

test("proxy admits only the exact UUID media API route shape", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  assert.equal(
    isConnectedPlatformApi(`/api/platform-messaging/media/${id}`),
    true,
  );

  for (const path of [
    "/api/platform-messaging/media",
    "/api/platform-messaging/media/123",
    `/api/platform-messaging/media/${id}/download`,
    `/api/platform-messaging/media/${id}/`,
    "/api/platform-messaging/media/not-a-uuid",
    `/api/platform-messaging/messages/${id}`,
  ]) {
    assert.equal(isConnectedPlatformApi(path), false, path);
  }
});

test("proxy passes only the exact staff-assistant API to its own auth boundary", () => {
  assert.equal(
    isDirectPlatformStaffAssistantApi("/api/platform-ai/staff-assistant"),
    true,
  );
  for (const path of [
    "/api/platform-ai/staff-assistant/",
    "/api/platform-ai/staff-assistant/preview",
    "/api/platform-ai",
    "/api/platform-ai/draft",
  ]) {
    assert.equal(isDirectPlatformStaffAssistantApi(path), false, path);
  }
});

test("proxy passes only the exact private service API routes", () => {
  for (const path of [
    "/api/internal/platform-messaging/waha/events",
    "/api/internal/platform-messaging/waha/work",
    "/api/internal/platform-messaging/waha/history",
    "/api/internal/platform-messaging/waha/media",
    "/api/internal/platform-messaging/waha/autonomous-reply",
    "/api/internal/platform-messaging/manual-send/work",
    "/api/internal/platform-operations/portal-overdue",
    "/api/internal/lead-agent/whatsapp",
    "/api/internal/platform-ai/gemini/proposal",
  ]) {
    assert.equal(isConnectedPlatformPrivateApi(path), true, path);
  }

  for (const path of [
    "/api/internal/platform-messaging/waha",
    "/api/internal/platform-messaging/waha/events/extra",
    "/api/internal/platform-messaging/manual-send/work/extra",
    "/api/internal/platform-operations/portal-overdue/extra",
    "/api/internal/lead-agent",
    "/api/internal/lead-agent/whatsapp/extra",
    "/api/internal/platform-ai/gemini",
    "/api/internal/platform-ai/gemini/proposal/extra",
    "/api/internal/platform-ai/gemini/proposal-preview",
  ]) {
    assert.equal(isConnectedPlatformPrivateApi(path), false, path);
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

test("stale-session redirects stay relative to the browser origin", () => {
  assert.match(
    platformSessionRouteSource,
    /Location:\s*sameOriginRedirectLocation\(pathname, error\)/,
  );
  assert.match(platformSessionRouteSource, /status:\s*307/);
  assert.match(platformSessionRouteSource, /pathname\.startsWith\("\/\/"\)/);
  assert.doesNotMatch(platformSessionRouteSource, /request\.nextUrl\.clone\(\)/);
  assert.doesNotMatch(platformSessionRouteSource, /NextResponse\.redirect\(/);
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

test("stale-session repair matches only the configured Supabase project", () => {
  const configuredUrl = "http://127.0.0.1:45421";

  for (const name of [
    "sb-127-auth-token",
    "sb-127-auth-token.0",
    "sb-127-auth-token.12",
  ]) {
    assert.equal(
      isProjectSupabaseAuthCookieName(name, configuredUrl),
      true,
      name,
    );
  }

  for (const name of [
    "edu_session",
    "sb-other-auth-token",
    "sb-127-auth-token-code-verifier",
    "sb-127-auth-token.extra",
    "sb-127-auth-token.-1",
  ]) {
    assert.equal(
      isProjectSupabaseAuthCookieName(name, configuredUrl),
      false,
      name,
    );
  }
});

test("login verifies the just-issued access token and clears rejected sessions", () => {
  const loginStart = loginActionSource.indexOf(
    "export async function loginAction",
  );
  const loginEnd = loginActionSource.indexOf(
    "export async function registerAction",
    loginStart,
  );
  const loginSource = loginActionSource.slice(loginStart, loginEnd);

  const signInCall = loginSource.indexOf(
    "context.client.auth.signInWithPassword",
  );
  const tokenRequirement = loginSource.indexOf(
    "if (!data.session?.access_token)",
  );
  const tokenCapture = loginSource.indexOf(
    "accessToken = data.session.access_token",
  );
  const actorResolution = loginSource.indexOf(
    "resolvePlatformActor(context.client, true, accessToken)",
  );
  const rejectedActor = loginSource.indexOf(
    'if (result.status !== "authenticated")',
    actorResolution,
  );
  const acceptedActorCleanup = loginSource.indexOf(
    "await clearSession();",
    rejectedActor,
  );
  const missingTokenSource = loginSource.slice(
    tokenRequirement,
    tokenCapture,
  );
  const rejectedActorSource = loginSource.slice(
    rejectedActor,
    acceptedActorCleanup,
  );

  assert.notEqual(loginStart, -1);
  assert.notEqual(loginEnd, -1);
  assert.ok(signInCall < tokenRequirement);
  assert.ok(tokenRequirement < tokenCapture);
  assert.ok(tokenCapture < actorResolution);
  assert.match(
    missingTokenSource,
    /await clearPlatformAuthSession\(context\.client\);[\s\S]*return "platformUnavailable";/,
  );
  assert.match(
    rejectedActorSource,
    /result\.reason === "authority_lookup_failed"[\s\S]*\? "platformUnavailable"[\s\S]*: "accessNotProvisioned";/,
  );
  assert.match(
    rejectedActorSource,
    /await clearPlatformAuthSession\(context\.client\);[\s\S]*return rejectionError;/,
  );
  assert.doesNotMatch(loginSource, /auth\.getSession\(/);
});

test("Platform actor verifies the supplied token before live authority", () => {
  const resolverStart = platformAuthSource.indexOf(
    "export async function resolvePlatformActor",
  );
  const resolverSource = platformAuthSource.slice(resolverStart);
  const claimsVerification = resolverSource.indexOf(
    "context.client.auth.getClaims(accessToken)",
  );
  const authorityLookup = resolverSource.indexOf(
    '.rpc("current_actor_authority")',
  );

  assert.notEqual(resolverStart, -1);
  assert.match(resolverSource, /accessToken\?: string/);
  assert.notEqual(claimsVerification, -1);
  assert.notEqual(authorityLookup, -1);
  assert.ok(claimsVerification < authorityLookup);
  assert.doesNotMatch(resolverSource, /auth\.getSession\(/);
});

test("auth verification diagnostics cannot emit provider messages or tokens", () => {
  const loggerStart = platformAuthSource.indexOf(
    "function logAuthVerificationFailure",
  );
  const loggerEnd = platformAuthSource.indexOf(
    "function parseAuthority",
    loggerStart,
  );
  const loggerSource = platformAuthSource.slice(loggerStart, loggerEnd);

  assert.notEqual(loggerStart, -1);
  assert.notEqual(loggerEnd, -1);
  assert.match(loggerSource, /safeAuthErrorLabel\(record\.name\)/);
  assert.match(loggerSource, /safeAuthErrorLabel\(record\.code\)/);
  assert.doesNotMatch(
    loggerSource,
    /record\.message|error\.message|accessToken|JSON\.stringify\(error\)/,
  );
});
