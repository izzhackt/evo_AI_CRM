import assert from "node:assert/strict";
import test from "node:test";

import {
  getPlatformSupabaseBackendConfig,
  PlatformSupabaseBackendConfigurationError,
} from "../src/lib/server/platform-supabase-backend-config.ts";

const SECRET_KEY = "sb_secret_1234567890abcdef";

function environment(overrides = {}) {
  return {
    NEXT_PUBLIC_SUPABASE_URL: "https://evo.supabase.co",
    EVO_PLATFORM_SUPABASE_SECRET_KEY: SECRET_KEY,
    ...overrides,
  };
}

function jwt(role) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    .toString("base64url");
  const payload = Buffer.from(JSON.stringify({ role }))
    .toString("base64url");
  return `${header}.${payload}.test-signature`;
}

function rejectsWithCode(code) {
  return (error) =>
    error instanceof PlatformSupabaseBackendConfigurationError &&
    error.code === code &&
    error.message === "Platform Supabase backend is not configured.";
}

test("backend config accepts a managed HTTPS origin and a dedicated secret key", () => {
  const config = getPlatformSupabaseBackendConfig(environment({
    NEXT_PUBLIC_SUPABASE_URL: "https://evo.supabase.co/",
  }));

  assert.deepEqual(config, {
    supabaseUrl: "https://evo.supabase.co",
    supabaseSecretKey: SECRET_KEY,
  });
  assert.equal(Object.isFrozen(config), true);
});

test("backend config allows HTTP only on exact loopback hosts", () => {
  for (const url of [
    "http://localhost:54321",
    "http://127.0.0.1:54321",
    "http://[::1]:54321",
  ]) {
    assert.equal(
      getPlatformSupabaseBackendConfig(environment({
        NEXT_PUBLIC_SUPABASE_URL: url,
      })).supabaseUrl,
      url,
    );
  }

  for (const url of [
    "http://evo.supabase.co",
    "http://localhost.example.com:54321",
  ]) {
    assert.throws(
      () => getPlatformSupabaseBackendConfig(environment({
        NEXT_PUBLIC_SUPABASE_URL: url,
      })),
      rejectsWithCode("insecure_supabase_url"),
    );
  }
});

test("backend config rejects ambiguous or credential-bearing URLs", () => {
  for (const url of [
    " evo.supabase.co ",
    "https://user:password@evo.supabase.co",
    "https://evo.supabase.co/rest/v1",
    "https://evo.supabase.co?key=value",
    "https://evo.supabase.co#fragment",
  ]) {
    assert.throws(
      () => getPlatformSupabaseBackendConfig(environment({
        NEXT_PUBLIC_SUPABASE_URL: url,
      })),
      rejectsWithCode("invalid_supabase_url"),
      url,
    );
  }
});

test("backend config accepts only service-role legacy JWTs", () => {
  const serviceRole = jwt("service_role");
  assert.equal(
    getPlatformSupabaseBackendConfig(environment({
      EVO_PLATFORM_SUPABASE_SECRET_KEY: serviceRole,
    })).supabaseSecretKey,
    serviceRole,
  );

  for (const unsafe of [
    "sb_publishable_1234567890abcdef",
    "public-anon-key",
    jwt("anon"),
    jwt("authenticated"),
    "not.a.jwt",
    ` ${SECRET_KEY}`,
  ]) {
    assert.throws(
      () => getPlatformSupabaseBackendConfig(environment({
        EVO_PLATFORM_SUPABASE_SECRET_KEY: unsafe,
      })),
      rejectsWithCode("unsafe_supabase_secret_key"),
    );
  }
});

test("backend config fails closed when either required value is absent", () => {
  assert.throws(
    () => getPlatformSupabaseBackendConfig(environment({
      NEXT_PUBLIC_SUPABASE_URL: undefined,
    })),
    rejectsWithCode("missing_supabase_url"),
  );
  assert.throws(
    () => getPlatformSupabaseBackendConfig(environment({
      EVO_PLATFORM_SUPABASE_SECRET_KEY: undefined,
    })),
    rejectsWithCode("missing_supabase_secret_key"),
  );
});
