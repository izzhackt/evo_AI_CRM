import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  provisionPlatformManualSendWahaRuntime,
  runProvisionPlatformManualSendWahaRuntimeCli,
  validateManualSendWahaRuntimeResponse,
} from "../scripts/provision-platform-manual-send-waha-runtime.mjs";
import {
  checkPlatformManualSendWahaRuntime,
  runCheckPlatformManualSendWahaRuntimeCli,
} from "../scripts/check-platform-manual-send-waha-runtime.mjs";

const SUPABASE_ORIGIN = "https://iosckaqtovbbnssqcpde.supabase.co";
const SUPABASE_SECRET_KEY = "sb_secret_abcdefghijklmnopqrstuvwxyz0123456789";
const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const WAHA_API_KEY = "plain-waha-api-key-0123456789";

const READY_ROW = Object.freeze({
  organization_id: ORGANIZATION_ID,
  ready: true,
  reason_code: "ready",
  waha_session_name: "evo-inbox",
  base_url: "http://evo-crm-waha:3000",
  binding_version: 1,
  api_key_sha256:
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  updated_at: "2026-08-23T04:05:06.123Z",
});

const MISSING_BINDING_ROW = Object.freeze({
  organization_id: ORGANIZATION_ID,
  ready: false,
  reason_code: "missing_binding",
  waha_session_name: null,
  base_url: null,
  binding_version: null,
  api_key_sha256: null,
  updated_at: null,
});

function provisionEnvironment(overrides = {}) {
  return {
    NEXT_PUBLIC_SUPABASE_URL: SUPABASE_ORIGIN,
    EVO_PLATFORM_SUPABASE_SECRET_KEY: SUPABASE_SECRET_KEY,
    EVO_PLATFORM_ORGANIZATION_ID: ORGANIZATION_ID,
    EVO_PLATFORM_MANUAL_SEND_WAHA_API_KEY: WAHA_API_KEY,
    EVO_PLATFORM_MANUAL_SEND_BINDING_REQUEST_ID: REQUEST_ID,
    ...overrides,
  };
}

function checkEnvironment(overrides = {}) {
  return {
    NEXT_PUBLIC_SUPABASE_URL: SUPABASE_ORIGIN,
    EVO_PLATFORM_SUPABASE_SECRET_KEY: SUPABASE_SECRET_KEY,
    EVO_PLATFORM_ORGANIZATION_ID: ORGANIZATION_ID,
    ...overrides,
  };
}

test("provision CLI boundary serializes only the exact service RPC request and returns safe metadata", async () => {
  let captured;
  const result = await provisionPlatformManualSendWahaRuntime({
    environment: provisionEnvironment(),
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return Response.json([READY_ROW]);
    },
  });

  assert.equal(
    captured.url,
    `${SUPABASE_ORIGIN}/rest/v1/rpc/provision_manual_send_waha_runtime`,
  );
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.redirect, "error");
  assert.deepEqual(captured.init.headers, {
    Accept: "application/json",
    "Accept-Profile": "platform",
    apikey: SUPABASE_SECRET_KEY,
    "Content-Profile": "platform",
    "Content-Type": "application/json",
  });
  assert.equal(
    Object.hasOwn(captured.init.headers, "Authorization"),
    false,
  );
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(captured.init.body), {
    p_organization_id: ORGANIZATION_ID,
    p_waha_api_key: WAHA_API_KEY,
    p_request_id: REQUEST_ID,
  });
  assert.deepEqual(result, READY_ROW);
  assert.equal(JSON.stringify(result).includes(WAHA_API_KEY), false);
  assert.equal(JSON.stringify(captured.init.headers).includes(WAHA_API_KEY), false);
});

test("check CLI boundary calls only the non-secret configuration RPC", async () => {
  let captured;
  const result = await checkPlatformManualSendWahaRuntime({
    environment: checkEnvironment({
      EVO_PLATFORM_MANUAL_SEND_WAHA_API_KEY: undefined,
      EVO_PLATFORM_MANUAL_SEND_BINDING_REQUEST_ID: undefined,
    }),
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return Response.json([READY_ROW]);
    },
  });

  assert.equal(
    captured.url,
    `${SUPABASE_ORIGIN}/rest/v1/rpc/manual_send_waha_runtime_configuration`,
  );
  assert.deepEqual(JSON.parse(captured.init.body), {
    p_organization_id: ORGANIZATION_ID,
  });
  assert.deepEqual(result, READY_ROW);
});

