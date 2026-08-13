import assert from "node:assert/strict";
import test from "node:test";

import {
  isPlatformP7BObservabilityEnabled,
  loadPlatformObservabilityConfig,
  PlatformObservabilityConfigurationError,
} from "../src/lib/server/platform-observability-config.ts";

const OBSERVABILITY_SECRET = "x".repeat(32);
const SUPABASE_SECRET_KEY = "sb_secret_p7b_local_1234567890";

function enabledEnvironment(overrides = {}) {
  return {
    NODE_ENV: "test",
    EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED: "1",
    EVO_PLATFORM_P7B_OBSERVABILITY_SECRET: OBSERVABILITY_SECRET,
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:45421",
    EVO_PLATFORM_SUPABASE_SECRET_KEY: SUPABASE_SECRET_KEY,
    ...overrides,
  };
}

test("P7B observability stays disabled unless the exact flag is 1", () => {
  for (const value of [undefined, "", "0", "true", "TRUE", "01", " 1 "]) {
    assert.equal(
      isPlatformP7BObservabilityEnabled({
        EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED: value,
      }),
      false,
      String(value),
    );
  }
  assert.equal(
    isPlatformP7BObservabilityEnabled({
      EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED: "1",
    }),
    true,
  );
  assert.deepEqual(loadPlatformObservabilityConfig({}), { enabled: false });
});

test("enabled P7B config accepts only the frozen loopback and production Supabase origins", () => {
  for (const supabaseUrl of [
    "http://localhost:1",
    "http://127.0.0.1:45421",
    "http://127.255.255.254:65535/",
    "http://[::1]:54321",
  ]) {
    assert.deepEqual(
      loadPlatformObservabilityConfig(
        enabledEnvironment({ NEXT_PUBLIC_SUPABASE_URL: supabaseUrl }),
      ),
      {
        enabled: true,
        observabilitySecret: OBSERVABILITY_SECRET,
        supabaseUrl: new URL(supabaseUrl).origin,
        supabaseSecretKey: SUPABASE_SECRET_KEY,
        rpcTimeoutMs: 5_000,
      },
      supabaseUrl,
    );
  }

  const productionUrl = "https://abcdefghijklmnopqrst.supabase.co";
  assert.equal(
    loadPlatformObservabilityConfig(
      enabledEnvironment({
        NODE_ENV: "production",
        NEXT_PUBLIC_SUPABASE_URL: productionUrl,
      }),
    ).supabaseUrl,
    productionUrl,
  );
  for (const secret of ["a".repeat(32), "é".repeat(64)]) {
    assert.equal(
      loadPlatformObservabilityConfig(
        enabledEnvironment({ EVO_PLATFORM_P7B_OBSERVABILITY_SECRET: secret }),
      ).observabilitySecret,
      secret,
    );
  }
});

test("enabled P7B config rejects unsafe origins before a secret-bearing request can exist", () => {
  const rejected = [
    "http://localhost",
    "https://localhost:45421",
    "http://127.0.0.1",
    "http://127.0.0.1:0",
    "http://127.0.0.1:65536",
    "http://127.0.0.1:45421/rest/v1",
    "http://127.0.0.1:45421?x=1",
    "http://127.0.0.1:45421#x",
    "http://user@127.0.0.1:45421",
    "http://localhost.evil.test:45421",
    "http://10.0.0.2:45421",
    "http://127.0.0.256:45421",
    "http://127.1:45421",
    "https://abcdefghijklmnopqrst.supabase.co",
  ];

  for (const supabaseUrl of rejected) {
    assert.throws(
      () =>
        loadPlatformObservabilityConfig(
          enabledEnvironment({
            NODE_ENV: "test",
            NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
          }),
        ),
      (error) =>
        error instanceof PlatformObservabilityConfigurationError &&
        error.code === "unsafe_supabase_url",
      supabaseUrl,
    );
  }

  for (const supabaseUrl of [
    "https://ABCDEFGHIJKLMNOPQRST.supabase.co",
    "https://abcdefghijklmnopqrs.supabase.co",
    "https://abcdefghijklmnopqrst.supabase.co:443",
    "https://abcdefghijklmnopqrst.supabase.co/rest/v1",
    "https://custom.example.com",
  ]) {
    assert.throws(
      () =>
        loadPlatformObservabilityConfig(
          enabledEnvironment({
            NODE_ENV: "production",
            NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
          }),
        ),
      PlatformObservabilityConfigurationError,
      supabaseUrl,
    );
  }
});

test("enabled P7B config rejects missing, malformed, or reused observability secrets", () => {
  const unsafeSecrets = [
    undefined,
    "",
    "short",
    `${"a".repeat(31)}`,
    `${"a".repeat(129)}`,
    ` ${OBSERVABILITY_SECRET}`,
    `${OBSERVABILITY_SECRET} `,
    `${"a".repeat(31)}\n`,
    `${"a".repeat(16)}\u0000${"a".repeat(16)}`,
    `${"é".repeat(65)}`,
  ];

  for (const secret of unsafeSecrets) {
    assert.throws(
      () =>
        loadPlatformObservabilityConfig(
          enabledEnvironment({
            EVO_PLATFORM_P7B_OBSERVABILITY_SECRET: secret,
          }),
        ),
      (error) =>
        error instanceof PlatformObservabilityConfigurationError &&
        error.code === "unsafe_observability_secret",
      String(secret),
    );
  }

  for (const reservedName of [
    "EVO_PLATFORM_SUPABASE_SECRET_KEY",
    "EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET",
    "EVO_PLATFORM_WAHA_WORKER_TRIGGER_SECRET",
    "EVO_PLATFORM_AUTONOMOUS_REPLIES_TRIGGER_SECRET",
    "EVO_AGENT_CRM_SYNC_SECRET",
    "EVO_LEAD_AGENT_SYNC_SECRET",
  ]) {
    assert.throws(
      () =>
        loadPlatformObservabilityConfig(
          enabledEnvironment({
            [reservedName]: OBSERVABILITY_SECRET,
            EVO_PLATFORM_SUPABASE_SECRET_KEY:
              reservedName === "EVO_PLATFORM_SUPABASE_SECRET_KEY"
                ? OBSERVABILITY_SECRET
                : SUPABASE_SECRET_KEY,
          }),
        ),
      (error) =>
        error instanceof PlatformObservabilityConfigurationError &&
        error.code === "reused_observability_secret",
      reservedName,
    );
  }
});

test("enabled P7B config accepts only backend Supabase secret credentials", () => {
  const serviceRolePayload = Buffer.from(
    JSON.stringify({ role: "service_role" }),
  ).toString("base64url");
  const serviceRoleJwt = `header.${serviceRolePayload}.signature`;
  assert.equal(
    loadPlatformObservabilityConfig(
      enabledEnvironment({
        EVO_PLATFORM_SUPABASE_SECRET_KEY: serviceRoleJwt,
      }),
    ).supabaseSecretKey,
    serviceRoleJwt,
  );

  for (const supabaseSecretKey of [
    undefined,
    "",
    "sb_publishable_not-a-server-secret",
    "header.eyJyb2xlIjoiYW5vbiJ9.signature",
    " sb_secret_p7b_local_1234567890",
  ]) {
    assert.throws(
      () =>
        loadPlatformObservabilityConfig(
          enabledEnvironment({
            EVO_PLATFORM_SUPABASE_SECRET_KEY: supabaseSecretKey,
          }),
        ),
      (error) =>
        error instanceof PlatformObservabilityConfigurationError &&
        error.code === "unsafe_supabase_secret_key",
      String(supabaseSecretKey),
    );
  }
});
