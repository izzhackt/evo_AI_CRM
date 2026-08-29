import assert from "node:assert/strict";
import test from "node:test";

import {
  CANONICAL_WAHA_PREFLIGHT_TIMEOUT_MS,
  CanonicalWahaPreflightConfigurationError,
  loadCanonicalWahaPreflightConfig,
  readCanonicalWahaPreflightAvailability,
  runCanonicalWahaPreflight,
} from "../src/lib/server/canonical-waha-preflight.ts";

const WAHA_API_KEY = "technical-waha-key-not-a-real-secret";

function configuredEnvironment(overrides = {}) {
  return {
    EVO_V2_WAHA_PREFLIGHT_ENABLED: "1",
    EVO_V2_WAHA_PROVIDER_AUTHORIZED: "1",
    EVO_V2_WAHA_BASE_URL: "http://evo-inbox-waha:3000",
    EVO_V2_WAHA_API_KEY: WAHA_API_KEY,
    EVO_V2_WAHA_SESSION_NAME: "evo-inbox",
    ...overrides,
  };
}

function expectConfigurationError(environment, code) {
  assert.throws(
    () => loadCanonicalWahaPreflightConfig(environment),
    (error) =>
      error instanceof CanonicalWahaPreflightConfigurationError &&
      error.code === code,
  );
}

test("WAHA preflight stays blocked by default and requires exact 0/1 control flags", async () => {
  assert.deepEqual(readCanonicalWahaPreflightAvailability({}), {
    status: "blocked",
    reason: "feature_disabled",
  });

  assert.deepEqual(
    await runCanonicalWahaPreflight({
      EVO_V2_WAHA_PREFLIGHT_ENABLED: "1",
      EVO_V2_WAHA_PROVIDER_AUTHORIZED: "0",
    }),
    {
      status: "blocked",
      reason: "provider_not_authorized",
    },
  );

  expectConfigurationError(
    { EVO_V2_WAHA_PREFLIGHT_ENABLED: "true" },
    "invalid_enabled_flag",
  );
  expectConfigurationError(
    {
      EVO_V2_WAHA_PREFLIGHT_ENABLED: "1",
      EVO_V2_WAHA_PROVIDER_AUTHORIZED: "yes",
    },
    "invalid_authorization_flag",
  );
});

test("configured availability is explicit and exposes no server secret", () => {
  const availability = readCanonicalWahaPreflightAvailability(
    configuredEnvironment(),
  );
  assert.deepEqual(availability, {
    status: "configured",
    sessionName: "evo-inbox",
  });
  assert.equal(JSON.stringify(availability).includes(WAHA_API_KEY), false);

  const ready = loadCanonicalWahaPreflightConfig(configuredEnvironment());
  assert.equal(ready.status, "ready");
  assert.equal(ready.baseUrl, "http://evo-inbox-waha:3000");
  assert.equal(ready.sessionName, "evo-inbox");
  assert.equal(ready.timeoutMs, CANONICAL_WAHA_PREFLIGHT_TIMEOUT_MS);
});

test("host validation allows only exact safe WAHA hosts, localhost, and private IPs", () => {
  for (const baseUrl of [
    "http://evo-inbox-waha:3000",
    "https://evo-v2-waha:443",
    "http://localhost:3000",
    "http://api.localhost:3000",
    "http://127.0.0.1:3000",
    "http://192.168.1.25:3000",
    "http://[::1]:3000",
    "http://[fd12:3456:789a::1]:3000",
  ]) {
    const ready = loadCanonicalWahaPreflightConfig(
      configuredEnvironment({ EVO_V2_WAHA_BASE_URL: baseUrl }),
    );
    assert.equal(ready.status, "ready", baseUrl);
    if (ready.status === "ready") {
      assert.equal(ready.baseUrl, new URL(baseUrl).origin);
    }
  }
});