test("each CLI reads only its declared runtime environment variables", async () => {
  const provisionReads = [];
  const provisionValues = provisionEnvironment();
  const provisionEnv = new Proxy(provisionValues, {
    get(target, property) {
      provisionReads.push(property);
      return target[property];
    },
  });
  await provisionPlatformManualSendWahaRuntime({
    environment: provisionEnv,
    fetchImpl: async () => Response.json([READY_ROW]),
  });
  assert.deepEqual(provisionReads, [
    "NEXT_PUBLIC_SUPABASE_URL",
    "EVO_PLATFORM_SUPABASE_SECRET_KEY",
    "EVO_PLATFORM_ORGANIZATION_ID",
    "EVO_PLATFORM_MANUAL_SEND_WAHA_API_KEY",
    "EVO_PLATFORM_MANUAL_SEND_BINDING_REQUEST_ID",
  ]);

  const checkReads = [];
  const checkValues = checkEnvironment();
  const checkEnv = new Proxy(checkValues, {
    get(target, property) {
      checkReads.push(property);
      return target[property];
    },
  });
  await checkPlatformManualSendWahaRuntime({
    environment: checkEnv,
    fetchImpl: async () => Response.json([READY_ROW]),
  });
  assert.deepEqual(checkReads, [
    "NEXT_PUBLIC_SUPABASE_URL",
    "EVO_PLATFORM_SUPABASE_SECRET_KEY",
    "EVO_PLATFORM_ORGANIZATION_ID",
  ]);
});

test("provision rejects every missing runtime input before HTTP", async (t) => {
  const names = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "EVO_PLATFORM_SUPABASE_SECRET_KEY",
    "EVO_PLATFORM_ORGANIZATION_ID",
    "EVO_PLATFORM_MANUAL_SEND_WAHA_API_KEY",
    "EVO_PLATFORM_MANUAL_SEND_BINDING_REQUEST_ID",
  ];
  for (const name of names) {
    await t.test(name, async () => {
      let called = false;
      await assert.rejects(
        provisionPlatformManualSendWahaRuntime({
          environment: provisionEnvironment({ [name]: undefined }),
          fetchImpl: async () => {
            called = true;
            return Response.json([READY_ROW]);
          },
        }),
        (error) =>
          error.code === "invalid_environment" &&
          !error.message.includes(WAHA_API_KEY),
      );
      assert.equal(called, false);
    });
  }
});

test("operator inputs reject unsafe origins, credentials, UUIDs and WAHA keys", async (t) => {
  const invalidInputs = [
    ["NEXT_PUBLIC_SUPABASE_URL", "http://iosckaqtovbbnssqcpde.supabase.co"],
    ["NEXT_PUBLIC_SUPABASE_URL", `${SUPABASE_ORIGIN}/rest/v1`],
    ["NEXT_PUBLIC_SUPABASE_URL", `${SUPABASE_ORIGIN}/`],
    ["NEXT_PUBLIC_SUPABASE_URL", "https://example.com"],
    ["EVO_PLATFORM_SUPABASE_SECRET_KEY", "legacy-jwt-is-not-a-secret-key"],
    ["EVO_PLATFORM_SUPABASE_SECRET_KEY", "sb_secret_short"],
    [
      "EVO_PLATFORM_ORGANIZATION_ID",
      "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
    ],
    ["EVO_PLATFORM_ORGANIZATION_ID", "00000000-0000-0000-0000-000000000000"],
    ["EVO_PLATFORM_MANUAL_SEND_BINDING_REQUEST_ID", "not-a-uuid"],
    ["EVO_PLATFORM_MANUAL_SEND_WAHA_API_KEY", "too-short"],
    ["EVO_PLATFORM_MANUAL_SEND_WAHA_API_KEY", ` ${WAHA_API_KEY}`],
    ["EVO_PLATFORM_MANUAL_SEND_WAHA_API_KEY", `${WAHA_API_KEY}\n`],
    ["EVO_PLATFORM_MANUAL_SEND_WAHA_API_KEY", "x".repeat(4097)],
  ];
  for (const [index, [name, value]] of invalidInputs.entries()) {
    await t.test(`${name} invalid case ${index + 1}`, async () => {
      await assert.rejects(
        provisionPlatformManualSendWahaRuntime({
          environment: provisionEnvironment({ [name]: value }),
          fetchImpl: async () => {
            assert.fail("invalid environment must not reach HTTP");
          },
        }),
        (error) =>
          error.code === "invalid_environment" &&
          !error.message.includes(String(value)),
      );
    });
  }
});

