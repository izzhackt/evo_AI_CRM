import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { Readable, Writable } from "node:stream";
import test from "node:test";

import {
  CONFIGURATION_RPC_NAME,
  PROVISION_RPC_NAME,
  callRpc,
  checkWahaRuntimeBinding,
  loadEnvironment,
  probeWahaKey,
  provisionWahaRuntimeBinding,
  readKeyFromStream,
  runCli,
  validateBindingRow,
  validatePlainWahaApiKey,
} from "../scripts/waha-runtime-binding.mjs";

// Every identifier below is synthetic. No Supabase project, WAHA instance or
// provider is contacted: Supabase and WAHA are mocked with injected fetch
// functions or a loopback HTTP server.
const SCRIPT_URL = new URL("../scripts/waha-runtime-binding.mjs", import.meta.url);
const SUPABASE_ORIGIN = "https://abcdefghijklmnopqrst.supabase.co";
const SUPABASE_SECRET_KEY = "sb_secret_abcdefghijklmnopqrstuvwxyz0123456789";
const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const WAHA_KEY = "synthetic-waha-api-key-0123456789abcdef";
const OTHER_KEY = "another-synthetic-waha-key-fedcba9876543210";
const WAHA_KEY_SHA = sha256(WAHA_KEY);
const OTHER_KEY_SHA = sha256(OTHER_KEY);
const WAHA_STATUS_URL = "http://evo-crm-waha:3000/api/sessions/crm_primary";

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function environment(overrides = {}) {
  return {
    NEXT_PUBLIC_SUPABASE_URL: SUPABASE_ORIGIN,
    EVO_PLATFORM_SUPABASE_SECRET_KEY: SUPABASE_SECRET_KEY,
    EVO_PLATFORM_ORGANIZATION_ID: ORGANIZATION_ID,
    ...overrides,
  };
}

const MISSING_ROW = Object.freeze({
  organization_id: ORGANIZATION_ID,
  ready: false,
  reason_code: "missing_binding",
  waha_session_name: null,
  base_url: null,
  binding_version: null,
  api_key_sha256: null,
  updated_at: null,
});

function readyRow(overrides = {}) {
  return {
    organization_id: ORGANIZATION_ID,
    ready: true,
    reason_code: "ready",
    waha_session_name: "crm_primary",
    base_url: "http://evo-crm-waha:3000",
    binding_version: 1,
    api_key_sha256: WAHA_KEY_SHA,
    updated_at: "2026-10-05T06:07:08.123456+00:00",
    ...overrides,
  };
}

function brokenRow(reasonCode, overrides = {}) {
  return readyRow({ ready: false, reason_code: reasonCode, ...overrides });
}

/**
 * A scripted Supabase transport. `script` is an array of responders consumed in
 * order, one per RPC call; each returns a Response or throws. Every call is
 * recorded so tests can assert the exact wire contract.
 */
function scriptedSupabase(script) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const next = script.shift();
    assert.ok(next, `unexpected extra Supabase call to ${url}`);
    return typeof next === "function" ? next({ url, init }) : next;
  };
  return { calls, fetchImpl, remaining: () => script.length };
}

function rows(...payload) {
  return Response.json(payload);
}

function scriptedWaha(responder) {
  const calls = [];
  const wahaFetchImpl = async (url, init) => {
    calls.push({ url, init });
    return responder({ url, init });
  };
  return { calls, wahaFetchImpl };
}

const wahaWorking = () =>
  Response.json({
    name: "crm_primary",
    status: "WORKING",
    engine: { engine: "GOWS" },
    config: { webhooks: [{ url: "http://x", hmac: { key: "WEBHOOK-HMAC-SECRET-MUST-NOT-LEAK" } }] },
    me: { id: "79990000000@c.us", pushName: "Synthetic" },
  });

function assertNoSecrets(value, label = "output") {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  for (const secret of [
    WAHA_KEY,
    OTHER_KEY,
    WAHA_KEY_SHA,
    OTHER_KEY_SHA,
    SUPABASE_SECRET_KEY,
    "WEBHOOK-HMAC-SECRET-MUST-NOT-LEAK",
    "79990000000",
  ]) {
    assert.equal(text.includes(secret), false, `${label} leaks a secret-bearing value`);
  }
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.name, "WahaRuntimeBindingError");
    assert.equal(error.code, code);
    assert.equal(error.message.includes(WAHA_KEY), false);
    return true;
  });
}

function captureStream() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString("utf8"));
      callback();
    },
  });
  return { stream, text: () => chunks.join("") };
}

async function cli(argv, { env = environment(), stdinText = null, fetchImpl, wahaFetchImpl } = {}) {
  const out = captureStream();
  const err = captureStream();
  const stdin = stdinText === null ? Readable.from([]) : Readable.from([Buffer.from(stdinText)]);
  const exitCode = await runCli({
    argv,
    environment: env,
    stdin,
    stdout: out.stream,
    stderr: err.stream,
    fetchImpl,
    wahaFetchImpl,
  });
  return { exitCode, stdout: out.text(), stderr: err.text() };
}

// ---------------------------------------------------------------------------
// provision: create, idempotent re-run, rotate, repair, dry-run
// ---------------------------------------------------------------------------