test("missing or unsafe transport configuration blocks the contract before any fetch", async () => {
  assert.deepEqual(
    readCanonicalWahaPreflightAvailability({
      EVO_V2_WAHA_PREFLIGHT_ENABLED: "1",
      EVO_V2_WAHA_PROVIDER_AUTHORIZED: "1",
    }),
    {
      status: "blocked",
      reason: "configuration_missing",
      missing: ["base_url", "api_key", "session_name"],
    },
  );

  for (const [environment, code] of [
    [
      configuredEnvironment({ EVO_V2_WAHA_BASE_URL: "https://example.com" }),
      "unsafe_base_url",
    ],
    [
      configuredEnvironment({ EVO_V2_WAHA_BASE_URL: "http://waha:3000" }),
      "unsafe_base_url",
    ],
    [
      configuredEnvironment({ EVO_V2_WAHA_BASE_URL: "http://crm.internal:3000" }),
      "unsafe_base_url",
    ],
    [
      configuredEnvironment({ EVO_V2_WAHA_BASE_URL: "http://printer.local:3000" }),
      "unsafe_base_url",
    ],
    [
      configuredEnvironment({
        EVO_V2_WAHA_BASE_URL: "http://evo-inbox-waha:3000/private",
      }),
      "unsafe_base_url",
    ],
    [
      configuredEnvironment({
        EVO_V2_WAHA_BASE_URL: "http://user:pass@evo-inbox-waha:3000",
      }),
      "unsafe_base_url",
    ],
    [
      configuredEnvironment({ EVO_V2_WAHA_API_KEY: "short" }),
      "unsafe_api_key",
    ],
    [
      configuredEnvironment({ EVO_V2_WAHA_SESSION_NAME: "evo inbox" }),
      "invalid_session_name",
    ],
  ]) {
    expectConfigurationError(environment, code);
  }

  let fetchCalls = 0;
  const blocked = await runCanonicalWahaPreflight(
    configuredEnvironment({ EVO_V2_WAHA_BASE_URL: "https://example.com" }),
    {
      fetch: async () => {
        fetchCalls += 1;
        throw new Error("fetch must not run");
      },
    },
  );
  assert.deepEqual(blocked, {
    status: "blocked",
    reason: "configuration_invalid",
  });
  assert.equal(fetchCalls, 0);
});

test("fresh preflight uses one exact GET session request with X-Api-Key and a bounded timeout", async () => {
  const requests = [];
  const timeoutSignals = [];
  const checkedAt = new Date("2026-08-29T10:11:12.000Z");

  const result = await runCanonicalWahaPreflight(configuredEnvironment(), {
    now: () => checkedAt,
    createTimeoutSignal(timeoutMs) {
      timeoutSignals.push(timeoutMs);
      return new AbortController().signal;
    },
    fetch: async (input, init) => {
      requests.push({ input: String(input), init });
      return new Response(
        JSON.stringify({
          name: "evo-inbox",
          status: "WORKING",
        }),
        { status: 200 },
      );
    },
  });

  assert.deepEqual(result, {
    status: "working",
    sessionName: "evo-inbox",
    checkedAt: checkedAt.toISOString(),
  });
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].input,
    "http://evo-inbox-waha:3000/api/sessions/evo-inbox",
  );
  assert.equal(requests[0].init.method, "GET");
  assert.equal(requests[0].init.redirect, "error");
  assert.equal(requests[0].init.headers["X-Api-Key"], WAHA_API_KEY);
  assert.deepEqual(timeoutSignals, [CANONICAL_WAHA_PREFLIGHT_TIMEOUT_MS]);
  assert.equal(JSON.stringify(result).includes(WAHA_API_KEY), false);
});

test("fresh preflight percent-encodes the exact configured session name", async () => {
  const requests = [];

  const result = await runCanonicalWahaPreflight(
    configuredEnvironment({ EVO_V2_WAHA_SESSION_NAME: "session:alpha" }),
    {
      now: () => new Date("2026-08-29T10:11:13.000Z"),
      fetch: async (input, init) => {
        requests.push({ input: String(input), init });
        return new Response(
          JSON.stringify({
            name: "session:alpha",
            status: "WORKING",
          }),
          { status: 200 },
        );
      },
    },
  );

  assert.equal(requests[0].input.endsWith("/api/sessions/session%3Aalpha"), true);
  assert.deepEqual(result, {
    status: "working",
    sessionName: "session:alpha",
    checkedAt: "2026-08-29T10:11:13.000Z",
  });
});

test("fresh preflight maps other provider outcomes to not-working without leaking secrets", async () => {
  const checks = [
    [
      "network",
      async () => {
        throw new Error("socket hang up");
      },
      "provider_unreachable",
    ],
    [
      "http",
      async () => new Response("Unauthorized", { status: 401 }),
      "provider_rejected",
    ],
    [
      "malformed",
      async () => new Response("{", { status: 200 }),
      "provider_malformed_response",
    ],
    [
      "wrong_name",
      async () =>
        new Response(
          JSON.stringify({
            name: "other-session",
            status: "WORKING",
          }),
          { status: 200 },
        ),
      "session_name_mismatch",
    ],
    [
      "not_working",
      async () =>
        new Response(
          JSON.stringify({
            name: "evo-inbox",
            status: "STARTING",
          }),
          { status: 200 },
        ),
      "session_not_working",
    ],
  ];

  for (const [label, fetchImpl, reason] of checks) {
    const result = await runCanonicalWahaPreflight(configuredEnvironment(), {
      now: () => new Date("2026-08-29T10:11:14.000Z"),
      fetch: fetchImpl,
    });

    assert.deepEqual(
      result,
      {
        status: "not-working",
        sessionName: "evo-inbox",
        checkedAt: "2026-08-29T10:11:14.000Z",
        reason,
      },
      label,
    );
    assert.equal(JSON.stringify(result).includes(WAHA_API_KEY), false, label);
  }
});