test("check validates its three server-only inputs without requiring WAHA material", async () => {
  await assert.rejects(
    checkPlatformManualSendWahaRuntime({
      environment: checkEnvironment({ EVO_PLATFORM_ORGANIZATION_ID: "bad" }),
      fetchImpl: async () => assert.fail("invalid input must not reach HTTP"),
    }),
    (error) => error.code === "invalid_environment",
  );
  const result = await checkPlatformManualSendWahaRuntime({
    environment: checkEnvironment(),
    fetchImpl: async () => Response.json([READY_ROW]),
  });
  assert.deepEqual(result, READY_ROW);
});

test("response validation rejects duplicate, missing, extra and malformed rows", async (t) => {
  const badPayloads = [
    null,
    {},
    [],
    [READY_ROW, READY_ROW],
    [{ ...READY_ROW, unexpected: true }],
    [{ ...READY_ROW, updated_at: undefined }],
    [{ ...READY_ROW, organization_id: REQUEST_ID }],
    [{ ...READY_ROW, ready: "true" }],
    [{ ...READY_ROW, reason_code: "configured" }],
    [{ ...READY_ROW, waha_session_name: "crm_primary" }],
    [{ ...READY_ROW, base_url: "https://waha.example.com" }],
    [{ ...READY_ROW, binding_version: 0 }],
    [{ ...READY_ROW, binding_version: 1.5 }],
    [{ ...READY_ROW, binding_version: Number.MAX_SAFE_INTEGER + 1 }],
    [{ ...READY_ROW, api_key_sha256: READY_ROW.api_key_sha256.toUpperCase() }],
    [{ ...READY_ROW, updated_at: "2026-02-31T04:05:06Z" }],
  ];
  for (const [index, payload] of badPayloads.entries()) {
    await t.test(`bad payload ${index + 1}`, () => {
      assert.throws(
        () =>
          validateManualSendWahaRuntimeResponse(payload, {
            organizationId: ORGANIZATION_ID,
            requireReady: true,
          }),
        (error) => error.code === "rpc_response_invalid",
      );
    });
  }
});

test("provision fails closed on a valid not-ready row while status may report it", async () => {
  await assert.rejects(
    provisionPlatformManualSendWahaRuntime({
      environment: provisionEnvironment(),
      fetchImpl: async () => Response.json([MISSING_BINDING_ROW]),
    }),
    (error) =>
      error.code === "runtime_not_ready" &&
      !error.message.includes(WAHA_API_KEY),
  );
  const status = await checkPlatformManualSendWahaRuntime({
    environment: checkEnvironment(),
    fetchImpl: async () => Response.json([MISSING_BINDING_ROW]),
  });
  assert.deepEqual(status, MISSING_BINDING_ROW);
});

test("status accepts only the database contract reason-code allowlist", () => {
  assert.throws(
    () =>
      validateManualSendWahaRuntimeResponse(
        [{ ...MISSING_BINDING_ROW, reason_code: "unknown_but_safe" }],
        { organizationId: ORGANIZATION_ID },
      ),
    (error) => error.code === "rpc_response_invalid",
  );
  for (const reasonCode of [
    "missing_binding",
    "binding_disabled",
    "binding_contract_invalid",
    "secret_missing",
    "secret_invalid",
    "secret_hash_mismatch",
  ]) {
    const row =
      reasonCode === "missing_binding"
        ? MISSING_BINDING_ROW
        : { ...READY_ROW, ready: false, reason_code: reasonCode };
    assert.deepEqual(
      validateManualSendWahaRuntimeResponse([row], {
        organizationId: ORGANIZATION_ID,
      }),
      row,
    );
  }
});

test("not-ready status rows keep the exact nullable metadata contract", () => {
  assert.throws(
    () =>
      validateManualSendWahaRuntimeResponse(
        [{ ...MISSING_BINDING_ROW, binding_version: 1 }],
        { organizationId: ORGANIZATION_ID },
      ),
    (error) => error.code === "rpc_response_invalid",
  );
  assert.throws(
    () =>
      validateManualSendWahaRuntimeResponse(
        [
          {
            ...READY_ROW,
            ready: false,
            reason_code: "secret_missing",
            api_key_sha256: null,
          },
        ],
        { organizationId: ORGANIZATION_ID },
      ),
    (error) => error.code === "rpc_response_invalid",
  );
});

test("check CLI exits through its public seam when configuration is not ready", async () => {
  let output = "";
  await assert.rejects(
    runCheckPlatformManualSendWahaRuntimeCli({
      environment: checkEnvironment(),
      fetchImpl: async () => Response.json([MISSING_BINDING_ROW]),
      stdout: { write: (chunk) => (output += chunk) },
    }),
    (error) => error.code === "runtime_not_ready",
  );
  assert.equal(output, "");
});

