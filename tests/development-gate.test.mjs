import assert from "node:assert/strict";
import test from "node:test";

import {
  DEVELOPMENT_GATE_ROLES,
  DEVELOPMENT_SESSION_COOKIE,
  DEVELOPMENT_SESSION_MAX_AGE_SECONDS,
  DevelopmentGateConfigError,
  authenticateDevelopmentProfile,
  createDevelopmentSessionToken,
  developmentSessionCookieOptions,
  readDevelopmentGateConfig,
  verifyDevelopmentSessionToken,
} from "../src/lib/development-gate-core.ts";

function validEnvironment(overrides = {}) {
  return {
    EVO_DEV_GATE_SESSION_SECRET:
      "session-signing-secret-that-is-at-least-thirty-two-characters",
    EVO_DEV_GATE_ADMIN_IDENTIFIER: "director-local",
    EVO_DEV_GATE_ADMIN_SECRET:
      "admin-profile-secret-that-is-at-least-thirty-two-characters",
    EVO_DEV_GATE_SALES_IDENTIFIER: "sales-local",
    EVO_DEV_GATE_SALES_SECRET:
      "sales-profile-secret-that-is-at-least-thirty-two-characters",
    EVO_DEV_GATE_ADMISSIONS_IDENTIFIER: "admissions-local",
    EVO_DEV_GATE_ADMISSIONS_SECRET:
      "admissions-secret-that-is-at-least-thirty-two-characters",
    ...overrides,
  };
}

test("the development gate accepts exactly three fixed technical profiles", () => {
  const config = readDevelopmentGateConfig(validEnvironment());

  assert.deepEqual(DEVELOPMENT_GATE_ROLES, ["admin", "sales", "admissions"]);
  assert.equal(config.profiles.length, 3);
  assert.deepEqual(
    config.profiles.map(({ role }) => role),
    DEVELOPMENT_GATE_ROLES,
  );

  assert.equal(
    authenticateDevelopmentProfile(config, "director-local", validEnvironment().EVO_DEV_GATE_ADMIN_SECRET),
    "admin",
  );
  assert.equal(
    authenticateDevelopmentProfile(config, "sales-local", validEnvironment().EVO_DEV_GATE_SALES_SECRET),
    "sales",
  );
  assert.equal(
    authenticateDevelopmentProfile(
      config,
      "admissions-local",
      validEnvironment().EVO_DEV_GATE_ADMISSIONS_SECRET,
    ),
    "admissions",
  );
});

test("invalid pairs have one null outcome and never mix profile values", () => {
  const env = validEnvironment();
  const config = readDevelopmentGateConfig(env);

  for (const [identifier, secret] of [
    ["", ""],
    ["director-local", "wrong-secret"],
    ["unknown-local", env.EVO_DEV_GATE_ADMIN_SECRET],
    ["director-local", env.EVO_DEV_GATE_SALES_SECRET],
    ["x".repeat(257), env.EVO_DEV_GATE_ADMIN_SECRET],
    ["director-local", "x".repeat(1025)],
  ]) {
    assert.equal(authenticateDevelopmentProfile(config, identifier, secret), null);
  }
});

test("missing or unsafe primary configuration fails closed without legacy fallbacks", () => {
  for (const overrides of [
    { EVO_DEV_GATE_SESSION_SECRET: undefined },
    { EVO_DEV_GATE_ADMIN_IDENTIFIER: undefined },
    { EVO_DEV_GATE_SALES_SECRET: "short" },
    { EVO_DEV_GATE_ADMISSIONS_IDENTIFIER: " director-local" },
    { EVO_DEV_GATE_SALES_IDENTIFIER: "director-local" },
  ]) {
    assert.throws(
      () =>
        readDevelopmentGateConfig({
          AUTH_SECRET: "legacy-auth-secret-that-must-not-be-used",
          EVO_UI_CONTRACT_FIXTURES: "1",
          NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
          ...validEnvironment(overrides),
        }),
      (error) => {
        assert.ok(error instanceof DevelopmentGateConfigError);
        assert.match(error.code, /^development_gate_configuration_/);
        assert.doesNotMatch(error.message, /legacy-auth-secret|director-local/);
        return true;
      },
    );
  }
});

test("the signed role session survives refresh but rejects tampering and expiry", () => {
  const config = readDevelopmentGateConfig(validEnvironment());
  const now = 2_000_000_000_000;
  const token = createDevelopmentSessionToken(config, "admissions", {
    now,
    nonce: "fixed-test-nonce",
  });

  assert.deepEqual(verifyDevelopmentSessionToken(config, token, { now }), {
    role: "admissions",
    issuedAt: Math.floor(now / 1000),
    expiresAt: Math.floor(now / 1000) + DEVELOPMENT_SESSION_MAX_AGE_SECONDS,
  });
  assert.deepEqual(
    verifyDevelopmentSessionToken(config, token, { now: now + 60_000 }),
    {
      role: "admissions",
      issuedAt: Math.floor(now / 1000),
      expiresAt: Math.floor(now / 1000) + DEVELOPMENT_SESSION_MAX_AGE_SECONDS,
    },
  );
  assert.equal(
    verifyDevelopmentSessionToken(config, token, {
      now: now + DEVELOPMENT_SESSION_MAX_AGE_SECONDS * 1000 + 1_000,
    }),
    null,
  );

  const [payload, signature] = token.split(".");
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  decoded.role = "admin";
  const tamperedPayload = Buffer.from(JSON.stringify(decoded)).toString("base64url");
  assert.equal(
    verifyDevelopmentSessionToken(config, `${tamperedPayload}.${signature}`, { now }),
    null,
  );
  assert.equal(
    verifyDevelopmentSessionToken(config, `${payload}.${signature.slice(1)}`, { now }),
    null,
  );
});

test("the cookie contract is short-lived, HttpOnly and Secure for HTTPS", () => {
  assert.equal(DEVELOPMENT_SESSION_COOKIE, "evo_v2_dev_session");
  assert.equal(DEVELOPMENT_SESSION_MAX_AGE_SECONDS, 30 * 60);
  assert.deepEqual(developmentSessionCookieOptions({ secure: false }), {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    secure: false,
    maxAge: DEVELOPMENT_SESSION_MAX_AGE_SECONDS,
  });
  assert.equal(developmentSessionCookieOptions({ secure: true }).secure, true);
});
