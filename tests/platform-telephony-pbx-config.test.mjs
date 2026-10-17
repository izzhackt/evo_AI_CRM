import assert from "node:assert/strict";
import test from "node:test";

import { readPlatformTelephonyPbxConfig } from "../src/lib/server/platform-telephony-pbx-config.ts";

// Everything here is synthetic: a made-up tenant and a made-up key.
const KEY = "pbx-test-key-0123456789abcdef";
const URL_ = "https://tenant-test.ats.beeline.kg/crmapi/v1";
const HOST = "tenant-test.ats.beeline.kg";

function env(overrides = {}) {
  return {
    EVO_PLATFORM_TELEPHONY_PBX_TOKEN: KEY,
    EVO_PLATFORM_TELEPHONY_PBX_URL: URL_,
    EVO_PLATFORM_TELEPHONY_PBX_HOST: HOST,
    ...overrides,
  };
}

test("no PBX name set means not configured (the normal state before launch)", () => {
  assert.deepEqual(readPlatformTelephonyPbxConfig({}), { status: "not_configured" });
  assert.deepEqual(
    readPlatformTelephonyPbxConfig({
      EVO_PLATFORM_TELEPHONY_PBX_TOKEN: "",
      EVO_PLATFORM_TELEPHONY_PBX_URL: "",
      EVO_PLATFORM_TELEPHONY_PBX_HOST: "",
    }),
    { status: "not_configured" },
  );
});

test("a complete valid group is ready and carries the key, the base and the hosts", () => {
  const state = readPlatformTelephonyPbxConfig(env());
  assert.equal(state.status, "ready");
  assert.equal(state.config.apiKey, KEY);
  assert.equal(state.config.baseUrl, URL_);
  assert.equal(state.config.apiHost, HOST);
  assert.equal(state.config.recordingHost, HOST);
  assert.ok(Object.isFrozen(state));
  assert.ok(Object.isFrozen(state.config));
});

test("the group is all or nothing", () => {
  for (const missing of [
    "EVO_PLATFORM_TELEPHONY_PBX_TOKEN",
    "EVO_PLATFORM_TELEPHONY_PBX_URL",
    "EVO_PLATFORM_TELEPHONY_PBX_HOST",
  ]) {
    const state = readPlatformTelephonyPbxConfig(env({ [missing]: "" }));
    assert.deepEqual(state, { status: "invalid", reason: "incomplete_group" }, missing);
  }
  assert.deepEqual(
    readPlatformTelephonyPbxConfig({ EVO_PLATFORM_TELEPHONY_PBX_TOKEN: KEY }),
    { status: "invalid", reason: "incomplete_group" },
  );
});

test("the key is 16-256 printable characters without whitespace", () => {
  for (const bad of ["short-key", "has a space inside 0123456789", "tab\tinside-0123456789ab", "x".repeat(257), `${KEY}\n`]) {
    assert.deepEqual(
      readPlatformTelephonyPbxConfig(env({ EVO_PLATFORM_TELEPHONY_PBX_TOKEN: bad })),
      { status: "invalid", reason: "invalid_token" },
      JSON.stringify(bad.length),
    );
  }
  assert.equal(
    readPlatformTelephonyPbxConfig(env({ EVO_PLATFORM_TELEPHONY_PBX_TOKEN: "x".repeat(256) })).status,
    "ready",
  );
});

test("the base URL is https, canonical, with a path and no trailing slash", () => {
  for (const bad of [
    "http://tenant-test.ats.beeline.kg/crmapi/v1",
    `${URL_}/`,
    `${URL_}?x=1`,
    `${URL_}#top`,
    "https://user:pass@tenant-test.ats.beeline.kg/crmapi/v1",
    "https://tenant-test.ats.beeline.kg:8443/crmapi/v1",
    "https://tenant-test.ats.beeline.kg",
    "https://Tenant-Test.ats.beeline.kg/crmapi/v1",
    "https://tenant-test.ats.beeline.kg/crmapi/./v1",
    "not a url",
  ]) {
    assert.deepEqual(
      readPlatformTelephonyPbxConfig(env({ EVO_PLATFORM_TELEPHONY_PBX_URL: bad })),
      { status: "invalid", reason: "invalid_url" },
      bad,
    );
  }
});

test("the tenant host is a lower-case DNS name with a dot", () => {
  for (const bad of ["Tenant-Test.ats.beeline.kg", "localhost", "tenant test.kg", "https://tenant-test.ats.beeline.kg", ""]) {
    const state = readPlatformTelephonyPbxConfig(env({ EVO_PLATFORM_TELEPHONY_PBX_HOST: bad }));
    // An empty host is an incomplete group; the others are an invalid host.
    assert.equal(state.status, "invalid", bad);
    assert.equal(state.reason, bad === "" ? "incomplete_group" : "invalid_host", bad);
  }
});

test("the API host must be the tenant host or a name under ats.beeline.kg, never an address", () => {
  // Another host that is neither the recording host nor the PBX platform.
  assert.deepEqual(
    readPlatformTelephonyPbxConfig(
      env({
        EVO_PLATFORM_TELEPHONY_PBX_URL: "https://pbx.example.com/crmapi/v1",
        EVO_PLATFORM_TELEPHONY_PBX_HOST: HOST,
      }),
    ),
    { status: "invalid", reason: "host_not_allowed" },
  );
  // A look-alike that merely ends with the platform name.
  assert.deepEqual(
    readPlatformTelephonyPbxConfig(
      env({
        EVO_PLATFORM_TELEPHONY_PBX_URL: "https://tenant-test.ats.beeline.kg.evil.example/crmapi/v1",
      }),
    ),
    { status: "invalid", reason: "host_not_allowed" },
  );
  // An address literal, even when it equals the recording host.
  assert.deepEqual(
    readPlatformTelephonyPbxConfig(
      env({
        EVO_PLATFORM_TELEPHONY_PBX_URL: "https://203.0.113.7/crmapi/v1",
        EVO_PLATFORM_TELEPHONY_PBX_HOST: "203.0.113.7",
      }),
    ),
    { status: "invalid", reason: "host_not_allowed" },
  );
  // The API under the platform domain with a different recording host is allowed.
  const split = readPlatformTelephonyPbxConfig(
    env({ EVO_PLATFORM_TELEPHONY_PBX_HOST: "records.example.com" }),
  );
  assert.equal(split.status, "ready");
  assert.equal(split.config.recordingHost, "records.example.com");
  // The API host equal to the recording host is allowed too (a non-platform name).
  assert.equal(
    readPlatformTelephonyPbxConfig(
      env({
        EVO_PLATFORM_TELEPHONY_PBX_URL: "https://pbx.example.com/crmapi/v1",
        EVO_PLATFORM_TELEPHONY_PBX_HOST: "pbx.example.com",
      }),
    ).status,
    "ready",
  );
});

test("an invalid result never echoes a value", () => {
  const state = readPlatformTelephonyPbxConfig(env({ EVO_PLATFORM_TELEPHONY_PBX_URL: "http://tenant-test.ats.beeline.kg/x" }));
  const text = JSON.stringify(state);
  assert.ok(!text.includes(KEY));
  assert.ok(!text.includes("tenant-test"));
});