test("provision creates the binding with the exact RPC contract and prints no key or hash", async () => {
  const supabase = scriptedSupabase([
    rows(MISSING_ROW),
    rows(readyRow()),
    rows(readyRow()),
  ]);
  const waha = scriptedWaha(wahaWorking);
  const { output, exitCode } = await provisionWahaRuntimeBinding({
    environment: environment(),
    fetchImpl: supabase.fetchImpl,
    wahaFetchImpl: waha.wahaFetchImpl,
    apiKey: WAHA_KEY,
    requestId: REQUEST_ID,
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(output, {
    ok: true,
    mode: "provision",
    dry_run: false,
    action: "created",
    previous_reason_code: "missing_binding",
    ready: true,
    reason_code: "ready",
    waha_session_name: "crm_primary",
    base_url: "http://evo-crm-waha:3000",
    binding_version: 1,
    key_matches_input: true,
    waha_key_accepted: true,
    waha_session_status: "WORKING",
    waha_engine: "GOWS",
  });
  assertNoSecrets(output);

  assert.deepEqual(
    supabase.calls.map((call) => call.url),
    [
      `${SUPABASE_ORIGIN}/rest/v1/rpc/${CONFIGURATION_RPC_NAME}`,
      `${SUPABASE_ORIGIN}/rest/v1/rpc/${PROVISION_RPC_NAME}`,
      `${SUPABASE_ORIGIN}/rest/v1/rpc/${CONFIGURATION_RPC_NAME}`,
    ],
  );
  assert.deepEqual(supabase.calls[0].body, { p_organization_id: ORGANIZATION_ID });
  assert.deepEqual(supabase.calls[1].body, {
    p_organization_id: ORGANIZATION_ID,
    p_waha_api_key: WAHA_KEY,
    p_request_id: REQUEST_ID,
  });
  for (const call of supabase.calls) {
    assert.equal(call.init.method, "POST");
    assert.equal(call.init.redirect, "error");
    assert.ok(call.init.signal instanceof AbortSignal);
    assert.deepEqual(call.init.headers, {
      Accept: "application/json",
      "Accept-Profile": "platform",
      apikey: SUPABASE_SECRET_KEY,
      "Content-Profile": "platform",
      "Content-Type": "application/json",
    });
  }
  // The plain key travels only in the body of the one provisioning RPC and in
  // the X-Api-Key header of the WAHA probe; never in any other header or call.
  assert.equal(JSON.stringify(supabase.calls.map((call) => call.init.headers)).includes(WAHA_KEY), false);
  assert.equal(JSON.stringify([supabase.calls[0].body, supabase.calls[2].body]).includes(WAHA_KEY), false);
  assert.equal(waha.calls.length, 1);
  assert.equal(waha.calls[0].url, WAHA_STATUS_URL);
  assert.equal(waha.calls[0].init.method, "GET");
  assert.equal(waha.calls[0].init.redirect, "error");
  assert.equal(waha.calls[0].init.headers["X-Api-Key"], WAHA_KEY);
  assert.equal(supabase.remaining(), 0);
});

test("provision is idempotent: a ready binding holding the same key is not written again", async () => {
  const supabase = scriptedSupabase([rows(readyRow({ binding_version: 4 }))]);
  const { output, exitCode } = await provisionWahaRuntimeBinding({
    environment: environment(),
    fetchImpl: supabase.fetchImpl,
    wahaFetchImpl: scriptedWaha(wahaWorking).wahaFetchImpl,
    apiKey: WAHA_KEY,
  });
  assert.equal(exitCode, 0);
  assert.equal(output.action, "unchanged");
  assert.equal(output.binding_version, 4);
  assert.equal(output.key_matches_input, true);
  assert.equal(supabase.calls.length, 1, "only the read-only configuration RPC may run");
  assert.equal(supabase.calls[0].url.endsWith(CONFIGURATION_RPC_NAME), true);
  assertNoSecrets(output);
});

test("provision rotates a ready binding that holds a different key", async () => {
  const supabase = scriptedSupabase([
    rows(readyRow({ api_key_sha256: OTHER_KEY_SHA, binding_version: 1 })),
    rows(readyRow({ binding_version: 2 })),
    rows(readyRow({ binding_version: 2 })),
  ]);
  const { output } = await provisionWahaRuntimeBinding({
    environment: environment(),
    fetchImpl: supabase.fetchImpl,
    wahaFetchImpl: scriptedWaha(wahaWorking).wahaFetchImpl,
    apiKey: WAHA_KEY,
  });
  assert.equal(output.action, "rotated");
  assert.equal(output.previous_reason_code, "ready");
  assert.equal(output.binding_version, 2);
  assert.equal(output.key_matches_input, true);
  assertNoSecrets(output);
});

test("provision repairs a binding that exists but is not ready", async () => {
  for (const reason of ["binding_disabled", "secret_missing", "secret_invalid", "secret_hash_mismatch"]) {
    const supabase = scriptedSupabase([
      rows(brokenRow(reason)),
      rows(readyRow({ binding_version: 2 })),
      rows(readyRow({ binding_version: 2 })),
    ]);
    const { output } = await provisionWahaRuntimeBinding({
      environment: environment(),
      fetchImpl: supabase.fetchImpl,
      wahaFetchImpl: scriptedWaha(wahaWorking).wahaFetchImpl,
      apiKey: WAHA_KEY,
    });
    assert.equal(output.action, "repaired", reason);
    assert.equal(output.previous_reason_code, reason);
  }
});

test("--dry-run plans every case from reads only and never calls the provisioning RPC", async () => {
  const cases = [
    [MISSING_ROW, "would_create"],
    [readyRow({ api_key_sha256: OTHER_KEY_SHA }), "would_rotate"],
    [brokenRow("secret_missing"), "would_repair"],
    [readyRow(), "unchanged"],
  ];
  for (const [row, action] of cases) {
    const supabase = scriptedSupabase([rows(row)]);
    const { output, exitCode } = await provisionWahaRuntimeBinding({
      environment: environment(),
      fetchImpl: supabase.fetchImpl,
      wahaFetchImpl: scriptedWaha(wahaWorking).wahaFetchImpl,
      apiKey: WAHA_KEY,
      dryRun: true,
    });
    assert.equal(exitCode, 0);
    assert.equal(output.dry_run, true);
    assert.equal(output.action, action);
    assert.equal(supabase.calls.length, 1, `${action} must stay read-only`);
    assert.equal(supabase.calls[0].url.endsWith(CONFIGURATION_RPC_NAME), true);
    assertNoSecrets(output, action);
  }
});

test("provision refuses a key that WAHA rejects before any write", async () => {
  for (const dryRun of [false, true]) {
    const supabase = scriptedSupabase([rows(MISSING_ROW)]);
    const waha = scriptedWaha(() => new Response("{}", { status: 401 }));
    await expectCode(
      provisionWahaRuntimeBinding({
        environment: environment(),
        fetchImpl: supabase.fetchImpl,
        wahaFetchImpl: waha.wahaFetchImpl,
        apiKey: WAHA_KEY,
        dryRun,
      }),
      "waha_key_rejected",
    );
    assert.equal(supabase.calls.length, 1, "the provisioning RPC must not run");
  }
});

test("provision stops when WAHA does not answer, unless the WAHA check is skipped", async () => {
  const unreachable = async () => {
    throw new TypeError("fetch failed");
  };
  await expectCode(
    provisionWahaRuntimeBinding({
      environment: environment(),
      fetchImpl: scriptedSupabase([rows(MISSING_ROW)]).fetchImpl,
      wahaFetchImpl: unreachable,
      apiKey: WAHA_KEY,
    }),
    "waha_unreachable",
  );
  const supabase = scriptedSupabase([rows(MISSING_ROW), rows(readyRow()), rows(readyRow())]);
  const { output } = await provisionWahaRuntimeBinding({
    environment: environment(),
    fetchImpl: supabase.fetchImpl,
    wahaFetchImpl: unreachable,
    apiKey: WAHA_KEY,
    skipWahaCheck: true,
  });
  assert.equal(output.action, "created");
  assert.equal(output.waha_key_accepted, null);
  assert.equal(output.waha_session_status, null);
});

test("provision fails closed when the stored key does not match the supplied one after the write", async () => {
  const supabase = scriptedSupabase([
    rows(MISSING_ROW),
    rows(readyRow({ api_key_sha256: OTHER_KEY_SHA })),
  ]);
  await expectCode(
    provisionWahaRuntimeBinding({
      environment: environment(),
      fetchImpl: supabase.fetchImpl,
      wahaFetchImpl: scriptedWaha(wahaWorking).wahaFetchImpl,
      apiKey: WAHA_KEY,
    }),
    "provision_hash_mismatch",
  );
  // A read-back that is no longer ready is reported as such.
  await expectCode(
    provisionWahaRuntimeBinding({
      environment: environment(),
      fetchImpl: scriptedSupabase([rows(MISSING_ROW), rows(readyRow()), rows(brokenRow("secret_missing"))]).fetchImpl,
      wahaFetchImpl: scriptedWaha(wahaWorking).wahaFetchImpl,
      apiKey: WAHA_KEY,
    }),
    "readback_not_ready",
  );
  await expectCode(
    provisionWahaRuntimeBinding({
      environment: environment(),
      fetchImpl: scriptedSupabase([rows(MISSING_ROW), rows(brokenRow("secret_missing"))]).fetchImpl,
      wahaFetchImpl: scriptedWaha(wahaWorking).wahaFetchImpl,
      apiKey: WAHA_KEY,
    }),
    "readback_not_ready",
  );
});

// ---------------------------------------------------------------------------
// target refusal: only crm_primary at http://evo-crm-waha:3000
// ---------------------------------------------------------------------------

test("a binding that targets anything but crm_primary at the CRM WAHA URL is refused", async () => {
  const targets = [
    { waha_session_name: "evo-inbox", base_url: "http://evo-inbox-waha:3000" },
    { waha_session_name: "evo-inbox", base_url: "http://evo-crm-waha:3000" },
    { waha_session_name: "crm_primary", base_url: "http://evo-inbox-waha:3000" },
    { waha_session_name: "china_curator", base_url: "http://evo-crm-waha:3000" },
    { waha_session_name: "crm_primary", base_url: "https://waha.example.test" },
  ];
  for (const target of targets) {
    await expectCode(
      checkWahaRuntimeBinding({
        environment: environment(),
        fetchImpl: scriptedSupabase([rows(readyRow(target))]).fetchImpl,
      }),
      "binding_target_mismatch",
    );
    await expectCode(
      provisionWahaRuntimeBinding({
        environment: environment(),
        fetchImpl: scriptedSupabase([rows(readyRow(target))]).fetchImpl,
        wahaFetchImpl: scriptedWaha(wahaWorking).wahaFetchImpl,
        apiKey: WAHA_KEY,
      }),
      "binding_target_mismatch",
    );
  }
  // A provisioning response that reports another target is refused as well.
  await expectCode(
    provisionWahaRuntimeBinding({
      environment: environment(),
      fetchImpl: scriptedSupabase([
        rows(MISSING_ROW),
        rows(readyRow({ waha_session_name: "evo-inbox", base_url: "http://evo-inbox-waha:3000" })),
      ]).fetchImpl,
      wahaFetchImpl: scriptedWaha(wahaWorking).wahaFetchImpl,
      apiKey: WAHA_KEY,
    }),
    "binding_target_mismatch",
  );
});

test("--session and --base-url are assertions that accept only the one allowed target", async () => {
  const refusals = [
    ["--session", "evo-inbox"],
    ["--session", "china_curator"],
    ["--base-url", "http://evo-inbox-waha:3000"],
    ["--base-url", "https://waha.example.test"],
  ];
  for (const [flag, value] of refusals) {
    const supabase = scriptedSupabase([]);
    const result = await cli(["check", flag, value], { fetchImpl: supabase.fetchImpl });
    assert.equal(result.exitCode, 1, `${flag} ${value}`);
    assert.deepEqual(JSON.parse(result.stderr), { ok: false, error_code: "target_not_allowed" });
    assert.equal(supabase.calls.length, 0);
  }
  const ok = await cli(
    ["check", "--session", "crm_primary", "--base-url", "http://evo-crm-waha:3000"],
    { fetchImpl: scriptedSupabase([rows(readyRow())]).fetchImpl },
  );
  assert.equal(ok.exitCode, 0);
});

// ---------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------

test("check reports readiness without a key and exits 3 when the binding is not ready", async () => {
  const ready = await checkWahaRuntimeBinding({
    environment: environment(),
    fetchImpl: scriptedSupabase([rows(readyRow({ binding_version: 7 }))]).fetchImpl,
  });
  assert.equal(ready.exitCode, 0);
  assert.deepEqual(ready.output, {
    ok: true,
    mode: "check",
    ready: true,
    reason_code: "ready",
    waha_session_name: "crm_primary",
    base_url: "http://evo-crm-waha:3000",
    binding_version: 7,
  });
  const missing = await checkWahaRuntimeBinding({
    environment: environment(),
    fetchImpl: scriptedSupabase([rows(MISSING_ROW)]).fetchImpl,
  });
  assert.equal(missing.exitCode, 3);
  assert.equal(missing.output.ready, false);
  assert.equal(missing.output.reason_code, "missing_binding");
  assert.equal(missing.output.binding_version, null);
  assertNoSecrets([ready.output, missing.output]);
});

test("check --verify-key compares the key locally and asks WAHA, printing booleans only", async () => {
  const good = await checkWahaRuntimeBinding({
    environment: environment(),
    fetchImpl: scriptedSupabase([rows(readyRow())]).fetchImpl,
    wahaFetchImpl: scriptedWaha(wahaWorking).wahaFetchImpl,
    apiKey: WAHA_KEY,
    verifyKey: true,
  });
  assert.equal(good.exitCode, 0);
  assert.equal(good.output.key_matches_stored_binding, true);
  assert.equal(good.output.waha_key_accepted, true);
  assert.equal(good.output.waha_session_status, "WORKING");
  assert.equal(good.output.waha_engine, "GOWS");
  assertNoSecrets(good.output);

  const mismatch = await checkWahaRuntimeBinding({
    environment: environment(),
    fetchImpl: scriptedSupabase([rows(readyRow({ api_key_sha256: OTHER_KEY_SHA }))]).fetchImpl,
    wahaFetchImpl: scriptedWaha(wahaWorking).wahaFetchImpl,
    apiKey: WAHA_KEY,
    verifyKey: true,
  });
  assert.equal(mismatch.exitCode, 3);
  assert.equal(mismatch.output.key_matches_stored_binding, false);

  const wahaRefuses = await checkWahaRuntimeBinding({
    environment: environment(),
    fetchImpl: scriptedSupabase([rows(readyRow())]).fetchImpl,
    wahaFetchImpl: scriptedWaha(() => new Response("", { status: 401 })).wahaFetchImpl,
    apiKey: WAHA_KEY,
    verifyKey: true,
  });
  assert.equal(wahaRefuses.exitCode, 3);
  assert.equal(wahaRefuses.output.waha_key_accepted, false);

  const missing = await checkWahaRuntimeBinding({
    environment: environment(),
    fetchImpl: scriptedSupabase([rows(MISSING_ROW)]).fetchImpl,
    apiKey: WAHA_KEY,
    verifyKey: true,
    skipWahaCheck: true,
  });
  assert.equal(missing.exitCode, 3);
  assert.equal(missing.output.key_matches_stored_binding, false);
  assert.equal(missing.output.waha_key_accepted, null);
});

// ---------------------------------------------------------------------------
// WAHA probe: closed enums, no body retention
// ---------------------------------------------------------------------------

test("the WAHA probe maps statuses to closed enums and never retains the body", async () => {
  const probe = (response) =>
    probeWahaKey({ apiKey: WAHA_KEY, wahaFetchImpl: async () => response });

  assert.deepEqual(await probe(wahaWorking()), { accepted: true, status: "WORKING", engine: "GOWS" });
  assert.deepEqual(await probe(new Response("", { status: 401 })), {
    accepted: false,
    status: null,
    engine: null,
  });
  assert.deepEqual(await probe(new Response("", { status: 403 })), {
    accepted: false,
    status: null,
    engine: null,
  });
  assert.deepEqual(await probe(new Response("", { status: 404 })), {
    accepted: true,
    status: "NOT_FOUND",
    engine: null,
  });
  for (const status of ["STOPPED", "STARTING", "SCAN_QR_CODE", "FAILED", "PASSKEY_REQUIRED", "PASSKEY_CONFIRMATION_REQUIRED"]) {
    const result = await probe(Response.json({ status, engine: { engine: "GOWS" } }));
    assert.equal(result.status, status);
  }
  // Hostile or unexpected content cannot reach the operator output.
  const hostile = await probe(Response.json({ status: "<script>alert(1)</script>", engine: { engine: "evil\nENGINE" } }));
  assert.deepEqual(hostile, { accepted: true, status: "UNKNOWN", engine: "UNKNOWN" });
  const notJson = await probe(new Response("not json", { status: 200 }));
  assert.deepEqual(notJson, { accepted: true, status: "UNKNOWN", engine: "UNKNOWN" });

  await expectCode(probe(new Response("", { status: 500 })), "waha_unreachable");
  await expectCode(
    probeWahaKey({
      apiKey: WAHA_KEY,
      wahaFetchImpl: async () => {
        throw new TypeError("getaddrinfo ENOTFOUND evo-crm-waha");
      },
    }),
    "waha_unreachable",
  );
  await expectCode(
    probeWahaKey({
      apiKey: WAHA_KEY,
      timeoutMs: 20,
      wahaFetchImpl: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    }),
    "waha_unreachable",
  );
});

// ---------------------------------------------------------------------------
// Supabase transport and response contract
// ---------------------------------------------------------------------------

test("RPC transport maps HTTP and transport failures to closed error codes", async () => {
  const call = (fetchImpl, extra = {}) =>
    callRpc({
      rpcName: CONFIGURATION_RPC_NAME,
      supabaseOrigin: SUPABASE_ORIGIN,
      supabaseSecretKey: SUPABASE_SECRET_KEY,
      body: { p_organization_id: ORGANIZATION_ID },
      fetchImpl,
      ...extra,
    });
  await expectCode(call(async () => new Response("", { status: 401 })), "rpc_unauthorized");
  await expectCode(call(async () => new Response("", { status: 403 })), "rpc_unauthorized");
  await expectCode(call(async () => new Response("", { status: 404 })), "rpc_not_found");
  await expectCode(call(async () => new Response("", { status: 500 })), "rpc_rejected");
  await expectCode(call(async () => new Response(null, { status: 204 })), "rpc_rejected");
  await expectCode(
    call(async () => {
      throw new TypeError("fetch failed");
    }),
    "rpc_transport_failed",
  );
  await expectCode(
    call(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
      { timeoutMs: 20 },
    ),
    "rpc_timeout",
  );
  await expectCode(
    call(async () => new Response("x", { status: 200, headers: { "content-length": "70000" } })),
    "rpc_response_too_large",
  );
  await expectCode(
    call(async () => new Response("y".repeat(70_000), { status: 200 })),
    "rpc_response_too_large",
  );
  await expectCode(call(async () => new Response("not json", { status: 200 })), "rpc_response_invalid");
  await expectCode(
    call(async () => new Response("[]", { status: 200, headers: { "content-length": "abc" } })),
    "rpc_response_invalid",
  );
  await expectCode(
    callRpc({
      rpcName: "resolve_manual_send_waha_runtime",
      supabaseOrigin: SUPABASE_ORIGIN,
      supabaseSecretKey: SUPABASE_SECRET_KEY,
      body: {},
      fetchImpl: async () => Response.json([]),
    }),
    "usage",
  );
});

test("a legacy service_role JWT is also sent as a bearer token; an sb_secret_ key never is", async () => {
  const jwt = [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url"),
    "signature",
  ].join(".");
  const supabase = scriptedSupabase([rows(MISSING_ROW)]);
  await checkWahaRuntimeBinding({
    environment: environment({ EVO_PLATFORM_SUPABASE_SECRET_KEY: jwt }),
    fetchImpl: supabase.fetchImpl,
  });
  assert.equal(supabase.calls[0].init.headers.apikey, jwt);
  assert.equal(supabase.calls[0].init.headers.Authorization, `Bearer ${jwt}`);

  const modern = scriptedSupabase([rows(MISSING_ROW)]);
  await checkWahaRuntimeBinding({ environment: environment(), fetchImpl: modern.fetchImpl });
  assert.equal(Object.hasOwn(modern.calls[0].init.headers, "Authorization"), false);
});

test("binding rows must match the exact RPC shape and invariants", () => {
  const bad = [
    [],
    [readyRow(), readyRow()],
    [{ ...readyRow(), extra: 1 }],
    [Object.fromEntries(Object.entries(readyRow()).filter(([key]) => key !== "updated_at"))],
    [readyRow({ organization_id: "33333333-3333-4333-8333-333333333333" })],
    [readyRow({ ready: "yes" })],
    [readyRow({ reason_code: "secret_missing" })],
    [brokenRow("ready")],
    [readyRow({ reason_code: "bogus" })],
    [{ ...MISSING_ROW, binding_version: 1 }],
    [{ ...MISSING_ROW, ready: true }],
    [readyRow({ binding_version: 0 })],
    [readyRow({ binding_version: "1" })],
    [readyRow({ binding_version: 1.5 })],
    [readyRow({ api_key_sha256: "ABC" })],
    [readyRow({ api_key_sha256: null })],
    [readyRow({ updated_at: "yesterday" })],
    [readyRow({ updated_at: "2026-02-30T00:00:00Z" })],
    "not-an-array",
    null,
  ];
  for (const payload of bad) {
    assert.throws(
      () => validateBindingRow(payload, ORGANIZATION_ID),
      (error) => error.name === "WahaRuntimeBindingError" && error.code === "rpc_response_invalid",
      JSON.stringify(payload),
    );
  }
  assert.equal(validateBindingRow([readyRow()], ORGANIZATION_ID).ready, true);
  assert.equal(validateBindingRow([MISSING_ROW], ORGANIZATION_ID).reason_code, "missing_binding");
});

// ---------------------------------------------------------------------------
// Key and environment validation
// ---------------------------------------------------------------------------

test("the plain WAHA key must be trimmed, 16-4096 bytes, single-line and not the sha512 hash", () => {
  assert.equal(validatePlainWahaApiKey(WAHA_KEY), WAHA_KEY);
  assert.equal(validatePlainWahaApiKey("a".repeat(16)), "a".repeat(16));
  assert.equal(validatePlainWahaApiKey("a".repeat(4096)).length, 4096);
  const invalid = [
    "",
    "short",
    "a".repeat(15),
    "a".repeat(4097),
    ` ${WAHA_KEY}`,
    `${WAHA_KEY} `,
    `${WAHA_KEY}\n`,
    `${WAHA_KEY}\r`,
    `abc\ndef-0123456789abcdef`,
    `abc\0def-0123456789abcdef`,
    undefined,
    null,
    42,
  ];
  for (const value of invalid) {
    assert.throws(
      () => validatePlainWahaApiKey(value),
      (error) => error.code === "key_invalid",
      JSON.stringify(value),
    );
  }
  for (const value of [`sha512:${"a".repeat(128)}`, `SHA512:${"b".repeat(128)}`]) {
    assert.throws(
      () => validatePlainWahaApiKey(value),
      (error) => error.code === "key_looks_like_hash",
    );
  }
});

test("environment must hold the exact Supabase origin, a server key and a non-nil organization id", () => {
  assert.equal(loadEnvironment(environment()).organizationId, ORGANIZATION_ID);
  const bad = [
    {},
    environment({ NEXT_PUBLIC_SUPABASE_URL: undefined }),
    environment({ NEXT_PUBLIC_SUPABASE_URL: "http://abcdefghijklmnopqrst.supabase.co" }),
    environment({ NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co/" }),
    environment({ NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co/rest/v1" }),
    environment({ NEXT_PUBLIC_SUPABASE_URL: "https://user:pass@abcdefghijklmnopqrst.supabase.co" }),
    environment({ NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co:444" }),
    environment({ NEXT_PUBLIC_SUPABASE_URL: "https://attacker.example.test" }),
    environment({ NEXT_PUBLIC_SUPABASE_URL: "https://short.supabase.co" }),
    environment({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" }),
    environment({ EVO_PLATFORM_SUPABASE_SECRET_KEY: undefined }),
    environment({ EVO_PLATFORM_SUPABASE_SECRET_KEY: "sb_publishable_abcdefghijklmnopqrstuv" }),
    environment({ EVO_PLATFORM_SUPABASE_SECRET_KEY: "sb_secret_short" }),
    environment({ EVO_PLATFORM_ORGANIZATION_ID: "not-a-uuid" }),
    environment({ EVO_PLATFORM_ORGANIZATION_ID: "00000000-0000-0000-0000-000000000000" }),
    environment({ EVO_PLATFORM_ORGANIZATION_ID: undefined }),
  ];
  for (const candidate of bad) {
    assert.throws(
      () => loadEnvironment(candidate),
      (error) => error.code === "invalid_environment",
      JSON.stringify(candidate),
    );
  }
  assert.throws(() => loadEnvironment(null), (error) => error.code === "invalid_environment");
  // A loopback origin is accepted only with the explicit test-only opt-in.
  const local = environment({
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    EVO_WAHA_BINDING_ALLOW_LOCAL_SUPABASE: "1",
  });
  assert.equal(loadEnvironment(local).supabaseOrigin, "http://127.0.0.1:54321");
  assert.throws(
    () =>
      loadEnvironment(
        environment({
          NEXT_PUBLIC_SUPABASE_URL: "http://attacker.example.test:54321",
          EVO_WAHA_BINDING_ALLOW_LOCAL_SUPABASE: "1",
        }),
      ),
    (error) => error.code === "invalid_environment",
  );
});

test("stdin key reading tolerates one trailing newline, refuses terminals and times out", async () => {
  const stream = (text) => Readable.from([Buffer.from(text)]);
  assert.equal(await readKeyFromStream(stream(WAHA_KEY)), WAHA_KEY);
  assert.equal(await readKeyFromStream(stream(`${WAHA_KEY}\n`)), WAHA_KEY);
  assert.equal(await readKeyFromStream(stream(`${WAHA_KEY}\r\n`)), WAHA_KEY);
  await expectCode(readKeyFromStream(stream(`${WAHA_KEY}\n\n`)), "key_invalid");
  await expectCode(readKeyFromStream(stream("")), "key_invalid");
  await expectCode(readKeyFromStream(stream("x".repeat(5000))), "key_invalid");
  await expectCode(readKeyFromStream(stream(`sha512:${"c".repeat(128)}\n`)), "key_looks_like_hash");

  const terminal = Readable.from([Buffer.from(WAHA_KEY)]);
  terminal.isTTY = true;
  await expectCode(readKeyFromStream(terminal), "key_stdin_is_tty");

  const never = new Readable({ read() {} });
  await expectCode(readKeyFromStream(never, { timeoutMs: 30 }), "key_stdin_timeout");
  never.destroy();
});

// ---------------------------------------------------------------------------
// CLI surface (injected streams)
// ---------------------------------------------------------------------------

test("CLI provision reads the key from stdin, prints one JSON line and exits 0", async () => {
  const supabase = scriptedSupabase([rows(MISSING_ROW), rows(readyRow()), rows(readyRow())]);
  const result = await cli(["provision", "--key-stdin"], {
    stdinText: `${WAHA_KEY}\n`,
    fetchImpl: supabase.fetchImpl,
    wahaFetchImpl: scriptedWaha(wahaWorking).wahaFetchImpl,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout.endsWith("\n"), true);
  const line = JSON.parse(result.stdout);
  assert.equal(line.action, "created");
  assertNoSecrets(result.stdout, "stdout");
  assert.equal(supabase.calls[1].body.p_waha_api_key, WAHA_KEY);
});

test("CLI accepts the key from the environment and the --check/--provision aliases", async () => {
  const supabase = scriptedSupabase([rows(readyRow())]);
  const result = await cli(["--provision", "--dry-run"], {
    env: environment({ EVO_PLATFORM_MANUAL_SEND_WAHA_API_KEY: WAHA_KEY }),
    fetchImpl: supabase.fetchImpl,
    wahaFetchImpl: scriptedWaha(wahaWorking).wahaFetchImpl,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(JSON.parse(result.stdout).action, "unchanged");
  assertNoSecrets(result.stdout);

  const check = await cli(["--check"], { fetchImpl: scriptedSupabase([rows(MISSING_ROW)]).fetchImpl });
  assert.equal(check.exitCode, 3);
  assert.equal(JSON.parse(check.stdout).mode, "check");
});

test("CLI check ignores a key in the environment unless --verify-key asks for it", async () => {
  const supabase = scriptedSupabase([rows(readyRow())]);
  const result = await cli(["check"], {
    env: environment({ EVO_PLATFORM_MANUAL_SEND_WAHA_API_KEY: "short" }),
    fetchImpl: supabase.fetchImpl,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(Object.hasOwn(JSON.parse(result.stdout), "key_matches_stored_binding"), false);
});

test("CLI refuses secrets in argv and every ambiguous or inapplicable option", async () => {
  const never = scriptedSupabase([]);
  const attempts = [
    ["provision", "--key", WAHA_KEY],
    ["provision", `--key=${WAHA_KEY}`],
    ["provision", WAHA_KEY],
    ["--api-key", WAHA_KEY, "provision"],
    [],
    ["check", "provision"],
    ["--check", "--provision"],
    ["check", "--dry-run"],
    ["provision", "--verify-key"],
    ["check", "--key-stdin"],
    ["provision", "--session"],
    ["provision", "--session", "--dry-run"],
    ["bogus"],
  ];
  for (const argv of attempts) {
    const result = await cli(argv, {
      stdinText: WAHA_KEY,
      fetchImpl: never.fetchImpl,
      wahaFetchImpl: scriptedWaha(wahaWorking).wahaFetchImpl,
    });
    assert.equal(result.exitCode, 2, JSON.stringify(argv));
    assert.deepEqual(JSON.parse(result.stderr), { ok: false, error_code: "usage" });
    assert.equal(result.stdout, "");
    assertNoSecrets(result.stderr, "stderr");
  }
  assert.equal(never.calls.length, 0);
});

test("CLI key sources: exactly one, required for provision, hash and tty refused", async () => {
  const never = scriptedSupabase([]);
  const expectError = async (argv, options, code) => {
    const result = await cli(argv, { fetchImpl: never.fetchImpl, ...options });
    assert.equal(result.exitCode, 1, `${argv.join(" ")} -> ${code}`);
    assert.deepEqual(JSON.parse(result.stderr), { ok: false, error_code: code });
    assert.equal(result.stdout, "");
    assertNoSecrets(result.stderr, "stderr");
  };
  await expectError(["provision"], {}, "key_required");
  await expectError(["check", "--verify-key"], {}, "key_required");
  await expectError(
    ["provision", "--key-stdin"],
    { env: environment({ EVO_PLATFORM_MANUAL_SEND_WAHA_API_KEY: OTHER_KEY }), stdinText: WAHA_KEY },
    "key_source_ambiguous",
  );
  await expectError(["provision", "--key-stdin"], { stdinText: "" }, "key_invalid");
  await expectError(["provision", "--key-stdin"], { stdinText: `sha512:${"d".repeat(128)}` }, "key_looks_like_hash");
  await expectError(
    ["provision"],
    { env: environment({ EVO_PLATFORM_MANUAL_SEND_WAHA_API_KEY: "tooshort" }) },
    "key_invalid",
  );
  await expectError(["provision", "--key-stdin"], { env: environment({ NEXT_PUBLIC_SUPABASE_URL: "https://x.test" }), stdinText: WAHA_KEY }, "invalid_environment");
  assert.equal(never.calls.length, 0);
});

test("CLI failures are one closed JSON line on stderr with no message text, exit 1", async () => {
  const result = await cli(["check"], {
    fetchImpl: async () => {
      throw new Error(`boom with ${WAHA_KEY} and ${SUPABASE_SECRET_KEY}`);
    },
  });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(JSON.parse(result.stderr), { ok: false, error_code: "rpc_transport_failed" });
  assertNoSecrets(result.stderr, "stderr");
  const unexpected = await cli(["check"], {
    fetchImpl: async () => Response.json([readyRow()]),
    env: environment({ EVO_PLATFORM_ORGANIZATION_ID: ORGANIZATION_ID }),
  });
  assert.equal(unexpected.exitCode, 0);
});

test("--help prints the usage and nothing secret", async () => {
  const result = await cli(["--help"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /provision/);
  assert.match(result.stdout, /crm_primary/);
  assertNoSecrets(result.stdout);
});

// ---------------------------------------------------------------------------
// Real process against a loopback mock of Supabase (no real calls)
// ---------------------------------------------------------------------------

function startMockSupabase(handler) {
  return new Promise((resolve) => {
    const requests = [];
    const server = createServer((request, response) => {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        requests.push({
          method: request.method,
          url: request.url,
          headers: request.headers,
          body: body === "" ? null : JSON.parse(body),
        });
        const { status, payload } = handler(requests.at(-1), requests.length);
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(payload));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      resolve({
        origin: `http://127.0.0.1:${server.address().port}`,
        requests,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function runProcess(args, { env, stdin = "" }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT_URL.pathname, ...args], {
      env: { PATH: process.env.PATH, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin);
  });
}

test("the real CLI process provisions through a loopback mock and keeps the key out of every channel", async () => {
  let state = "missing";
  const server = await startMockSupabase((request) => {
    if (request.url.endsWith(`/${PROVISION_RPC_NAME}`)) {
      state = "ready";
      return { status: 200, payload: [readyRow()] };
    }
    return { status: 200, payload: [state === "ready" ? readyRow() : MISSING_ROW] };
  });
  try {
    const processEnvironment = {
      NEXT_PUBLIC_SUPABASE_URL: server.origin,
      EVO_PLATFORM_SUPABASE_SECRET_KEY: SUPABASE_SECRET_KEY,
      EVO_PLATFORM_ORGANIZATION_ID: ORGANIZATION_ID,
      EVO_WAHA_BINDING_ALLOW_LOCAL_SUPABASE: "1",
    };

    const before = await runProcess(["check"], { env: processEnvironment });
    assert.equal(before.code, 3);
    assert.equal(JSON.parse(before.stdout).reason_code, "missing_binding");

    const dry = await runProcess(["provision", "--key-stdin", "--dry-run", "--skip-waha-check"], {
      env: processEnvironment,
      stdin: `${WAHA_KEY}\n`,
    });
    assert.equal(dry.code, 0, dry.stderr);
    assert.equal(JSON.parse(dry.stdout).action, "would_create");
    assert.equal(server.requests.some((request) => request.url.endsWith(`/${PROVISION_RPC_NAME}`)), false);

    const written = await runProcess(["provision", "--key-stdin", "--skip-waha-check"], {
      env: processEnvironment,
      stdin: `${WAHA_KEY}\n`,
    });
    assert.equal(written.code, 0, written.stderr);
    assert.equal(JSON.parse(written.stdout).action, "created");
    assert.equal(written.stderr, "");
    for (const channel of [written.stdout, written.stderr, dry.stdout, dry.stderr, before.stdout, before.stderr]) {
      assertNoSecrets(channel, "process output");
    }

    const provisionRequests = server.requests.filter((request) => request.url.endsWith(`/${PROVISION_RPC_NAME}`));
    assert.equal(provisionRequests.length, 1);
    assert.equal(provisionRequests[0].body.p_waha_api_key, WAHA_KEY);
    assert.equal(provisionRequests[0].headers["accept-profile"], "platform");
    assert.equal(provisionRequests[0].headers["content-profile"], "platform");
    assert.equal(provisionRequests[0].headers.apikey, SUPABASE_SECRET_KEY);
    // The key never appears in a URL or a header.
    for (const request of server.requests) {
      assert.equal(request.url.includes(WAHA_KEY), false);
      assert.equal(JSON.stringify(request.headers).includes(WAHA_KEY), false);
    }

    // Idempotent re-run: the binding is ready with the same key, so nothing is written.
    const writesBefore = provisionRequests.length;
    const again = await runProcess(["provision", "--key-stdin", "--skip-waha-check"], {
      env: processEnvironment,
      stdin: `${WAHA_KEY}\n`,
    });
    assert.equal(again.code, 0, again.stderr);
    assert.equal(JSON.parse(again.stdout).action, "unchanged");
    assert.equal(
      server.requests.filter((request) => request.url.endsWith(`/${PROVISION_RPC_NAME}`)).length,
      writesBefore,
    );

    // argv secrets are refused and not echoed by the real process either.
    const argv = await runProcess(["provision", "--key", WAHA_KEY], { env: processEnvironment });
    assert.equal(argv.code, 2);
    assertNoSecrets(argv.stdout + argv.stderr, "argv refusal");

    // Without the opt-in a loopback origin is refused (production never sets it).
    const production = { ...processEnvironment };
    delete production.EVO_WAHA_BINDING_ALLOW_LOCAL_SUPABASE;
    const refused = await runProcess(["check"], { env: production });
    assert.equal(refused.code, 1);
    assert.deepEqual(JSON.parse(refused.stderr), { ok: false, error_code: "invalid_environment" });
  } finally {
    await server.close();
  }
});

test("the real CLI process returns unauthorized and not-found Supabase answers as closed codes", async () => {
  for (const [status, code] of [
    [401, "rpc_unauthorized"],
    [404, "rpc_not_found"],
    [500, "rpc_rejected"],
  ]) {
    const server = await startMockSupabase(() => ({ status, payload: { message: `secret-looking ${WAHA_KEY}` } }));
    try {
      const result = await runProcess(["check"], {
        env: {
          NEXT_PUBLIC_SUPABASE_URL: server.origin,
          EVO_PLATFORM_SUPABASE_SECRET_KEY: SUPABASE_SECRET_KEY,
          EVO_PLATFORM_ORGANIZATION_ID: ORGANIZATION_ID,
          EVO_WAHA_BINDING_ALLOW_LOCAL_SUPABASE: "1",
        },
      });
      assert.equal(result.code, 1);
      assert.deepEqual(JSON.parse(result.stderr), { ok: false, error_code: code });
      assert.equal(result.stdout, "");
      // The mock answered with text containing the key: it must not be relayed.
      assertNoSecrets(result.stderr, "relayed body");
    } finally {
      await server.close();
    }
  }
});

// ---------------------------------------------------------------------------
// Static invariants
// ---------------------------------------------------------------------------

test("the script is dependency-free, never logs and never reads secrets from argv", () => {
  const source = readFileSync(SCRIPT_URL, "utf8");
  const imports = [...source.matchAll(/^import .* from "([^"]+)";$/gmu)].map((match) => match[1]);
  assert.deepEqual(imports.sort(), ["node:crypto", "node:path", "node:url"]);
  assert.doesNotMatch(source, /console\./u);
  assert.doesNotMatch(source, /require\(/u);
  assert.doesNotMatch(source, /resolve_manual_send_waha_runtime/u, "the plain-key resolver must never be called");
  assert.doesNotMatch(source, /evo-inbox/u);
  // argv is only matched against fixed option names; no value is stored as a key.
  assert.doesNotMatch(source, /argv\[index \+ 1\][^;]*[Kk]ey/u);
  assert.match(source, /"crm_primary"/u);
  assert.match(source, /"http:\/\/evo-crm-waha:3000"/u);
});

test("the runner image ships the script as a non-root, read-only-executable file", () => {
  const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(
    dockerfile,
    /COPY --from=builder --chown=nextjs:nodejs --chmod=0555 \/app\/scripts\/waha-runtime-binding\.mjs \.\/scripts\/waha-runtime-binding\.mjs/u,
  );
  const copyIndex = dockerfile.indexOf("/app/scripts/waha-runtime-binding.mjs");
  const userIndex = dockerfile.lastIndexOf("USER nextjs");
  assert.ok(copyIndex > 0 && userIndex > copyIndex, "the COPY must precede the final USER nextjs");
  const dockerignore = readFileSync(new URL("../.dockerignore", import.meta.url), "utf8");
  assert.doesNotMatch(dockerignore, /^scripts\/?$/mu);
  assert.doesNotMatch(dockerignore, /waha-runtime-binding/u);
});