test("HTTP failures, credential echoes and malformed JSON fail without leaking the WAHA key", async (t) => {
  const cases = [
    ["transport", async () => Promise.reject(new Error(WAHA_API_KEY)), "rpc_transport_failed"],
    [
      "rejected",
      async () => new Response(WAHA_API_KEY, { status: 400 }),
      "rpc_rejected",
    ],
    ["malformed", async () => new Response("not-json"), "rpc_response_invalid"],
    [
      "declared oversized",
      async () =>
        new Response("[]", { headers: { "content-length": "65537" } }),
      "rpc_response_too_large",
    ],
    [
      "streamed oversized",
      async () => new Response("x".repeat(65_537)),
      "rpc_response_too_large",
    ],
  ];
  for (const [name, fetchImpl, code] of cases) {
    await t.test(name, async () => {
      await assert.rejects(
        provisionPlatformManualSendWahaRuntime({
          environment: provisionEnvironment(),
          fetchImpl,
        }),
        (error) =>
          error.code === code &&
          !error.message.includes(WAHA_API_KEY) &&
          !JSON.stringify(error).includes(WAHA_API_KEY),
      );
    });
  }
});

test("Supabase HTTP request is aborted at the bounded timeout", async () => {
  const startedAt = Date.now();
  await assert.rejects(
    provisionPlatformManualSendWahaRuntime({
      environment: provisionEnvironment(),
      timeoutMs: 10,
      fetchImpl: async (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener(
            "abort",
            () => reject(new Error(WAHA_API_KEY)),
            { once: true },
          );
        }),
    }),
    (error) =>
      error.code === "rpc_timeout" && !error.message.includes(WAHA_API_KEY),
  );
  assert.ok(Date.now() - startedAt < 1_000);
});

test("timeout covers response streaming and stream errors are redacted", async () => {
  const neverEndingBody = new ReadableStream({
    start() {},
  });
  await assert.rejects(
    provisionPlatformManualSendWahaRuntime({
      environment: provisionEnvironment(),
      timeoutMs: 10,
      fetchImpl: async () => new Response(neverEndingBody),
    }),
    (error) => error.code === "rpc_timeout",
  );

  const erroringBody = new ReadableStream({
    start(controller) {
      controller.error(new Error(WAHA_API_KEY));
    },
  });
  await assert.rejects(
    provisionPlatformManualSendWahaRuntime({
      environment: provisionEnvironment(),
      fetchImpl: async () => new Response(erroringBody),
    }),
    (error) =>
      error.code === "rpc_response_invalid" &&
      !error.message.includes(WAHA_API_KEY),
  );
});

test("CLI stdout contains one exact safe row and never the plaintext WAHA key", async () => {
  let provisionOutput = "";
  const provisionResult = await runProvisionPlatformManualSendWahaRuntimeCli({
    environment: provisionEnvironment(),
    fetchImpl: async () => Response.json([READY_ROW]),
    stdout: { write: (chunk) => (provisionOutput += chunk) },
  });
  assert.equal(provisionOutput, `${JSON.stringify(READY_ROW)}\n`);
  assert.deepEqual(provisionResult, READY_ROW);
  assert.equal(provisionOutput.includes(WAHA_API_KEY), false);

  let checkOutput = "";
  await runCheckPlatformManualSendWahaRuntimeCli({
    environment: checkEnvironment(),
    fetchImpl: async () => Response.json([READY_ROW]),
    stdout: { write: (chunk) => (checkOutput += chunk) },
  });
  assert.equal(checkOutput, `${JSON.stringify(READY_ROW)}\n`);
});

test("operator sources are server-only Supabase RPC clients with no legacy or provider path", async () => {
  const provisionSource = await readFile(
    new URL("../scripts/provision-platform-manual-send-waha-runtime.mjs", import.meta.url),
    "utf8",
  );
  const checkSource = await readFile(
    new URL("../scripts/check-platform-manual-send-waha-runtime.mjs", import.meta.url),
    "utf8",
  );
  const combined = `${provisionSource}\n${checkSource}`;

  assert.doesNotMatch(combined, /better-sqlite|sqlite3|from ["'][^"']*db(?:\.|["'])/i);
  assert.doesNotMatch(combined, /\/api\/sendText|\/api\/sendImage|sendMessage\s*\(/);
  assert.match(combined, /\/rest\/v1\/rpc\//);
  assert.doesNotMatch(
    checkSource,
    /EVO_PLATFORM_MANUAL_SEND_WAHA_API_KEY|EVO_PLATFORM_MANUAL_SEND_BINDING_REQUEST_ID/,
  );
  assert.match(provisionSource, /pathToFileURL[\s\S]*if \(isMain\)/);
  assert.match(checkSource, /pathToFileURL[\s\S]*if \(isMain\)/);
});
